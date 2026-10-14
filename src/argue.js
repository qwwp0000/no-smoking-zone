// ---------------------------------------------------------------------------
// 三级 NPC-2（争论型）的「话术论道」式话术对辩（对应策划案 21）
// 出牌对战 · 属性克制 · 气势条 · 每回合限时 + 整场限时 · 可随时退出
// 该模块只负责对辩本身；进入/退出由 game.js 调用 openArgument / closeArgument。
// ---------------------------------------------------------------------------
import { CONFIG } from './config.js';
import { sfx, vibrate, canVibrate } from './audio.js';

const ATTR_LABEL = { li: '理', qing: '情', shi: '势' };
// 克制环：理克情 → 情克势 → 势克理（对应 21.2）
const BEATS = { li: 'qing', qing: 'shi', shi: 'li' };
const $ = (id) => document.getElementById(id);

export class ArgueFight {
  constructor(game, npc) {
    this.game = game;
    this.npc = npc;
    this.C = CONFIG.argue;
    this.meter = this.C.meterStart;
    this.totalLeft = this.C.timeLimit;
    this.roundLeft = this.C.roundTime;
    this.lastAttr = null;       // 上一回合玩家打出的属性（用于“被看穿”）
    this.round = 0;
    this.over = false;
    this.lock = false;          // 结算动画期间锁住出牌
    this.roundEndTimer = 0;
    this.closeTimer = null;
    this.winResult = false;
    this.result = null;
    this.tickAcc = 0;
    this.hand = [];
    this.npcCard = null;
    // 「手把手」教学（首次进入对辩时由 game.js 传 teaching=true 开启）
    this.tut = this.C.tutorial || null;
    this.teach = false;        // 是否处于教学模式
    this.tutStep = -1;         // 当前教学步骤索引（-1 = 不显示教学面板）
    this.tutBest = -1;         // 教学「出牌」步骤推荐打出的那张牌（聚光灯指向它）
    this.tutHpFloor = null;    // 教学期间的健康下限（见 start）
    const mask = $('argue-mask');
    this.el = {
      root: $('argue'),
      npcSaid: $('argue-npc-said'),
      playerSaid: $('argue-player-said'),
      meterFill: $('argue-meter-fill'),
      meterNum: $('argue-meter-num'),
      roundTime: $('argue-round-time'),
      totalTime: $('argue-total-time'),
      healthNum: $('argue-health-num'),
      healthFill: $('argue-health-fill'),
      exit: $('argue-exit'),
      hand: $('argue-hand'),
      tut: $('argue-tut'),
      tutText: $('argue-tut-text'),
      tutAnalysis: $('argue-tut-analysis'),
      tutNext: $('argue-tut-next'),
      mask,
      mTop: mask.querySelector('.am-top'),
      mBottom: mask.querySelector('.am-bottom'),
      mLeft: mask.querySelector('.am-left'),
      mRight: mask.querySelector('.am-right'),
      mSpot: mask.querySelector('.am-spot'),
      mArrow: mask.querySelector('.am-arrow'),
    };
    // 窗口尺寸变化时重新贴合聚光灯（教学期间手牌/布局可能位移）
    this._onResize = () => this.tutReposition();
    window.addEventListener('resize', this._onResize);
  }

  start(teaching = false) {
    const a = this.el;
    this.teach = !!(teaching && this.tut && this.tut.enabled);
    a.root.classList.add('show');
    a.exit.onclick = () => this.exit();
    sfx.unlock();

    // 教学局：气势起点更高、限时几乎解除，先带打两回合，再把参数切回正常
    if (this.teach) {
      this.meter = this.tut.startMeter;
      this.totalLeft = this.tut.timeLimit;
      this.roundLeft = this.tut.roundTime;
      // 教学期间的健康下限（取进教学时的血量与配置下限中的较小值，不凭空回血）
      this.tutHpFloor = Math.min(this.game.player.health, this.tut.healthFloor);
    }

    a.npcSaid.textContent = this.C.opening;
    a.npcSaid.className = 'argue-quip';
    a.playerSaid.textContent = this.teach ? '（他摆开架势，要跟你辩一场）' : '（从下面选一张牌打出去）';
    a.playerSaid.className = 'argue-quip';

    this.nextRound(true);
    if (this.teach) this.tutGoTo(0);
    // 非首次进入：只给一条非阻塞小提示（不得使用会暂停主循环的模态卡片）
    else this.game.argueTip?.(this.game.level.tutorial?.onArgue);
  }

