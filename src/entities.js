import * as THREE from 'three';
import { CONFIG, PALETTE as P } from './config.js';
import { makeCharacter, makeCigarette, makeFlame, makeFootGlow } from './world.js';

// ---------------------------------------------------------------------------
// 通用：沿路径行走的代理
// ---------------------------------------------------------------------------
class Agent {
  constructor(grid, tile) {
    this.grid = grid;
    const w = grid.worldOf(tile.x, tile.z);
    this.pos = new THREE.Vector3(w.x, 0, w.z);
    this.path = null;
    this.pathIdx = 0;
    this.facing = 0;
    this.moving = false;
    this.animT = 0;
  }

  get cell() { return this.grid.cellOf(this.pos.x, this.pos.z); }
  get cellKey() { const c = this.cell; return c.z * this.grid.w + c.x; }

  setPath(path) {
    if (!path || path.length < 2) {
      this.path = null;
      return false;
    }
    // 去掉起点
    this.path = path.slice(1);
    this.pathIdx = 0;
    return true;
  }

  /** 返回 true 表示已抵达终点 */
  followPath(dt, speed) {
    if (!this.path || this.pathIdx >= this.path.length) { this.moving = false; return true; }
    const eps = CONFIG.agent.arriveEpsilon;
    let budget = speed * dt;
    while (budget > 0 && this.pathIdx < this.path.length) {
      const node = this.path[this.pathIdx];
      const w = this.grid.worldOf(node.x, node.z);
      const dx = w.x - this.pos.x;
      const dz = w.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < eps) {
        this.pathIdx++;
        continue;
      }
      const step = Math.min(budget, dist);
      this.pos.x += (dx / dist) * step;
      this.pos.z += (dz / dist) * step;
      this.facing = Math.atan2(dx, dz);
      budget -= step;
    }
    this.moving = this.pathIdx < this.path.length;
    return !this.moving;
  }

  animate(dt, rig) {
    if (!rig) return;
    if (this.moving) {
      this.animT += dt * CONFIG.agent.walkAnim;
      const sw = Math.sin(this.animT) * 0.5;
      rig.legL.rotation.x = sw;
      rig.legR.rotation.x = -sw;
      rig.armL.rotation.x = -sw * 0.7;
      rig.armR.rotation.x = sw * 0.7;
      rig.group.position.y = Math.abs(Math.sin(this.animT)) * 0.045;
    } else {
      this.animT += dt * 1.6;
      const idle = Math.sin(this.animT) * 0.03;
      rig.legL.rotation.x = 0;
      rig.legR.rotation.x = 0;
      rig.armL.rotation.x = idle;
      rig.armR.rotation.x = -idle;
      rig.group.position.y = 0;
    }
    rig.group.rotation.y = this.facing;
  }
}

// ---------------------------------------------------------------------------
// 玩家
// ---------------------------------------------------------------------------
export class Player extends Agent {
  constructor(grid, tile) {
    super(grid, tile);
    this.health = CONFIG.player.maxHealth;
    this.maxHealth = CONFIG.player.maxHealth;
    this.exposure = 0;
    this.safeField = 0;
    this.inSafe = false;
    this.keys = new Set();
    this.manual = false;
    this.stats = { dangerTime: 0, safeTime: 0, peakExposure: 0 };
    // 愤怒值（对应策划案 13）：改变决策成本，不直接决定输赢
    this.maxAnger = CONFIG.anger.max;
    this.anger = CONFIG.anger.start;
    this.angerState = 'calm';
    const rig = makeCharacter({ cloth: P.playerCloth, hair: 0x3a2c20, scale: 1.02 });
    this.rig = rig;
    this.group = rig.group;
  }

  get angerRatio() { return this.anger / this.maxAnger; }

  addAnger(v) {
    if (v <= 0) return;
    this.anger = Math.min(this.maxAnger, this.anger + v);
  }

  reduceAnger(v) {
    if (v <= 0) return;
    this.anger = Math.max(0, this.anger - v);
  }

  /** 每帧更新愤怒值：暴露累积 / 安全区与调查平复（对应策划案 13.2 / 13.3） */
  updateAnger(dt, { investigating = false } = {}) {
    const A = CONFIG.anger;
    if (this.exposure > A.exposureMin) this.addAnger(A.riseExposure * this.exposure * dt);
    if (this.inSafe) this.reduceAnger(A.fallSafe * dt);
    if (investigating) this.reduceAnger(A.fallInvestigate * dt);
    this.angerState = this.anger >= A.brinkAbove ? 'brink' : this.anger >= A.calmBelow ? 'rising' : 'calm';
    return this.angerState;
  }

  moveManual(dirX, dirZ, dt) {
    const sp = CONFIG.player.speed;
    const len = Math.hypot(dirX, dirZ) || 1;
    const nx = this.pos.x + (dirX / len) * sp * dt;
    const nz = this.pos.z + (dirZ / len) * sp * dt;
    const cx = this.grid.cellOf(this.pos.x + (dirX / len) * CONFIG.player.radius * 1.2, this.pos.z);
    const cz = this.grid.cellOf(this.pos.x, this.pos.z + (dirZ / len) * CONFIG.player.radius * 1.2);
    if (this.grid.isWalkable(cx.x, cx.z)) this.pos.x = nx;
    if (this.grid.isWalkable(cz.x, cz.z)) this.pos.z = nz;
    this.facing = Math.atan2(dirX, dirZ);
    this.moving = true;
  }