  destroy() {
    const a = this.el;
    a.root.classList.remove('show', 'shake');
    a.hand.innerHTML = '';
    a.exit.onclick = null;
    window.removeEventListener('resize', this._onResize);
    this.tutHide();
  }

  // --- 回合驱动 ---------------------------------------------------------
  nextRound(first = false) {
    this.round++;
    this.roundLeft = this.teach ? this.tut.roundTime : this.C.roundTime;
    this.tickAcc = 0;
    this.lock = false;
    // 首回合用开场白当第一张 NPC 牌（属性“势”：抢先立威），之后随机
    // 教学局则按固定的属性序列出牌，便于逐张讲克制
    if (this.teach) {
      const c = this.tut.npcCards[Math.min(this.round - 1, this.tut.npcCards.length - 1)];
      this.npcCard = { attr: c.attr, text: c.text };
    } else {
      this.npcCard = first
        ? { attr: 'shi', text: this.C.opening }
        : this.C.npcLines[Math.floor(Math.random() * this.C.npcLines.length)];
    }
    this.el.npcSaid.textContent = `【${ATTR_LABEL[this.npcCard.attr]}】${this.npcCard.text}`;
    this.el.npcSaid.className = 'argue-quip';
    if (!first) this.el.playerSaid.textContent = '（轮到你）';
    this.dealHand();
    this.render();
  }

  dealHand() {
    // 教学局：按固定属性序列发牌（每回合保证有关键的克制牌）
    if (this.teach) {
      const attrs = this.tut.hands[Math.min(this.round - 1, this.tut.hands.length - 1)];
      this.hand = attrs.map((attr, k) => {
        const pool = this.C.deck.filter((c) => c.attr === attr);
        return pool[(this.round + k) % pool.length];
      });
      return;
    }
    const pool = [...this.C.deck];
    const n = Math.max(1, this.C.handSize);
    this.hand = [];
    for (let i = 0; i < n && pool.length; i++) {
      const k = Math.floor(Math.random() * pool.length);
      this.hand.push(pool.splice(k, 1)[0]);
    }
  }

  play(i) {
    if (this.over || this.lock) return;
    // 教学期间：只有「出牌」步骤里、并且点的正是高亮推荐的那张牌，才允许出牌
    if (this.teach) {
      const st = this.curStep();
      if (!st || st.mode !== 'play' || i !== this.tutBest) return;
    }
    const card = this.hand[i];
    if (!card) return;
    sfx.card();
    vibrate([12]);          // 出牌瞬间的轻微震动反馈
    this.flyCard(i);        // 打出的牌甩向右侧「你说」面板
    this.resolveRound(card, false);
  }

  /** 出牌动画：把点中的那张牌从手牌区甩向右侧「你说」面板 */
  flyCard(i) {
    const src = this.el.hand?.children[i];
    const target = this.el.root?.querySelector('.argue-side.me');
    if (!src || !target) return;
    const s = src.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const clone = src.cloneNode(true);
    clone.classList.remove('tut-recommend');
    clone.classList.add('argue-fly');
    clone.style.position = 'fixed';
    clone.style.left = `${s.left}px`;
    clone.style.top = `${s.top}px`;
    clone.style.width = `${s.width}px`;
    clone.style.height = `${s.height}px`;
    clone.style.margin = '0';
    clone.style.zIndex = '40';
    clone.style.pointerEvents = 'none';
    // 落点：右侧面板中心（相对出发位置的位移）
    clone.style.setProperty('--fly-x', `${(t.left + t.width / 2) - (s.left + s.width / 2)}px`);
    clone.style.setProperty('--fly-y', `${(t.top + t.height / 2) - (s.top + s.height / 2)}px`);
    document.body.appendChild(clone);
    setTimeout(() => clone.remove(), 640);
  }