  updateHealth(dt, grid) {
    const H = CONFIG.health;
    const s = Math.min(1, grid.smokeAtWorld(this.pos.x, this.pos.z) * H.exposurePosFactor);
    const field = grid.ventAtWorld(this.pos.x, this.pos.z);
    this.exposure = s;
    this.safeField = field;
    // 暴露判定：浓度达到“洁净阈值”（即肉眼已能看到烟雾）就算身处烟雾中，
    // 此时既不进入安全区也不回血 —— 修复“在烟里走动血条反而上涨”的 bug。
    const exposed = s >= H.cleanThreshold;
    this.inSafe = !exposed && field > H.ventSafeField;

    const damage = H.smokeDamage * s;
    const ventRecover = this.inSafe ? H.ventRecover * field * (1 - s * 0.6) : 0;
    const cleanRecover = (!exposed && !this.inSafe) ? H.cleanRecover : 0;
    const recover = ventRecover + cleanRecover;
    const prev = this.health;
    this.health = Math.max(0, Math.min(this.maxHealth, this.health + (recover - damage) * dt));

    if (s > 0.12) this.stats.dangerTime += dt;
    if (this.inSafe) this.stats.safeTime += dt;
    this.stats.peakExposure = Math.max(this.stats.peakExposure, s);
    return { damage, recover, delta: this.health - prev };
  }
}

// ---------------------------------------------------------------------------
// 目标 NPC（三级行为状态机，对应策划案 3）
// ---------------------------------------------------------------------------
export const NPC_STATE_LABEL = {
  smoking: '正在吸烟',
  walking: '前往吸烟区',
  fakeWalking: '假意配合',
  atArea: '已抵达吸烟区',
  annoyed: '换了个地方抽',
  negotiating: '交涉中',
  arguing: '话术对辩中',
  leaving: '继续走开',
  knockback: '被击退',
};

export class NPC extends Agent {
  constructor(game, tile, levelNum, variant = null) {
    super(game.grid, tile);
    this.game = game;
    this.levelNum = levelNum;
    this.variant = variant;
    this.homeTile = { ...tile };
    // 窗户附近禁止吸烟：出生点若落在窗户影响范围内，就近挪到不受影响的位置
    if (this.grid.isWindowAvoid(tile.x, tile.z)) {
      const alt = this.grid.nearestWalkable(tile, (x, z) => !this.grid.isWindowAvoid(x, z));
      if (alt) {
        const wp = this.grid.worldOf(alt.x, alt.z);
        this.pos.set(wp.x, 0, wp.z);
        this.homeTile = { ...alt };
      }
    }
    // 争论型（三级 NPC-2）使用 npc.argue 配置；普通 NPC 用 npc[等级]
    this.cfg = variant === 'argue'
      ? { ...CONFIG.npc.argue }
      : { ...CONFIG.npc[levelNum], ...(game.level.npcOverrides?.[levelNum] || {}) };
    this.state = 'smoking';
    this.emitOn = true;
    this.compliance = 0;
    this.fakesLeft = this.cfg.fakeCompliesFirst ?? 0;
    this.signTimer = 0;
    this.signTriggered = false;
    this.stateTimer = 0;
    this.clue = null;
    this.clueTimer = 0;
    this.remindCount = 0;
    this.negotiateUsed = new Set();
    this.evidence = 0;          // 记录设备收集到的违规证据（对应策划案 12.2）
    this.ignoreCount = 0;       // 被提醒却无视的次数（供调查判定“反复违规”）
    this.decoyTile = null;
    this.lastRouteForkClue = false;
    this.smokeElapsed = 0;      // 当前这根烟已燃烧的时间（对应 smokingDuration）
    this.resting = false;       // 一根抽完后的间隙，期间不释放烟雾
    this.restTimer = 0;
    this.fakeTimer = 0;         // 假意配合已持续时间（对应 clueDelay）
    this.misledOnce = false;    // 是否已被“方向错误”的提示牌带偏过（避免反复）
    this.misleadTimer = 0;
    // 争论型（三级 NPC-2）专属：提醒计数 / 冷却 / 是否已被话术说服（对应策划案 21）
    this.argueRemindCount = 0;  // 触发对辩用的提醒次数
    this.argueCooldown = 0;     // 输了/退出后的冷却秒数
    this.argueTried = 0;        // 已对辩次数（可无限重来，仅用于统计）
    // 棒球棍道具（对应道具「棒球棍」）：被打次数 / 是否已被激怒 / 停止吸烟计时
    this.batHits = 0;
    this.batAngry = false;
    this.batStopTimer = 0;

    const cloth = P.npcCloth;
    const rig = makeCharacter({ cloth, hair: levelNum === 3 ? 0x2f2a24 : P.hairDark, scale: 1 });
    this.rig = rig;
    this.group = rig.group;
    this.group.position.copy(this.pos);

    this.cig = makeCigarette();
    this.cig.position.set(0.2, 0.62, 0.16);
    this.cig.rotation.y = 0.9;
    this.group.add(this.cig);

    // 脚下红色圆形光效（占一格）：吸烟中显示，帮助玩家快速定位烟源
    this.footGlow = makeFootGlow(0xd23b30, CONFIG.highlight.footGlowRadius, CONFIG.highlight.footGlowOpacity);
    this.footGlow.visible = false;
    this.group.add(this.footGlow);

    this.solved = false;

    // 状态小徽标（头顶的等级/线索牌）
    this.badge = null;
  }

  get isGone() { return this.state === 'atArea'; }
  get isArgue() { return this.variant === 'argue'; }
  /** 争论型是否已提醒够次数、可进入话术对辩 */
  get argueReady() { return this.argueRemindCount >= (this.cfg.triggerRemind ?? 2); }

  setClue(text, seconds = 3.2, kind = 'clue') {
    this.clue = text;
    this.clueTimer = seconds;
    this.clueKind = kind;
  }

  /** 被玩家提醒（对应 3.1 / 3.2 的普通提醒） */
  remind() {
    if (this.state === 'atArea') return { result: 'done', text: '他已经站在吸烟区了。' };
    // 争论型（三级 NPC-2）：提醒只计数、绝不动身（对应策划案 21.1）
    if (this.isArgue) {
      if (this.state === 'arguing') return { result: 'argue', text: '正在话术对辩中。' };
      if (this.argueCooldown > 0) {
        this.setClue(`冷静中 ${Math.ceil(this.argueCooldown)}s`, 2.0, 'clue');
        return { result: 'cooldown', text: '他刚吵完还在气头上，缓一缓再提醒。' };
      }
      this.argueRemindCount++;
      const need = this.cfg.triggerRemind ?? 2;
      if (this.argueRemindCount >= need) {
        return { result: 'argue', text: '他把烟往地上一摁：「行，讲道理，你说。」' };
      }
      this.ignoreCount++;
      this.setClue('懒得理你', 2.6, 'clue');
      return { result: 'ignore', text: `他连眼皮都没抬（第 ${this.argueRemindCount}/${need} 次提醒）——这种人只认话术。` };
    }
    this.remindCount++;
    const r = this.cfg.remindReaction;
    if (r === 'comply') {
      this.setClue('好的，我这就去。', 2.6, 'good');
      this.goToArea();
      return { result: 'comply', text: `一级 NPC 听劝，起身走向吸烟区。` };
    }
    if (r === 'ignore') {
      this.ignoreCount++;
      if (this.levelNum === 3) {
        this.setClue('敷衍', 3.0, 'clue');
        return { result: 'ignore', text: '三级 NPC 敷衍了两句，身体一动不动。' };
      }
      // 二级：口头无效，并且可能换个位置继续抽
      const relocate = Math.random() < (this.cfg.relocateChance ?? 0);
      if (relocate && this.remindCount <= 2) {
        this.relocate();
        this.setClue('换这边抽', 3.0, 'clue');
        return { result: 'ignore', text: '他瞥了你一眼，挪到旁边继续抽——口头提醒对他没用。' };
      }
      this.setClue('无视', 2.4, 'clue');
      return { result: 'ignore', text: '他当作没听见。这种人需要管理介入（走到管理人员身边按 E）。' };
    }
    return { result: 'ignore', text: '……没有反应。' };
  }

  relocate() {
    const candidates = this.grid.allTilesOf('.');
    let best = null, bd = -1;
    for (const t of candidates) {
      if (Math.abs(t.x - this.cell.x) < 2 && Math.abs(t.z - this.cell.z) < 2) continue;
      if (this.isAreaTile(t.x, t.z)) continue;
      if (this.grid.isWindowAvoid(t.x, t.z)) continue;   // 不在窗户附近抽烟
      const d = Math.abs(t.x - this.homeTile.x) + Math.abs(t.z - this.homeTile.z);
      if (d > bd) { bd = d; best = t; }
    }
    if (best) this.walkTo(best, 'annoyed');
  }

  /** 记录设备：收集一次违规证据（对应策划案 12.2） */
  recordEvidence() {
    this.evidence++;
    this.setClue(`记录 ${this.evidence} 次`, 2.4, 'clue');
    return this.evidence;
  }

  // 所需证据数会因“管理长期失效”的调查修复而降低（对应策划案 14.3）
  get evidenceEnough() { return this.evidence >= (this.game?.recordNeed ?? CONFIG.record.need); }

  /** 管理介入（对应 3.2 / 3.3） */
  managerIntervene() {
    const r = this.cfg.managerReaction;
    if (this.state === 'atArea') return { result: 'done', text: '他已经不在违规区域了。' };
    // 二级 NPC：没有记录证据时，管理介入无效（对应 3.2 / 12.2）
    if (this.levelNum === 2 && r === 'comply' && !this.evidenceEnough) {
      const need = this.game?.recordNeed ?? CONFIG.record.need;
      this.setClue('没证据？', 2.8, 'clue');
      return {
        result: 'needEvidence',
        text: `管理人员说：光凭你一句话不够，先用记录设备（T）记录 ${need} 次违规。`,
      };
    }
    if (r === 'refuse') {
      // 争论型：管理介入完全无效（对应策划案 21.1）
      this.setClue('管理也没用', 3.0, 'clue');
      return { result: 'ignore', text: '管理人员说了两句，被他一句顶了回来——对争论型，管理介入完全无效。' };
    }
    if (r === 'comply') {
      this.setClue('行行行，走了。', 2.4, 'good');
      this.goToArea();
      return { result: 'comply', text: '管理人员出面，二级 NPC 收拾东西动身了。' };
    }
    if (r === 'partial') {
      this.compliance += 1;
      this.setClue('管理来了也不走', 3.2, 'clue');
      if (this.compliance >= this.cfg.negotiateNeed) {
        this.setClue('…算了。', 2.2, 'good');
        this.agreeToGo('manager');
        return { result: 'comply', text: '多次介入后，三级 NPC 的配合点攒够了。' };
      }
      return { result: 'partial', text: '他嘴上争辩，但态度松动了一点（还需交涉）。' };
    }
    return { result: 'ignore', text: '他连管理人员的话也不完全买账。' };
  }

  /** 话术对辩：赢 → 前往吸烟区（对应策划案 21.2） */
  winArgument() {
    this.argueCooldown = 0;
    this.argueRemindCount = 0;
    this.setClue('服了', 2.6, 'good');
    this.goToArea();
  }

  /** 话术对辩：输 → 继续吸烟 + 进入冷却（对应策划案 21.3，可无限重来） */
  loseArgument() {
    this.argueTried++;
    this.argueCooldown = this.cfg.cooldown ?? 12;
    this.argueRemindCount = 0;
    this.state = 'smoking';
    this.emitOn = true;
    this.setClue('接着抽', 2.6, 'clue');
  }

  /** 玩家主动退出对辩：放弃本场、不额外惩罚，下次提醒可重来（对应 21.2） */
  abortArgument() {
    this.argueRemindCount = 0;
    this.state = 'smoking';
    this.emitOn = true;
    this.setClue('不吵了？', 2.2, 'clue');
  }