  /** @param {object|null} card 玩家出的牌；null 表示超时被抢白 */
  resolveRound(card, timeout) {
    const C = this.C;
    let outcome, delta;
    if (timeout) {
      outcome = 'timeout';
      delta = -C.timeoutPenalty;
    } else if (C.repeatAttributeLock && this.lastAttr && this.lastAttr === card.attr) {
      outcome = 'locked';           // 连续同属性被看穿
      delta = -C.lockPenalty;
    } else if (BEATS[card.attr] === this.npcCard.attr) {
      outcome = 'advantage';
      delta = C.advantageDelta;
    } else if (card.attr === this.npcCard.attr) {
      outcome = 'neutral';
      delta = C.neutralDelta;
    } else {
      outcome = 'disadvantage';
      delta = -C.disadvantageDelta;
    }

    if (card) {
      this.lastAttr = card.attr;
      this.el.playerSaid.textContent = `【${ATTR_LABEL[card.attr]}】${card.text}`;
    } else {
      this.el.playerSaid.textContent = '（你迟疑了，被他抢白）';
    }

    this.meter = Math.max(0, Math.min(C.meterMax, this.meter + delta));
    this.feedback(outcome, delta);
    this.render();
    this.el.hand.innerHTML = '';   // 出牌后清空手牌，等下一回合

    // 胜负判定
    if (this.meter >= C.meterMax) { this.finish(true); return; }
    if (this.meter <= 0) { this.finish(false); return; }
    if (this.totalLeft <= 0) { this.finish(false); return; }

    // 教学：出牌后推进到讲解步骤（第 1 回合讲气势条，第 2 回合讲限时/掉血/退出）
    if (this.teach) this.tutOnPlayed();

    this.lock = true;
    this.roundEndTimer = 0.85;
  }

  // --- 强反馈三件套（对应 21.6） ----------------------------------------
  feedback(outcome, delta) {
    const a = this.el;
    // 文字抖动：打出的牌面文字甩出时抖动并按结果变色
    a.playerSaid.classList.remove('quip-shake', 'good', 'bad');
    void a.playerSaid.offsetWidth;   // 重置动画
    a.playerSaid.classList.add('quip-shake');

    // 右侧「你说」面板轻微回弹，视线聚焦到玩家这一侧
    const mePanel = a.root?.querySelector('.argue-side.me');
    if (mePanel) {
      mePanel.classList.remove('argue-receive');
      void mePanel.offsetWidth;
      mePanel.classList.add('argue-receive');
    }

    let shakeRoot = false;
    if (outcome === 'advantage') {
      a.playerSaid.classList.add('good');
      sfx.advantage();
      vibrate([35, 40, 70]);
    } else if (outcome === 'neutral') {
      sfx.neutral();
      vibrate([20]);
    } else {
      a.playerSaid.classList.add('bad');
      sfx.countered();
      vibrate([90, 50, 90]);
      shakeRoot = true;
    }
    // 不支持震动的平台：降级为界面抖动
    if (!canVibrate() || shakeRoot) this.shakeRoot(shakeRoot ? 420 : 220);
    this.showDelta(delta, outcome);
  }

  /** 气势条上浮出 +/− 数值，让结算结果一眼可见 */
  showDelta(delta, outcome) {
    const C = this.C;
    const host = this.el.meterFill?.parentElement?.parentElement;
    if (!host || !delta) return;
    const span = document.createElement('span');
    span.className = `argue-delta ${delta > 0 ? 'up' : 'down'}`;
    const label = outcome === 'timeout' ? '被抢白' : outcome === 'locked' ? '被看穿' : delta > 0 ? '克制' : delta === C.neutralDelta ? '平' : '被克';
    span.textContent = `${delta > 0 ? '+' : ''}${delta} ${label}`;
    host.appendChild(span);
    setTimeout(() => span.remove(), 900);
  }

  shakeRoot(ms) {
    const a = this.el.root;
    a.classList.remove('shake');
    void a.offsetWidth;
    a.classList.add('shake');
    clearTimeout(this._shakeT);
    this._shakeT = setTimeout(() => a.classList.remove('shake'), ms);
  }