  /** 三级 NPC 交涉（对应 3.4 行为博弈） */
  negotiate(optionId) {
    if (this.state === 'atArea') return { result: 'done', text: '他已经抵达吸烟区。' };
    this.negotiateUsed.add(optionId);
    // 连续用同一招会被看穿：换一种说法才有效（可学习、不会变成无限惩罚）
    this.streak = this.lastOption === optionId ? (this.streak || 0) + 1 : 1;
    this.lastOption = optionId;
    const repeated = this.streak >= 2;
    const gain = repeated ? (CONFIG.negotiate.wrongPenalty ?? 0) : 1;
    this.compliance = Math.max(0, this.compliance + gain);
    this.state = 'smoking';

    const lines = {
      rule: '「这儿是候车区，吸烟区在东边，标识写得清清楚楚。」',
      smoke: '「你没看到旁边带着孩子的人在躲吗？烟全飘过去了。」',
      manager: '「我已经请管理人员一起过来了，咱们把这事了结掉。」',
    };
    const replies = {
      rule: '他瞟了一眼墙上的标识。',
      smoke: '他看了看周围，动作停了半秒。',
      manager: '他撇撇嘴，语气软了一点。',
    };

    if (repeated) {
      return { result: 'fail', text: `${lines[optionId]} —— 这话他刚听过一遍，已经不吃这套了。换个说法。`, say: '「你刚才不是说过一遍了？」' };
    }
    if (this.compliance >= this.cfg.negotiateNeed) {
      this.agreeToGo('negotiate');
      return { result: 'comply', text: `${lines[optionId]} —— 他松口了。`, say: replies[optionId] };
    }
    return { result: 'partial', text: `${lines[optionId]} —— 他有点动摇（配合度 ${this.compliance}/${this.cfg.negotiateNeed}）。`, say: replies[optionId] };
  }

  /** 达到配合度后“答应前往”，可能触发假意配合（对应 3.3） */
  agreeToGo(source) {
    const needFake = this.fakesLeft > 0 || (Math.random() < (this.cfg.deceptionChance ?? 0));
    if (needFake) {
      this.fakesLeft = Math.max(0, this.fakesLeft - 1);
      this.startFake();
    } else {
      this.goToArea();
    }
  }

  startFake() {
    const area = this.game.smokingTiles;
    // 走向离吸烟区最远的位置：这是一条明确、可观察的错误路线
    let target = null, bd = -1;
    for (const t of this.grid.allTilesOf('.')) {
      if (this.grid.isWindowAvoid(t.x, t.z)) continue;   // 不往窗户附近走（避免在那抽烟）
      let d = Infinity;
      for (const a of area) d = Math.min(d, Math.abs(t.x - a.x) + Math.abs(t.z - a.z));
      if (d > bd && !(Math.abs(t.x - this.cell.x) < 2 && Math.abs(t.z - this.cell.z) < 2)) { bd = d; target = t; }
    }
    this.decoyTile = target;
    if (!target) { this.goToArea(); return; }
    const path = this.grid.findPath(this.cell, target, { blockedExtra: (x, z) => this.isAreaTile(x, z) });
    if (!path) { this.goToArea(); return; }
    this.path = path.slice(1);
    this.pathIdx = 0;
    this.fakeTimer = 0;
    this.state = 'fakeWalking';
    this.emitOn = true;
    this.setClue('好，去去去', 2.2, 'good');
    this.game.onNpcFake?.(this);
  }

  isAreaTile(x, z) { return this.grid.charAt(x, z) === 'S'; }

  /** 真正前往吸烟区 */
  goToArea() {
    const area = this.game.smokingTiles;
    if (!area.length) return;
    let best = area[0], bd = Infinity;
    for (const a of area) {
      const d = (a.x - this.cell.x) ** 2 + (a.z - this.cell.z) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    // 找一个空着的吸烟区格子，避免叠人
    const occupied = new Set(this.game.npcs.filter((n) => n !== this && n.state === 'atArea').map((n) => n.cellKey));
    const free = area.filter((a) => !occupied.has(a.z * this.grid.w + a.x));
    const goal = free.length ? free[Math.floor(Math.random() * free.length)] : best;
    this.walkTo(goal, 'walking');
  }

  walkTo(tile, state) {
    let path = this.grid.findPath(this.cell, tile);
    // 目标被挡住时尝试就近的可通行格，寻找替代路线（对应 3.1）
    if (!path) {
      const alt = this.grid.nearestWalkable(tile);
      if (alt && (alt.x !== tile.x || alt.z !== tile.z)) path = this.grid.findPath(this.cell, alt);
    }
    if (!path) { this.state = 'smoking'; return; }
    this.path = path.slice(1);
    this.pathIdx = 0;
    this.state = state;
    this.emitOn = state === 'walking' || state === 'fakeWalking' || state === 'annoyed' || state === 'misled';
    this.stateTimer = 0;
    this.smokeElapsed = 0;      // 换位置后重新点一根
    this.resting = false;
    this.restTimer = 0;
  }

  update(dt, ctx) {
    this.stateTimer += dt;
    if (this.argueCooldown > 0) this.argueCooldown = Math.max(0, this.argueCooldown - dt);
    if (this.batStopTimer > 0) this.batStopTimer = Math.max(0, this.batStopTimer - dt);
    if (this.clueTimer > 0) {
      this.clueTimer -= dt;
      if (this.clueTimer <= 0) this.clue = null;
    }
    // 假意配合：走一段并经过 clueDelay 秒后才露出线索（对应 3.3 可观察线索）
    if (this.state === 'fakeWalking' && !this.lastRouteForkClue) {
      this.fakeTimer += dt;
      if (this.fakeTimer >= CONFIG.negotiate.clueDelay && this.pathIdx > 1) {
        this.lastRouteForkClue = true;
        this.setClue('方向不对？', 3.4, 'clue');
        this.game.onFakeClue?.(this);
      }
    }
    if (this.state === 'negotiating' || this.state === 'arguing') { this.moving = false; this.animate(dt, this.rig); this.group.position.copy(this.pos); return; }

    if (this.state === 'walking' || this.state === 'fakeWalking' || this.state === 'annoyed' || this.state === 'misled' || this.state === 'knockback') {
      const arrived = this.followPath(dt, CONFIG.agent.npcSpeed);
      if (arrived) {
        const c = this.cell;
        if (this.state === 'knockback') {
          // 被棒球棍击退后落地，就地停手（5 秒内不吸烟，由 batStopTimer 控制）
          this.state = 'smoking';
          this.emitOn = false;
          this.setClue('……', 1.8, 'clue');
        } else if (this.state === 'misled') {
          // 被错误提示牌带到错误位置后，就地继续吸烟（对应 6.2）
          this.state = 'smoking';
          this.emitOn = true;
          this.setClue('不对，这儿不是吸烟区…', 2.8, 'clue');
        } else if (this.isAreaTile(c.x, c.z)) {
          this.state = 'atArea';
          this.emitOn = false;
          this.solved = true;
          this.setClue('到了', 2.4, 'good');
          this.game.onNpcSolved?.(this);
        } else {
          // 假意 / 换位 后继续吸烟
          this.state = 'smoking';
          this.emitOn = true;
          if (this.levelNum >= 2) this.setClue('继续抽', 2.6, 'clue');
        }
        this.stateTimer = 0;
      }
    } else if (this.state === 'smoking') {
      if (this.batStopTimer > 0) {
        // 被棒球棍打中：5 秒内停止吸烟（不产生烟雾、不推进吸烟计时、不受提示牌影响）
        this.emitOn = false;
      } else if (this.resting) {
        // 一根抽完的间隙：停止释放烟雾，稍后重新点燃（高等级可反复出现）
        this.emitOn = false;
        this.restTimer -= dt;
        if (this.restTimer <= 0) {
          this.resting = false;
          this.smokeElapsed = 0;
          this.emitOn = true;
          this.setClue('又点上一根', 2.2, 'clue');
        }
      } else {
        this.emitOn = true;
        this.smokeElapsed += dt;
        if (this.smokeElapsed >= (this.cfg.smokingDuration ?? 30)) {
          // 达到典型吸烟时长后自然熄灭，形成可预测的烟雾节奏
          this.resting = true;
          this.restTimer = 2.6;
          this.emitOn = false;
        } else if (this.cfg.signReaction && !this.signTriggered) {
          // 一级：正确提示牌可让其自行前往（对应 6.2）
          const sign = this.findVisibleSign();
          if (sign) {
            this.signTimer += dt;
            if (this.signTimer > (this.cfg.signReactDelay ?? 4)) {
              this.signTriggered = true;
              this.setClue('哦…那边？', 2.4, 'good');
              this.goToArea();
              this.game.onSignWorked?.(this, sign);
            }
          } else if (!this.misledOnce) {
            // 视线里只有一块“方向错误”的牌子 → 会被带偏，走向错误路线（对应 6.2 / 5.2）
            const bad = this.findMisleadingSign();
            if (bad) {
              this.misleadTimer += dt;
              if (this.misleadTimer > (this.cfg.signReactDelay ?? 3)) {
                this.misledOnce = true;
                this.misleadWalk(bad);
              }
            }
          }
        }
      }
    } else if (this.state === 'atArea') {
      this.emitOn = false;
    }

    // 烟雾释放位置：吸烟状态才贡献烟雾
    this.animate(dt, this.rig);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.facing;
    this.cig.visible = this.batStopTimer <= 0
      && ((this.state === 'smoking' && !this.resting) || this.state === 'annoyed' || this.state === 'misled');

    // 脚下红色光圈：正在冒烟时显示，并做呼吸动画
    const emitting = this.emission > 0;
    this.footGlow.visible = emitting;
    if (emitting) {
      const H = CONFIG.highlight;
      const t = (this.game && this.game.time) || 0;
      const pulse = Math.sin(t * 3.2 + this.pos.x + this.pos.z) * 0.5 + 0.5;
      this.footGlow.material.opacity = H.footGlowOpacity * (0.7 + 0.3 * pulse);
      const s = 1 + H.footGlowPulse * pulse;
      this.footGlow.scale.set(s, s, 1);
    }
  }

  findVisibleSign() {
    for (const sign of this.game.signs) {
      if (!sign.correct) continue;
      const R = sign.effectiveRadius ?? CONFIG.sign.effectRadius;
      const d = Math.hypot(sign.cell.x - this.cell.x, sign.cell.z - this.cell.z);
      if (d > R) continue;
      if (CONFIG.sign.occlusion && !this.grid.hasLineOfSight(this.cell, sign.cell)) continue;
      // 提示牌方向必须大致指向吸烟区
      if (!sign.pointsToSmoking) continue;
      return sign;
    }
    return null;
  }

  findMisleadingSign() {
    for (const sign of this.game.signs) {
      // 只看“看得见、但方向不对”的牌子
      if (!sign.visible || sign.pointsToSmoking) continue;
      const R = sign.effectiveRadius ?? CONFIG.sign.effectRadius;
      const d = Math.hypot(sign.cell.x - this.cell.x, sign.cell.z - this.cell.z);
      if (d > R) continue;
      if (CONFIG.sign.occlusion && !this.grid.hasLineOfSight(this.cell, sign.cell)) continue;
      return sign;
    }
    return null;
  }

  // 被方向错误的提示牌带偏：朝牌子所指（背离吸烟区）的方向走一段（对应 6.2）
  misleadWalk(sign) {
    const dx = Math.sin(sign.angle);
    const dz = Math.cos(sign.angle);
    let target = { x: this.cell.x + Math.round(dx * 3), z: this.cell.z + Math.round(dz * 3) };
    const alt = this.grid.nearestWalkable(target, (x, z) => !this.grid.isWindowAvoid(x, z));
    if (alt) target = alt;
    this.setClue('那边有指示牌？', 2.6, 'clue');
    this.game.onNpcMisled?.(this, sign);
    this.walkTo(target, 'misled');
  }

  /**
   * 被棒球棍击中：沿「玩家→NPC」方向击退若干格，反应逐次升级，并短暂停止吸烟。
   * 返回值用于 UI 反馈（tier / 是否已被彻底激怒 / 文案）。
   */
  hitByBat(dirX, dirZ) {
    const B = CONFIG.bat;
    this.batHits++;
    const tier = Math.min(3, this.batHits);
    this.batAngry = this.batHits >= 3;
    const react = tier >= 3 ? B.react3 : tier === 2 ? B.react2 : B.react1;
    this.setClue(react, 2.6, tier >= 3 ? 'angry' : 'clue');
    // 击退：沿玩家指向 NPC 的方向推出若干格，撞墙时就近找可通行格落地
    const len = Math.hypot(dirX, dirZ) || 1;
    let target = {
      x: this.cell.x + Math.round((dirX / len) * B.push),
      z: this.cell.z + Math.round((dirZ / len) * B.push),
    };
    const alt = this.grid.nearestWalkable(target, (x, z) => !this.grid.isWindowAvoid(x, z));
    if (alt) target = alt;
    this.resting = false;
    this.restTimer = 0;
    this.walkTo(target, 'knockback');
    this.emitOn = false;
    this.batStopTimer = B.stopSmoke;
    return {
      tier,
      angry: this.batAngry,
      text: tier >= 3 ? '他彻底被激怒了，脸色发红。'
        : tier === 2 ? '他皱起眉头，明显不高兴了。'
          : '他被这一下打懵了，一脸疑惑。',
    };
  }

  /** 供烟雾模拟使用 */
  get emission() {
    return this.emitOn ? this.cfg.emission : 0;
  }

  dispose() { if (this.group.parent) this.group.parent.remove(this.group); }
}

// ---------------------------------------------------------------------------
// 管理人员（对应策划案 5 / 3.2：需要时间抵达）
// ---------------------------------------------------------------------------
export class Manager extends Agent {
  constructor(grid, tile) {
    super(grid, tile);
    this.homeTile = { ...tile };
    this.state = 'idle';
    this.target = null;
    this.interveneTimer = 0;
    const rig = makeCharacter({ cloth: P.managerCloth, hair: 0x241d17, scale: 1.05 });
    this.rig = rig;
    this.group = rig.group;
    this.group.position.copy(this.pos);
    this.label = '管理';
  }