  finish(win) {
    if (this.over) return;
    this.over = true;
    this.winResult = win;
    this.result = win ? 'win' : 'lose';
    this.el.hand.innerHTML = '';
    if (win) {
      sfx.win();
      vibrate([50, 60, 50, 60, 140]);
      this.el.npcSaid.textContent = this.C.winLine;
      this.el.npcSaid.className = 'argue-quip good';
      this.el.playerSaid.className = 'argue-quip good';
    } else {
      sfx.lose();
      vibrate([140, 60, 140, 60, 240]);
      this.el.npcSaid.textContent = this.C.loseLine;
      this.el.npcSaid.className = 'argue-quip bad';
      this.el.playerSaid.className = 'argue-quip bad';
    }
    if (!canVibrate()) this.shakeRoot(600);
    // 留一点结算展示时间再关闭（不阻塞主循环，健康继续按烟雾扣除）
    this.closeTimer = 1.2;
  }

  /** 玩家主动退出（Esc / 按钮）：放弃本场，不额外惩罚（对应 21.2） */
  exit() {
    if (this.over) return;
    this.over = true;
    this.winResult = false;
    this.result = 'exit';
    this.closeTimer = 0;
  }

  update(dt) {
    const a = this.el;
    // 健康红条实时反映玩家在烟雾中的掉血（对应 21.3 / 21.5）
    // 教学期间加一个下限：主循环仍在扣血，但不会让第一次打对辩的玩家「读着教学被熏死」
    if (this.teach && this.tutHpFloor != null) {
      this.game.player.health = Math.max(this.game.player.health, this.tutHpFloor);
    }
    const hp = Math.max(0, this.game.player.health);
    a.healthFill.style.width = `${hp}%`;
    a.healthNum.textContent = Math.round(hp);
    a.healthFill.classList.toggle('danger', hp <= CONFIG.health.lowHealthWarn);
    a.healthFill.classList.toggle('warn', hp > CONFIG.health.lowHealthWarn && hp <= CONFIG.health.warnHealth);

    if (this.closeTimer != null) {
      this.closeTimer -= dt;
      if (this.closeTimer <= 0) {
        this.closeTimer = null;
        this.game.closeArgument(this.result || 'lose');
      }
      return;
    }
    if (this.over) return;
    // 教学期间冻结对辩计时与回合推进：玩家点「下一步」/点高亮牌才继续
    // （外层主循环照常运行，烟雾扩散与掉血不会因此停止）
    if (this.teach) return;
    if (this.roundEndTimer > 0) {
      this.roundEndTimer -= dt;
      if (this.roundEndTimer <= 0) this.nextRound();
      return;
    }

    this.roundLeft -= dt;
    this.totalLeft -= dt;
    this.renderTimes();
    if (this.roundLeft <= 0) { this.resolveRound(null, true); return; }
    if (this.totalLeft <= 0) { this.finish(false); return; }

    this.tickAcc -= dt;
    if (this.roundLeft <= 3 && this.tickAcc <= 0) { sfx.tick(); this.tickAcc = 0.55; }
  }

  renderTimes() {
    this.el.roundTime.textContent = Math.max(0, this.roundLeft).toFixed(1);
    this.el.totalTime.textContent = Math.max(0, Math.ceil(this.totalLeft));
    const r = this.el.roundTime.parentElement;
    if (r) r.classList.toggle('urgent', this.roundLeft <= 2.5);
  }

  render() {
    const C = this.C;
    const pct = Math.max(0, Math.min(100, this.meter / C.meterMax * 100));
    this.el.meterFill.style.width = `${pct}%`;
    this.el.meterFill.classList.toggle('good', pct >= 66);
    this.el.meterFill.classList.toggle('bad', pct <= 33);
    this.el.meterNum.textContent = Math.round(this.meter);
    this.renderTimes();

    const hand = this.el.hand;
    hand.innerHTML = '';
    this.hand.forEach((card, i) => {
      const el = document.createElement('div');
      el.className = `argue-card attr-${card.attr}`;
      el.innerHTML = `<span class="ac-attr">${ATTR_LABEL[card.attr]}</span><span class="ac-text">${card.text}</span><span class="ac-key">${i + 1}</span>`;
      el.onclick = () => this.play(i);
      hand.appendChild(el);
    });
  }