  dispatchTo(npc) {
    this.target = npc;
    this.state = 'toTarget';
    const path = this.grid.findPath(this.cell, npc.cell);
    if (!path) { this.state = 'idle'; this.target = null; return false; }
    this.path = path.slice(1);
    this.pathIdx = 0;
    return true;
  }

  update(dt, game) {
    if (this.state === 'idle') { this.animate(dt, this.rig); this.group.position.copy(this.pos); this.group.rotation.y = this.facing; return; }
    if (this.state === 'toTarget') {
      const t = this.target;
      if (!t || t.state === 'atArea') { this.state = 'returning'; this.repathHome(); return; }
      // 目标移动时重算路径
      if (this.pathIdx >= (this.path?.length ?? 0)) {
        const path = this.grid.findPath(this.cell, t.cell);
        if (path) { this.path = path.slice(1); this.pathIdx = 0; }
      } else {
        this.repathTimer = (this.repathTimer ?? 0) - dt;
        if (this.repathTimer <= 0) {
          this.repathTimer = 0.8;
          const path = this.grid.findPath(this.cell, t.cell);
          if (path) { this.path = path.slice(1); this.pathIdx = 0; }
        }
      }
      const arrived = this.followPath(dt, CONFIG.manager.speed);
      if (arrived) {
        this.state = 'intervening';
        this.interveneTimer = CONFIG.manager.interveneTime;
      }
      this.animate(dt, this.rig);
      this.group.position.copy(this.pos);
      this.group.rotation.y = this.facing;
      return;
    }
    if (this.state === 'intervening') {
      this.interveneTimer -= dt;
      this.animate(dt, this.rig);
      this.group.position.copy(this.pos);
      if (this.interveneTimer <= 0) {
        const t = this.target;
        if (t) game.applyManagerIntervention(t);
        this.target = null;
        this.state = 'returning';
        this.repathHome();
      }
      return;
    }
    if (this.state === 'returning') {
      const arrived = this.followPath(dt, CONFIG.manager.speed);
      if (arrived) this.state = 'idle';
      this.animate(dt, this.rig);
      this.group.position.copy(this.pos);
      this.group.rotation.y = this.facing;
    }
  }