  // --- 聚焦式「手把手」教学（首次进入对辩时开启） -------------------------
  /** 当前步骤（未在教学时为 null） */
  curStep() {
    if (!this.tut || this.tutStep < 0) return null;
    return this.tut.steps[this.tutStep] || null;
  }

  /** 步骤指向的界面元素；教学「出牌」步骤固定指向推荐打出的那张牌 */
  tutTargetEl(key) {
    if (key === 'bestCard') return this.el.hand.children[this.tutBest] || this.el.hand;
    const map = {
      hand: '#argue-hand',
      npc: '.argue-side.npc',
      me: '.argue-side.me',
      meter: '.argue-meter-row',
      times: '.argue-info',
      health: '.argue-health',
      exit: '#argue-exit',
    };
    const sel = map[key];
    return sel ? this.el.root.querySelector(sel) : null;
  }

  /** 切到某一步：写文案 → 定位聚光灯/箭头 → 决定按钮（read 步骤才有按钮） */
  tutGoTo(target) {
    if (!this.tut) return;
    const list = this.tut.steps;
    const idx = typeof target === 'number' ? target : list.findIndex((s) => s.id === target);
    if (idx < 0 || idx >= list.length) { this.tutHide(); return; }
    this.tutStep = idx;
    const st = list[idx];
    const isPlay = st.mode === 'play';

    this.el.tut.classList.add('show');
    this.el.tutText.innerHTML = st.text;
    // 出牌步骤：展示逐张属性分析、隐藏按钮（改为「点高亮的那张牌」推进）
    this.el.tutAnalysis.classList.toggle('show', isPlay);
    if (isPlay) this.tutRenderAnalysis();
    else this.el.tutAnalysis.innerHTML = '';
    this.el.tutNext.style.display = isPlay ? 'none' : '';
    this.el.tutNext.textContent = st.id === 'final' ? this.tut.tipStart : this.tut.tipNext;
    this.el.tutNext.onclick = () => this.tutAdvance();

    this.tutSpot(isPlay ? 'bestCard' : st.target);
  }

  /** 隐藏教学面板 + 遮罩（教学结束/对辩销毁时调用） */
  tutHide() {
    if (!this.el.tut) return;
    this.el.tut.classList.remove('show', 'dock-top');
    this.el.tutAnalysis.classList.remove('show');
    this.el.tutAnalysis.innerHTML = '';
    this.el.tutNext.onclick = null;
    this.el.mask.classList.remove('show');
    this.tutStep = -1;
  }

  /** 重新贴合聚光灯（窗口尺寸变化时） */
  tutReposition() {
    if (!this.teach || this.tutStep < 0) return;
    const st = this.curStep();
    if (st) this.tutSpot(st.mode === 'play' ? 'bestCard' : st.target);
  }