  repathHome() {
    const path = this.grid.findPath(this.cell, this.homeTile);
    if (path) { this.path = path.slice(1); this.pathIdx = 0; } else this.state = 'idle';
  }
}

// ---------------------------------------------------------------------------
// 路人（对应策划案 7）
// ---------------------------------------------------------------------------
export class Pedestrian extends Agent {
  constructor(grid, tile, goal, delay = CONFIG.pedestrian.startDelay ?? 0) {
    super(grid, tile);
    this.goal = goal;
    this.state = 'walking';
    this.waitTimer = 0;
    this.safe = false;
    // 开局驻足时间：先站一会儿，等烟雾积累起来再动身
    this.startTimer = delay;
    // 身处烟雾中的抱怨 / 愤怒状态（对应“路人在烟雾中会抱怨，超时会愤怒”）
    this.inSmoke = false;      // 当前所处浓度是否达到抱怨阈值
    this.smokeLevel = 0;       // 当前所处浓度
    this.smokeTime = 0;        // 连续处于烟雾中的累计秒数
    this.angry = false;        // 是否已愤怒（头顶冒火）
    this.complainTimer = 0;    // 下一次抱怨的倒计时
    this.bubbleText = '';      // 头顶说话气泡的内容
    this.bubbleTimer = 0;      // 气泡剩余显示时间（秒）
    this.calmTimer = 0;        // 愤怒后脱离烟雾的平复计时
    this.flameT = 0;           // 火焰动画相位
    const rig = makeCharacter({ cloth: P.pedCloth, hair: 0x554034, scale: 0.94 });
    this.rig = rig;
    this.group = rig.group;
    this.group.position.copy(this.pos);
    // 头顶火焰标识：愤怒时才显示
    this.flame = makeFlame();
    this.flame.position.set(0, 1.24, 0);
    this.flame.visible = false;
    this.group.add(this.flame);
    this.repath();
  }

  repath() {
    const path = this.grid.findPath(this.cell, this.goal, { avoidSmoke: CONFIG.pedestrian.smokeAvoid });
    if (path) { this.path = path.slice(1); this.pathIdx = 0; return true; }
    return false;
  }

  /** 前方是否危险（对应 7.1 受到烟雾影响） */
  aheadDangerous() {
    if (!this.path || this.pathIdx >= this.path.length) return false;
    const look = Math.min(this.path.length - 1, this.pathIdx + 2);
    for (let i = this.pathIdx; i <= look; i++) {
      const n = this.path[i];
      if (this.grid.smokeAt(n.x, n.z) > CONFIG.pedestrian.smokeAvoid) return true;
    }
    return false;
  }

  /** 当前这格是不是浓烟：站在里面就走不动 */
  smokeHere() {
    return this.grid.smokeAtWorld(this.pos.x, this.pos.z) >= (CONFIG.pedestrian.blockSmoke ?? 1);
  }

  update(dt, game) {
    if (this.safe) { this.animate(dt, this.rig); return; }
    this.updateSmokeState(dt, game);

    if (this.state === 'guiding') {
      // 跟随玩家（对应 7.2 对特定路人执行引导）
      // 注意：跟随途中依然会累计烟雾暴露（见 updateSmokeState），走进烟里一样会抱怨 / 愤怒
      const p = game.player.pos;
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      if (d > 1.2) {
        const ang = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
        const nx = this.pos.x + Math.sin(ang) * CONFIG.pedestrian.followSpeed * dt;
        const nz = this.pos.z + Math.cos(ang) * CONFIG.pedestrian.followSpeed * dt;
        const c = this.grid.cellOf(nx, nz);
        if (this.grid.isWalkable(c.x, c.z)) { this.pos.x = nx; this.pos.z = nz; }
        this.facing = ang;
        this.moving = true;
      } else this.moving = false;
      // 玩家把路人带到出口即可
      const pc = this.grid.cellOf(this.pos.x, this.pos.z);
      if (this.grid.charAt(pc.x, pc.z) === 'D') this.becomeSafe(game);
      this.animate(dt, this.rig);
      this.group.position.copy(this.pos);
      this.group.rotation.y = this.facing;
      return;
    }

    if (this.state === 'affected') {
      this.waitTimer -= dt;
      if (this.waitTimer <= 0) {
        // 重规划后仍然被烟挡住就继续等，不来回切换状态（避免反复弹提示）
        const ok = this.repath() && !this.aheadDangerous() && !this.smokeHere();
        if (ok) { this.state = 'walking'; game.onPedestrianReroute?.(this); }
        else this.waitTimer = CONFIG.pedestrian.affectedWait;
      }
      this.moving = false;
      this.animate(dt, this.rig);
      this.group.position.copy(this.pos);
      return;
    }

    // 开局现在原地驻足：给烟雾积累的时间，否则路人会赶在烟形成前走掉
    if (this.startTimer > 0) {
      this.startTimer -= dt;
      this.moving = false;
      this.animate(dt, this.rig);
      this.group.position.copy(this.pos);
      this.group.rotation.y = this.facing;
      return;
    }

    // walking：身处浓烟 / 前方有烟 → 被挡住，停下重规划
    if (this.smokeHere() || this.aheadDangerous()) {
      this.state = 'affected';
      this.waitTimer = CONFIG.pedestrian.affectedWait;
      game.onPedestrianAffected?.(this);
      this.moving = false;
      this.animate(dt, this.rig);
      this.group.position.copy(this.pos);
      return;
    }
    const arrived = this.followPath(dt, CONFIG.pedestrian.speed);
    if (arrived) this.becomeSafe(game);
    this.animate(dt, this.rig);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.facing;
  }

  /** 身处烟雾中的抱怨与愤怒：连续暴露超时 → 头顶冒火（愤怒） */
  updateSmokeState(dt, game) {
    const C = CONFIG.pedestrian;
    this.smokeLevel = this.grid.smokeAtWorld(this.pos.x, this.pos.z);
    this.inSmoke = this.smokeLevel >= (C.complainSmoke ?? 0.08);
    if (this.bubbleTimer > 0) this.bubbleTimer -= dt;

    if (this.inSmoke) {
      this.smokeTime += dt;
      this.calmTimer = 0;
      if (!this.angry) {
        // 每隔 complainInterval 抱怨一次：抱怨只显示在角色头顶（见 game.updateLabels）
        this.complainTimer -= dt;
        if (this.complainTimer <= 0) {
          this.complainTimer = C.complainInterval ?? 5;
          const lines = C.complaints || [];
          this.bubbleText = lines.length ? lines[Math.floor(Math.random() * lines.length)] : '咳…好呛。';
          this.bubbleTimer = C.complainBubbleTime ?? 3;
        }
        if (this.smokeTime >= (C.angerExposureTime ?? 15)) this.becomeAngry(game);
      }
    } else if (this.angry) {
      // 脱离烟雾后的平复（angerCalmTime = 0 表示不再平复）
      this.calmTimer += dt;
      if ((C.angerCalmTime ?? 0) > 0 && this.calmTimer >= C.angerCalmTime) {
        this.angry = false;
        this.smokeTime = 0;
        this.calmTimer = 0;
        this.complainTimer = 0;
        this.flame.visible = false;
        game.onPedestrianCalm?.(this);
      }
    } else {
      this.smokeTime = 0;
      this.complainTimer = 0;
    }
    this.updateFlame(dt);
  }