  /** 定位遮罩镂空、光圈与箭头；目标偏下时面板停顶部，否则停在下中 */
  tutSpot(key) {
    const a = this.el;
    const base = a.root.getBoundingClientRect();
    const el = key ? this.tutTargetEl(key) : null;
    const pad = this.tut.spotPad ?? 8;
    let x = 0, y = 0, w = 0, h = 0;
    if (el) {
      const r = el.getBoundingClientRect();
      x = r.left - base.left - pad;
      y = r.top - base.top - pad;
      w = r.width + pad * 2;
      h = r.height + pad * 2;
    }
    const W = base.width, H = base.height;
    const set = (node, left, top, width, height) => {
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
      node.style.width = `${Math.max(0, width)}px`;
      node.style.height = `${Math.max(0, height)}px`;
    };
    if (el) {
      set(a.mTop, 0, 0, W, y);                       // 上条：目标上方
      set(a.mBottom, 0, y + h, W, H - (y + h));      // 下条：目标下方
      set(a.mLeft, 0, y, x, h);                      // 左条：目标左侧
      set(a.mRight, x + w, y, W - (x + w), h);       // 右条：目标右侧
      set(a.mSpot, x, y, w, h);
    } else {
      // 无目标（教学收尾）：整屏压灰，只留教学面板可点
      set(a.mTop, 0, 0, W, H);
      set(a.mBottom, 0, 0, 0, 0);
      set(a.mLeft, 0, 0, 0, 0);
      set(a.mRight, 0, 0, 0, 0);
      set(a.mSpot, 0, 0, 0, 0);
    }
    a.mSpot.style.display = el ? '' : 'none';
    a.mArrow.style.display = el ? '' : 'none';
    a.mask.classList.add('show');

    // 目标偏下（如手牌）→ 面板停顶部、箭头在目标上方朝下；否则面板停底部、箭头在目标下方朝上
    const low = el ? (y + h / 2) > H * 0.6 : false;
    a.tut.classList.toggle('dock-top', low);
    if (el) {
      a.mArrow.textContent = low ? '▼' : '▲';
      a.mArrow.className = `am-arrow ${low ? 'down' : 'up'}`;
      a.mArrow.style.left = `${x + w / 2}px`;
      a.mArrow.style.top = low ? `${Math.max(4, y - 32)}px` : `${y + h + 6}px`;
    }
  }

  /** 点「下一步」推进脚本；进入第二回合的节点顺手开新回合 */
  tutAdvance() {
    const st = this.curStep();
    if (!st || st.mode === 'play') return;   // 出牌步骤由「点高亮牌」推进
    const next = this.tut.steps[this.tutStep + 1];
    if (!next) return this.endTutorial();
    if (next.id === 'reveal') {              // 第 1 回合结算讲解完 → 手动开第 2 回合
      this.roundEndTimer = 0;
      this.nextRound();
    }
    this.tutGoTo(this.tutStep + 1);
  }

  /** 出牌后推进到结算讲解 */
  tutOnPlayed() {
    this.tutGoTo(this.round === 1 ? 'after1' : 'time');
  }

  /** 教学结束：气势保留、限时切回正常，之后由玩家自己打赢 */
  endTutorial() {
    this.teach = false;
    this.tutHide();
    this.game.markArgueTutorialDone?.();   // 完整教过一次后不再重复
    this.totalLeft = Math.min(this.totalLeft, this.C.timeLimit);
    this.roundEndTimer = 0;
    this.nextRound();
  }

  /** 头两次出牌的「逐张属性分析」，并记下推荐打出的那张牌（聚光灯指向它） */
  tutRenderAnalysis() {
    const C = this.C;
    const npcAttr = this.npcCard?.attr;
    this.tutBest = this.hand.findIndex((c) => BEATS[c.attr] === npcAttr);
    if (!npcAttr) { this.el.tutAnalysis.innerHTML = ''; return; }
    const winAttr = Object.keys(BEATS).find((k) => BEATS[k] === npcAttr);
    const rows = this.hand.map((card, i) => {
      const a = card.attr;
      let rel, cls, num;
      if (BEATS[a] === npcAttr) { rel = '克制他的牌'; cls = 'win'; num = `+${C.advantageDelta}`; }
      else if (a === npcAttr) { rel = '同属性，不痛不痒'; cls = 'same'; num = `+${C.neutralDelta}`; }
      else { rel = '被他克制'; cls = 'lose'; num = `−${C.disadvantageDelta}`; }
      return `<div class="ta-row ${cls}"><span class="ta-idx">${i + 1}</span>`
        + `<span class="ta-attr attr-${a}">${ATTR_LABEL[a]}</span>`
        + `<span class="ta-rel">${rel}</span><span class="ta-num">${num}</span></div>`;
    }).join('');
    this.el.tutAnalysis.innerHTML =
      `<div class="ta-head">他这手是【${ATTR_LABEL[npcAttr]}】—— 只有【${ATTR_LABEL[winAttr]}】能克制它</div>`
      + `<div class="ta-rows">${rows}</div>`;
    // 在牌面上标出建议打出的那张（与聚光灯一起强调）
    const cards = this.el.hand.children;
    for (let i = 0; i < cards.length; i++) cards[i].classList.toggle('tut-recommend', i === this.tutBest);
  }
}