  becomeAngry(game) {
    this.angry = true;
    this.flame.visible = true;
    game.onPedestrianAngry?.(this);
  }

  /** 火焰抖动 / 旋转动画 */
  updateFlame(dt) {
    if (!this.flame.visible) return;
    this.flameT += dt;
    const f = 0.9 + Math.sin(this.flameT * 24) * 0.12 + Math.sin(this.flameT * 39 + 1.3) * 0.06;
    this.flame.scale.set(1, f, 1);
    this.flame.rotation.y = this.flameT * 3.4;
  }

  becomeSafe(game) {
    this.safe = true;
    this.flame.visible = false;
    game.onPedestrianSafe?.(this);
    this.group.visible = false;
  }

  startGuide() { this.state = 'guiding'; this.path = null; }

  /** 取消跟随：恢复自己前往出口的路线 */
  stopGuide() {
    this.state = this.repath() ? 'walking' : 'affected';
    if (this.state === 'affected') this.waitTimer = CONFIG.pedestrian.affectedWait;
    this.moving = false;
  }
}

// ---------------------------------------------------------------------------
// 通风设备（对应策划案 5）
// ---------------------------------------------------------------------------
export class VentDevice {
  constructor(levelVent, tile) {
    this.tile = tile;
    this.on = !!levelVent.on;
    this.power = this.on ? 1 : 0;     // 平滑后的实际通风强度
    this.pending = null;              // {target, timer}
  }

  get active() { return this.power > 0.05; }
  get strength() { return this.power; }

  toggle(immidiate = false) {
    if (this.pending) return false;
    this.pending = { target: !this.on, timer: immidiate ? 0 : CONFIG.vent.operateTime };
    return true;
  }

  setOn(on, delay = 0) {
    this.on = on;
    this.pending = { target: on, timer: delay };
  }

  update(dt) {
    if (this.pending) {
      this.pending.timer -= dt;
      if (this.pending.timer <= 0) {
        this.on = this.pending.target;
        this.pending = null;
      }
    }
    const goal = this.on ? 1 : 0;
    const rate = this.on ? 1 / CONFIG.vent.startupDelay : 1 / 1.6;
    this.power += (goal - this.power) * Math.min(1, dt * rate * 2.2);
    if (Math.abs(this.power - goal) < 0.01) this.power = goal;
  }

  get busy() { return !!this.pending; }
}

// ---------------------------------------------------------------------------
// 提示牌（对应策划案 6）
// ---------------------------------------------------------------------------
export class Sign {
  constructor(cell, angle) {
    this.cell = { ...cell };
    this.angle = angle;        // 面朝方向（弧度，0 = +Z）
    this.group = null;
    this.arrowFlat = null;
  }

  /** 是否指向吸烟区（用于判断“方向错误”） */
  evaluate(areaCenter) {
    if (!areaCenter) { this.correct = true; this.pointsToSmoking = true; return; }
    const g = { x: this.cell.x, z: this.cell.z };
    const dx = areaCenter.x - g.x;
    const dz = areaCenter.z - g.z;
    const len = Math.hypot(dx, dz) || 1;
    const dirX = Math.sin(this.angle);
    const dirZ = Math.cos(this.angle);
    const dot = (dx / len) * dirX + (dz / len) * dirZ;
    this.pointsToSmoking = dot > 0.45;
    this.correct = this.pointsToSmoking;
    return this.correct;
  }

  get isVisible() { return true; }
}

export function angleToArea(cell, areaCenter) {
  if (!areaCenter) return 0;
  const dx = areaCenter.x - cell.x;
  const dz = areaCenter.z - cell.z;
  return Math.atan2(dx, dz);
}

// ---------------------------------------------------------------------------
// 辅助装备（对应策划案 12.3）：只改变玩家面临的压力，不直接解决 NPC
// ---------------------------------------------------------------------------
export const EQUIP_LABEL = {
  purifier: '空气净化器',
  fan: '便携风扇',
  barrier: '临时隔离挡板',
  bat: '棒球棍',
};

export class Equip {
  constructor(type, tile, angle = 0) {
    this.type = type;
    this.tile = { ...tile };
    this.angle = angle;
    const spec = CONFIG.equip[type] || {};
    this.power = spec.power ?? 60;
    this.powerRemaining = this.power;
    this.group = null;
    this.halo = null;
    this.fan = null;
  }

  // 挡板不耗电；净化器 / 风扇需要电力（对应 12.3）
  get active() { return this.type === 'barrier' ? true : this.powerRemaining > 0; }
  get powerRatio() { return this.power > 0 ? Math.max(0, this.powerRemaining / this.power) : 0; }

  update(dt) {
    if (this.type === 'barrier') return;
    if (this.powerRemaining > 0) this.powerRemaining = Math.max(0, this.powerRemaining - dt);
  }

  addPower(sec) {
    if (this.type === 'barrier') return;
    this.powerRemaining = Math.min(this.power, this.powerRemaining + sec);
  }

  dispose() { if (this.group && this.group.parent) this.group.parent.remove(this.group); }
}