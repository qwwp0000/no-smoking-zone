import * as THREE from 'three';
import { CONFIG, PALETTE as P } from './config.js';
import { LEVELS, ACTION_META } from './levels.js';
import { Grid } from './grid.js';
import { createRenderer, createScene, createCamera, computeDistance, isoCameraTarget, activityBounds, World, buildEquipGroup } from './world.js';
import { Player, NPC, Manager, Pedestrian, VentDevice, Sign, Equip, EQUIP_LABEL, NPC_STATE_LABEL, angleToArea } from './entities.js';
import { ArgueFight } from './argue.js';
import { computeWindows } from './windows.js';
import { sfx } from './audio.js';
import { createDevPanel } from './devpanel.js';
import { initUITune } from './uitune.js';

const $ = (id) => document.getElementById(id);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// 关卡可用机制（解锁顺序即机制首次出现时讲解卡片的顺序）
// record/investigate 为"模式"操作，留在底部操作栏按关卡显隐；shop 按钮常驻；
// rotate/vent/manager/guide/equip 等交互改为靠近目标时的头顶提示或物品栏拖拽。
const GATED_ACTIONS = ['rotate', 'vent', 'manager', 'record', 'investigate', 'guide', 'equip', 'shop'];
const ACTION_BTN_ID = {
  record: 'btn-record',
  investigate: 'btn-investigate',
};

// 用一次性离屏渲染器生成道具缩略图（避免额外 WebGL 上下文常驻）
function makeEquipThumbs(types) {
  const out = {};
  const size = 96;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { return out; }
  renderer.setSize(size, size);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
  cam.position.set(1.7, 1.5, 1.9);
  cam.lookAt(0, 0.5, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(3, 6, 5);
  scene.add(key);
  for (const t of types) {
    const { group } = buildEquipGroup(t);
    scene.add(group);
    renderer.render(scene, cam);
    out[t] = renderer.domElement.toDataURL('image/png');
    scene.remove(group);
  }
  renderer.dispose();
  return out;
}

// ---------------------------------------------------------------------------
// 跨关卡存档：积分 / 已购装备 / 核心工具升级 / 已修复的环境问题
// （对应策划案 14.3 调查的长期价值、15.4 评分→商店→关卡闭环）
// ---------------------------------------------------------------------------
const SAVE_KEY = 'nsa_save_v3';
function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || null; } catch { return null; }
}
function writeSave(s) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* 忽略隐私模式等 */ }
}

// 商店条目说明（对应策划案 12.3 / 15.3）
const SHOP_DESC = {
  fan: '把面前的烟雾朝吸烟区方向推走，风扇所在的一带会变干净。',
  purifier: '清除周围烟雾，形成一小块洁净区。',
  battery: '为已部署的净化器 / 风扇补充 30 秒电力（场上没有设备时无法购买）。',
  signPro: '永久强化：提示牌作用范围更大。',
  barrier: '阻断烟雾扩散（自身及上下左右相邻各 1 格），守住一处路口。',
  bat: '携带后按鼠标右键攻击一格内的吸烟者：击退两格并让他停止吸烟 5 秒，身边的烟消散更快。注意别被他抓住。',
};

// 愤怒值状态文案（对应策划案 13.1）
const ANGER_LABEL = { calm: '冷静', rising: '愤怒上升', brink: '濒临失控' };

// ---------------------------------------------------------------------------
// UI 小工具
// ---------------------------------------------------------------------------
const toastStack = $('toast-stack');
function toast(text, kind = 'info', seconds = 4) {
  const el = document.createElement('div');
  el.className = `toast card ${kind}`;
  el.textContent = text;
  toastStack.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(14px)';
    setTimeout(() => el.remove(), 320);
  }, seconds * 1000);
}

const hintEl = $('hint');
let hintTimer = 0;
function setHint(text, seconds = 3.2) {
  if (!text) { hintEl.classList.remove('show'); return; }
  hintEl.textContent = text;
  hintEl.classList.add('show');
  hintTimer = seconds;
}

// ---------------------------------------------------------------------------
// 新手提示：居中大卡片，点击逐条播放，同一局内每条只触发一次
// ---------------------------------------------------------------------------
const tutEl = $('tutorial');
const tutTextEl = $('tut-text');
const tutCountEl = $('tut-count');
const tutNextEl = $('tut-next');
const seenTutorials = new Set();   // 同一局（本次页面运行）内已展示过的提示 key
// 话术对辩的「手把手」教学是否已经跑过一次（同一局只教一次）
let argueTutorialDone = false;
const tutorialQueue = [];          // 待播放的提示队列
let tutShownAt = 0;                // 本次弹出时刻，避免开卡瞬间被同一次点击跳过

function isTutorialOpen() { return tutEl.classList.contains('show'); }

function renderTutorial() {
  if (!tutorialQueue.length) { tutEl.classList.remove('show'); return; }
  const cur = tutorialQueue[0];
  tutTextEl.textContent = cur.text;
  tutCountEl.textContent = tutorialQueue.length > 1 ? `还有 ${tutorialQueue.length - 1} 条` : '点击任意处继续';
  tutNextEl.textContent = tutorialQueue.length > 1 ? '继续 ▸' : '知道了';
  if (!isTutorialOpen()) tutShownAt = performance.now();
  tutEl.classList.add('show');
}

function advanceTutorial() {
  if (!isTutorialOpen() || performance.now() - tutShownAt < 200) return;
  tutorialQueue.shift();
  renderTutorial();
  // 全部读完：执行挂起的回调（出击准备商店再此弹出，避免依赖主循环）
  if (!tutorialQueue.length && onTutorialsDrained) {
    const fn = onTutorialsDrained;
    onTutorialsDrained = null;
    fn();
  }
}

// 记录并排队一条新手提示；同一局内相同 key 只出现一次
// 第 5 关起（CONFIG.guide.nonBlockingFromLevel）改为非阻塞提示：
// 模态卡片会暂停主循环，会冻结话术对辩的计时与掉血，必须避免（对应策划案 21.7）。
let tutorialNonBlocking = false;
// 教学卡片全部读完后要执行的回调（如第 4 关读完出击准备教学后弹出商店）
let onTutorialsDrained = null;

function tutorial(key, text) {
  if (!text || seenTutorials.has(key)) return;
  seenTutorials.add(key);
  if (tutorialNonBlocking) {
    toast(text, 'info', 6.5);
    setHint(text, 6);
    return;
  }
  tutorialQueue.push({ key, text });
  renderTutorial();
}

// ---------------------------------------------------------------------------
// 主游戏
// ---------------------------------------------------------------------------
class Game {
  constructor() {
    this.levelIndex = 0;
    this.state = 'playing';
    this.time = 0;
    this.fps = 60;

    const app = $('app');
    this.canvas = document.createElement('canvas');
    app.appendChild(this.canvas);

    this.renderer = createRenderer(this.canvas);
    this.scene = createScene();
    this.world = new World(this.scene);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    // 用于点击地面的数学平面（比隐形网格更可靠）
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hitPoint = new THREE.Vector3();

    this.labels = new Map();
    this.usedLabels = new Set();
    this.seenActions = new Set();   // 已经解锁过的操作按钮，用于判断"首次出现"
    this.pendingAction = null;
    this.selectManagerTarget = false;
    this.negotiatingWith = null;
    this.dialogOpen = false;
    // 物品栏拖拽放置状态
    this.dragType = null;
    this.dragCell = null;
    this.ghost = null;
    this.placeTileHint = null;
    this.equipThumbs = {};
    this.negotiateLock = false;
    // 话术对辩（三级 NPC-2，对应策划案 21）
    this.argue = null;
    this.argueNpc = null;
    this.argueOpen = false;
    this.debugOn = false;
    this.debugAcc = 0;
    this.lastCamDistance = 0;

    // 相机基准位置与低血量震动状态：震动叠加在基准位置上，避免与跟随插值互相干扰
    this.camBase = new THREE.Vector3();
    this.shakePhase = 0;
    this.shakeAmp = 0;
    this.shakeFreq = 0;
    this.shakeRot = 0;
    // 血条（HUD）抖动状态，与画面抖动共用同一套判定逻辑
    this.barShakePhase = 0;
    this.barShakeAmp = 0;
    this.barShakeFreq = 0;
    // 低血量咳嗽音效状态（黄条 Cough1 / 红条 Cough2）
    this.coughTimer = 0;
    this.coughTier = 0;

    // --- 跨关卡成长状态（对应策划案 15.4） ---
    const save = loadSave();
    this.points = save?.points ?? CONFIG.economy.startPoints;
    // 道具所有权：每个道具只能买一次；本关「使用」过的道具下关需重新购买
    // （兼容旧存档：v3 的 inventory 计数 > 0 视为已拥有）
    this.owned = new Set(save?.owned
      ?? (save?.inventory ? Object.keys(save.inventory).filter((k) => save.inventory[k] > 0) : []));
    this.upgrades = save?.upgrades ?? {};        // 已购买的核心工具升级（如 signPro）
    this.envFixes = save?.envFixes ?? [];        // 已修复的环境问题（跨关卡长期生效）
    this.clearedLevels = save?.clearedLevels ?? [];  // 已通关的关卡 id
    this.carried = [];                           // 本关携带的道具 id（最多 maxCarry 个）
    this.usedThisLevel = new Set();              // 本关实际部署使用过的道具 id
    this.boughtThisLevel = new Set();            // 本关已购买的「购买即消耗」道具
    this.shopMode = 'browse';                    // browse=关卡中查看 / loadout=出击准备
    this.shopOpen = false;
    this.recordBusy = false;
    this.investigateBusy = false;
    // 棒球棍：被打过的目标 / 危险半径内累计时间 / 当前是否处于危险中
    this.batTarget = null;
    this.batDanger = 0;
    this.batDangerOn = false;

    // 道具缩略图（物品栏用）+ 拖拽事件的稳定引用（须在 loadLevel 前就绪）
    this.equipThumbs = makeEquipThumbs(['purifier', 'fan', 'barrier', 'bat']);
    this._dragMove = (ev) => this.onDragMove(ev);
    this._dragUp = (ev) => this.onDragUp(ev);

    this.loadLevel(0);
    this.bindEvents();
    this.onResize(); // 初始化时先把画布尺寸对齐窗口，否则 canvas 会停留在默认 300×150

    // 界面布局调试台：必须在 devPanel 之前初始化（面板要读它保存的位置/大小）
    this.uiTune = initUITune();
    this.devPanel = createDevPanel(this);

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
    window.__GAME_BOOTED__ = true;
  }

  // -------------------------------------------------------------------------
  // 关卡
  // -------------------------------------------------------------------------
  loadLevel(index) {
    // 只有真正换关才结算「本关使用过」的道具；重试本关不结算，但保留使用记录，
    // 否则「用过→故意重开本关」就能白嫖，绕过“下关需重购”的规则。
    if (index !== this.levelIndex) {
      this.consumeUsedProps();
      this.usedThisLevel = new Set();
    }
    this.levelIndex = index;
    this.level = LEVELS[index];
    // 本关购买记录每次进入都清空（购买即消耗的道具可再次购买）
    this.boughtThisLevel = new Set();
    // 默认带上仍拥有的可携带道具（最多 maxCarry 个）
    this.carried = this.carryableOwned().slice(0, CONFIG.loadout.maxCarry);
    // 第 5 关起取消“点击才继续”的模态引导（对应策划案 21.7 / 决策 4）
    tutorialNonBlocking = this.level.id >= CONFIG.guide.nonBlockingFromLevel;
    this.grid = new Grid(this.level.map);

    // --- 窗户（第 1~4 关）：四面墙随机选两面开窗，窗前为无烟洁净区 ---
    this.windows = (this.level.id >= CONFIG.window.fromLevel && this.level.id <= CONFIG.window.toLevel)
      ? computeWindows(this.grid)
      : [];
    this.grid.setWindows(this.windows);

    // 调查带来的长期环境改善（对应策划案 14.3）：修复过的空间问题在后续关卡持续生效
    this.recordNeed = Math.max(1, CONFIG.record.need - this.envFixes.filter((f) => f.type === 'management').length);
    this.envBoost = {
      signRadiusMul: 1 + 0.15 * this.envFixes.filter((f) => f.type === 'layout').length,
    };

    this.world.clear();
    this.world.build(this.grid, this.level, this.windows);

    this.smokingTiles = this.grid.allTilesOf('S');
    const areaCenter = this.smokingTiles.length
      ? {
        x: this.smokingTiles.reduce((a, t) => a + t.x, 0) / this.smokingTiles.length,
        z: this.smokingTiles.reduce((a, t) => a + t.z, 0) / this.smokingTiles.length,
      }
      : { x: this.grid.w / 2, z: this.grid.h / 2 };
    this.areaCenter = areaCenter;

    // --- 提示牌（仅地图预置，玩家不可再放置） ---
    this.signs = [];
    const plusTiles = this.grid.allTilesOf('+');
    const minusTiles = this.grid.allTilesOf('-');
    plusTiles.forEach((t) => this.addSign(t, angleToArea(t, areaCenter)));
    minusTiles.forEach((t) => {
      const sign = this.addSign(t, angleToArea(t, areaCenter) + Math.PI);
      sign.needsFix = true;
    });

    // --- 通风 ---
    this.vents = [];
    const ventTiles = this.grid.allTilesOf('V');
    (this.level.vents || []).forEach((v, i) => {
      const tile = ventTiles[i] || ventTiles[0];
      if (!tile) return;
      const dev = new VentDevice(v, tile);
      const anchor = this.world.anchors.vents[i] || this.world.anchors.vents[0];
      dev.group = anchor ? anchor.group : null;
      this.vents.push(dev);
    });
    this.ventScript = (this.level.ventScript || []).map((s) => ({ ...s, done: false }));

    // --- 教学关的门（走到门前按 E / 点击即可开门进入下一关） ---
    this.door = null;
    this.doorOpenTimer = 0;
    if (this.level.door && this.world.anchors.door) {
      const dt = this.grid.allTilesOf('D')[0];
      if (dt) {
        const w = this.grid.worldOf(dt.x, dt.z);
        this.door = { cell: dt, wx: w.x, wz: w.z, open: false };
      }
    }

    // 清理上一关 / 上一次重开残留的角色模型。
    // 角色是直接挂在 scene 上的（不在 world.root 里），world.clear() 清不掉，
    // 若不主动移除，旧关卡的角色会留在场景里，变成站着不动的“装饰路人”。
    for (const g of [
      this.player?.group,
      ...(this.npcs || []).map((n) => n.group),
      this.manager?.group,
      ...(this.pedestrians || []).map((p) => p.group),
    ]) {
      if (g && g.parent) g.parent.remove(g);
    }

    // --- 玩家 ---
    const pTile = this.grid.marks['P']?.[0] || { x: 1, z: 1 };
    this.player = new Player(this.grid, pTile);
    this.scene.add(this.player.group);

    // --- NPC ---
    this.npcs = [];
    for (const lv of [1, 2, 3]) {
      for (const t of this.grid.marks[String(lv)] || []) {
        const npc = new NPC(this, t, lv);
        this.npcs.push(npc);
        this.scene.add(npc.group);
      }
    }
    // 三级 NPC-2（争论型）：地图标记 A（对应策划案 3.7 / 21，等级仍属三级）
    for (const t of this.grid.marks['A'] || []) {
      const npc = new NPC(this, t, 3, 'argue');
      this.npcs.push(npc);
      this.scene.add(npc.group);
    }

    // --- 管理人员 ---
    const mTile = this.grid.marks['M']?.[0] || null;
    this.manager = mTile ? new Manager(this.grid, mTile) : null;
    if (this.manager) {
      this.manager.rig.group.userData.kind = 'manager';
      this.scene.add(this.manager.group);
    }

    // --- 路人 ---
    this.pedestrians = [];
    const pTiles = this.grid.allTilesOf('p');
    (this.level.pedestrians || []).forEach((pd, i) => {
      const tile = pTiles[i] || pTiles[0];
      if (!tile) return;
      const ped = new Pedestrian(this.grid, tile, pd.goal, pd.delay ?? CONFIG.pedestrian.startDelay);
      this.pedestrians.push(ped);
      this.scene.add(ped.group);
    });
    this.pedSafe = 0;

    // --- 状态 ---
    this.time = 0;
    this.levelTime = 0;
    this.state = 'playing';
    this.hintIndex = 0;
    this.usedHints = new Set();
    this.pendingAction = null;
    this.selectManagerTarget = false;
    this.negotiatingWith = null;
    // 拖拽放置状态复位
    this.endDrag();
    // 话术对辩状态复位
    if (this.argue) this.argue.destroy();
    this.argue = null;
    this.argueNpc = null;
    this.argueOpen = false;
    this.recordBusy = false;
    this.investigateBusy = false;
    // 棒球棍状态复位（换关 / 重开都要清）
    this.batTarget = null;
    this.batDanger = 0;
    this.batDangerOn = false;
    this.equips = [];
    this.violationMarks = new Map();   // cellKey -> { cell, count } 反复违规点
    this.investigated = new Set();     // 已调查过的点
    this.closeDialog();
    this.stats = {
      pedSafe: 0, signFixed: false, ventOnAtEnd: false, ventToggled: false,
      records: 0, investigations: 0, wastedReminds: 0, peakExposure: 0,
    };
    this.objectives = this.level.objectives.map((o) => ({ ...o, done: false }));
    $('overlay').classList.remove('show');

    // --- 相机 ---
    const aspect = window.innerWidth / window.innerHeight;
    this.activityBounds = activityBounds(this.grid);
    if (!this.camera) this.camera = createCamera(aspect, this.grid);
    else this.camera.userData.distance = computeDistance(this.grid, aspect);
    this.camDistance = this.camera.userData.distance;
    this.camFocus = new THREE.Vector3(0, 0, 0);
    this.snapCamera();

    this.ventPowerState = { ventPower: this.vents.map((v) => v.power) };
    this.updateHUD();
    this.updateObjectivesHUD();
    $('level-title').textContent = this.level.title;
    $('level-sub').textContent = this.level.sub;
    this.updateActionButtons();
    tutorial(`tip-${this.level.id}`, this.level.tip);
    this.applyLevelActions();
    // 出击准备：第 4 关起，教学读完后弹出商店选购 / 携带道具（不依赖主循环）
    onTutorialsDrained = null;
    if (this.level.id >= CONFIG.loadout.openFromLevel || this.isUnlocked('shop')) {
      tutorial(`loadout-${this.level.id}`, this.level.tutorial.onLoadout);
      if (tutorialQueue.length) onTutorialsDrained = () => this.openLoadout();
      else this.openLoadout();
    }
    this.attachEntityRefs();
  }

  // 按关卡显隐全局/模式类按钮；机制首次出现的关卡排队一条讲解卡片
  applyLevelActions() {
    const avail = new Set(this.level.actions || []);
    // 商店按钮常驻：任何关卡都能点击打开（不再依赖关卡解锁或键盘 X）
    const shopEl = $('btn-shop');
    if (shopEl) shopEl.classList.remove('hidden');
    for (const id of Object.keys(ACTION_BTN_ID)) {
      const el = $(ACTION_BTN_ID[id]);
      if (el) el.classList.toggle('hidden', !avail.has(id));
    }
    for (const id of GATED_ACTIONS) {
      if (!avail.has(id) || this.seenActions.has(id)) continue;
      this.seenActions.add(id);
      const meta = ACTION_META[id];
      if (meta) tutorial(`act-${id}`, meta.guide);
    }
  }

  attachEntityRefs() {
    for (const npc of this.npcs) npc.group.userData.kind = 'npc';
    for (const ped of this.pedestrians) ped.group.userData.kind = 'pedestrian';
    for (const v of this.vents) v.group.userData.kind = 'vent';
    if (this.world.anchors.booth) this.world.anchors.booth.group.userData.kind = 'booth';
  }

  addSign(tile, angle) {
    const sign = new Sign(tile, angle);
    sign.preregistered = true;
    sign.evaluate(this.areaCenter);           // 先判定朝向是否正确
    sign.correct = sign.pointsToSmoking;
    this.world.addSign(sign);                 // 用 correct 决定配色
    sign.visible = this.computeSignVisible(sign);
    sign.correct = sign.pointsToSmoking && sign.visible;
    sign.posQuality = this.computeSignQuality(sign);
    this.refreshSignRadius(sign);
    this.world.refreshSign(sign);
    sign.group.userData.kind = 'sign';
    this.signs.push(sign);
    return sign;
  }

  // -------------------------------------------------------------------------
  // 输入
  // -------------------------------------------------------------------------
  bindEvents() {
    window.addEventListener('resize', () => { this.onResize(); this.uiTune?.clampAll(); });
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => {
      this.keys?.delete(e.code);
    });
    this.keys = new Set();
    // 任意用户交互即解锁音频并开始循环播放背景音乐（浏览器要求用户手势后才能播放）。
    // 用捕获阶段监听多种事件，确保点到任何 UI 元素也能触发；unlock/playBgm 幂等，重复调用无副作用，
    // 因此监听常驻，玩家首次点按后仍可兜底其它被自动播放策略拦截的情况。
    const kickAudio = () => sfx.unlock();
    for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click']) {
      window.addEventListener(ev, kickAudio, true);
    }
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    // 棒球棍用鼠标右键攻击：屏蔽画布右键菜单，避免弹出上下文菜单
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    tutEl.addEventListener('click', () => advanceTutorial());

    $('btn-record').onclick = () => this.actionRecord();
    $('btn-investigate').onclick = () => this.actionInvestigate();
    $('btn-shop').onclick = () => this.actionShop();
    $('shop-close').onclick = () => this.closeShop();
    $('shop-start').onclick = () => this.startFromLoadout();
    $('res-retry').onclick = () => this.loadLevel(this.levelIndex);
    $('res-next').onclick = () => {
      if (this.levelIndex + 1 < LEVELS.length) this.loadLevel(this.levelIndex + 1);
      else this.loadLevel(1);   // 全部通关后回到第 1 关（跳过第 0 关走路教学）
    };
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.userData.distance = computeDistance(this.grid, this.camera.aspect);
    this.camDistance = this.camera.userData.distance;
    this.camera.updateProjectionMatrix();
  }

  onKeyDown(e) {
    // 焦点在调试台输入框时，不触发游戏快捷键
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    // 话术对辩中：Esc 退出、数字键 1/2/3 出牌，其余快捷键屏蔽（对应策划案 21.2 / 21.5）
    if (this.argueOpen) {
      if (e.code === 'Escape') { e.preventDefault(); this.argue?.exit(); }
      else if (e.code === 'Digit1' || e.code === 'Numpad1') this.argue?.play(0);
      else if (e.code === 'Digit2' || e.code === 'Numpad2') this.argue?.play(1);
      else if (e.code === 'Digit3' || e.code === 'Numpad3') this.argue?.play(2);
      return;
    }
    // 新手提示打开时，任意继续键用于翻到下一条
    if (isTutorialOpen()) {
      if (['Space', 'Enter', 'NumpadEnter', 'Escape'].includes(e.code)) {
        e.preventDefault();
        advanceTutorial();
      }
      return;
    }
    // 商店打开时：只响应 B / Esc（关闭或开始关卡），屏蔽其他快捷键以免误操作
    if (this.shopOpen) {
      if (e.code === 'KeyB' || e.code === 'Escape') { e.preventDefault(); this.closeShop(); }
      return;
    }
    if (['Tab'].includes(e.key)) e.preventDefault();
    if (e.repeat) { if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) this.keys.add(e.code); return; }
    this.keys.add(e.code);
    switch (e.code) {
      // E 为统一交互键：按就近目标分派到 提醒 / 开关通风 / 申请管理介入
      case 'KeyE': sfx.unlock(); sfx.keyE(); this.actionInteract(); break;
      case 'KeyF': this.actionVent(); break;
      case 'KeyM': this.actionManager(); break;
      case 'KeyR': this.actionRotate(); break;
      case 'KeyG': this.actionGuide(); break;
      case 'KeyT': this.actionRecord(); break;
      case 'KeyC': this.actionInvestigate(); break;
      case 'KeyB': this.actionShop(); break;
      case 'Tab': this.debugOn = !this.debugOn; $('debug').classList.toggle('show', this.debugOn); break;
      case 'Escape':
        if (this.dialogOpen) this.closeDialog();
        else if (this.dragType) this.endDrag();
        else if (this.selectManagerTarget) { this.selectManagerTarget = false; this.updateActionButtons(); }
        break;
      default: break;
    }
  }

  /** E：按就近目标分派交互（吸烟者提醒 / 通风设备 / 管理者介入） */
  actionInteract() {
    if (this.state !== 'playing') return;
    if (this.dialogOpen || this.argueOpen || this.shopOpen) return;
    const px = this.player.pos.x, pz = this.player.pos.z;
    const cands = [];
    for (const n of this.npcs) {
      if (n.state === 'atArea' || n.state === 'arguing') continue;
      const d = Math.hypot(px - n.pos.x, pz - n.pos.z);
      if (d <= 2.4) cands.push({ d, run: () => this.actionRemind(n) });
    }
    for (const v of this.vents) {
      const w = this.grid.worldOf(v.tile.x, v.tile.z);
      const d = Math.hypot(px - w.x, pz - w.z);
      if (d <= 2.6) cands.push({ d, run: () => this.actionVent(v) });
    }
    // 教学关的门
    if (this.door && !this.door.open) {
      const d = Math.hypot(px - this.door.wx, pz - this.door.wz);
      if (d <= 2.2) cands.push({ d: d - 0.01, run: () => this.openDoor() });
    }
    const booth = this.world.anchors.booth;
    if (this.manager) {
      const dMgr = Math.hypot(px - this.manager.pos.x, pz - this.manager.pos.z);
      if (dMgr <= CONFIG.manager.requestRange + 0.4) cands.push({ d: dMgr, run: () => this.actionManager() });
      if (booth) {
        const dB = Math.hypot(px - booth.wx, pz - booth.wz);
        if (dB <= CONFIG.manager.requestRange + 0.4) cands.push({ d: dB, run: () => this.actionManager() });
      }
    }
    if (!cands.length) {
      if (this.door && !this.door.open) { setHint('走到右边那扇门前，按 E 或直接点门。', 2.6); return; }
      this.actionRemind();
      return;
    }
    cands.sort((a, b) => a.d - b.d);
    cands[0].run();
  }

  onPointerDown(e) {
    // 界面拖动模式下，画布不响应，避免一边拖 UI 一边让角色走动
    if (this.uiTune?.isEditing()) return;
    // 鼠标右键：用棒球棍攻击附近的吸烟者
    if (e.button === 2) { this.tryBat(); return; }
    if (e.button !== 0) return;
    if (this.argueOpen) return;   // 对辩中：只通过界面/数字键操作
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // 优先命中实体
    const hit = this.pickEntity();
    if (hit) { this.tryInteract(hit.kind, hit.ref); return; }

    // 地面（数学平面求交）
    if (this.raycaster.ray.intersectPlane(this.groundPlane, this.hitPoint)) {
      const c = this.grid.cellOf(this.hitPoint.x, this.hitPoint.z);
      if (this.grid.isWalkable(c.x, c.z)) this.moveTo(c);
      else setHint('那边走不过去。', 1.6);
    }
  }

  pickEntity() {
    const targets = [this.player.group];
    for (const n of this.npcs) targets.push(n.group);
    for (const p of this.pedestrians) if (!p.safe) targets.push(p.group);
    for (const v of this.vents) if (v.group) targets.push(v.group);
    for (const s of this.signs) if (s.group) targets.push(s.group);
    for (const e of this.equips) if (e.group) targets.push(e.group);
    if (this.manager) targets.push(this.manager.group);
    if (this.world.anchors.booth) targets.push(this.world.anchors.booth.group);
    if (this.world.anchors.door) targets.push(this.world.anchors.door.group);

    const hits = this.raycaster.intersectObjects(targets, true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && !o.userData.kind) o = o.parent;
    if (!o) return null;
    const kind = o.userData.kind;
    let ref = null;
    if (kind === 'npc') ref = this.npcs.find((n) => n.group === o);
    else if (kind === 'pedestrian') ref = this.pedestrians.find((p) => p.group === o);
    else if (kind === 'vent') ref = this.vents.find((v) => v.group === o);
    else if (kind === 'sign') ref = this.signs.find((s) => s.group === o);
    else if (kind === 'equip') ref = o.userData.ref || this.equips.find((e) => e.group === o);
    else if (kind === 'manager') ref = this.manager;
    else if (kind === 'booth') ref = this.world.anchors.booth;
    else if (kind === 'door') ref = this.door;
    return { kind, ref, point: hits[0].point };
  }

  moveTo(cell) {
    const path = this.grid.findPath(this.player.cell, cell);
    if (path) {
      this.player.setPath(path);
      this.player.manual = false;
      this.pendingAction = null;
    }
  }

  // -------------------------------------------------------------------------
  // 交互动作
  // -------------------------------------------------------------------------
  distTo(worldVecOrTile) {
    const v = worldVecOrTile.isVector3 ? worldVecOrTile : null;
    if (v) return this.player.pos.distanceTo(v);
    const w = this.grid.worldOf(worldVecOrTile.x, worldVecOrTile.z);
    return Math.hypot(this.player.pos.x - w.x, this.player.pos.z - w.z);
  }

  nearestOf(list, range, getPos) {
    let best = null, bd = range;
    for (const item of list) {
      const pos = getPos(item);
      if (!pos) continue;
      const d = Math.hypot(this.player.pos.x - pos.x, this.player.pos.z - pos.z);
      if (d < bd) { bd = d; best = item; }
    }
    return best;
  }

  tryInteract(kind, ref) {
    if (this.selectManagerTarget && (kind === 'npc') && this.manager) {
      this.dispatchManager(ref);
      return;
    }
    switch (kind) {
      case 'npc': this.actionRemind(ref); break;
      case 'vent': this.actionVent(ref); break;
      case 'sign': this.actionRotate(ref); break;
      case 'pedestrian': this.actionGuide(ref); break;
      case 'booth': this.actionManager(); break;
      case 'equip': this.recycleEquip(ref); break;
      case 'manager': this.actionManager(); break;
      case 'door': this.openDoor(); break;
      default: break;
    }
  }

  tileOfRef(ref) {
    if (!ref) return null;
    if (ref.cell) return ref.cell;
    if (ref.tile) return ref.tile;
    if (ref.pos) return this.grid.cellOf(ref.pos.x, ref.pos.z);
    if (ref.isVector3) return this.grid.cellOf(ref.x, ref.z);
    if (typeof ref.x === 'number' && typeof ref.z === 'number') return ref;
    if (ref.wx !== undefined) return this.grid.cellOf(ref.wx, ref.wz);
    return null;
  }

  needApproach(ref, kind) {
    const tile = this.tileOfRef(ref);
    if (tile) {
      const w = this.grid.worldOf(tile.x, tile.z);
      const d = Math.hypot(this.player.pos.x - w.x, this.player.pos.z - w.z);
      if (d <= CONFIG.player.interactRange + 0.4) return false;
    }
    this.pendingAction = { kind, ref };
    if (tile) this.moveTo(this.grid.nearestWalkable(tile) || tile);
    setHint('正在靠近……', 1.8);
    return true;
  }

  /** E / 点击 NPC */
  actionRemind(explicit) {
    if (this.state !== 'playing') return;
    let npc = explicit;
    if (!npc) npc = this.nearestOf(this.npcs.filter((n) => n.state !== 'atArea'), 2.4, (n) => n.pos);
    if (!npc) { setHint('附近没有可交涉的吸烟者。', 2); return; }

    // 三级 NPC-2（争论型）：提醒只计数、绝不动身；满次数后进入话术对辩（对应策划案 21.1）
    if (npc.isArgue) {
      if (this.needApproach(npc, 'npc')) return;
      const res = npc.remind();
      if (res.result === 'argue') {
        // 直接进入对辩：首次进入时由 ArgueFight 在对辩界面内做「手把手」教学
        // （不使用会暂停主循环的模态卡，否则会冻结对辩计时与烟雾伤害）
        this.openArgument(npc);
        return;
      }
      if (res.result === 'cooldown') { toast(res.text, 'info', 4); setHint('他还在气头上，稍等一会儿再提醒。', 3); return; }
      toast(res.text, 'bad', 4.2);
      this.player.addAnger(CONFIG.anger.riseIgnore);
      this.stats.wastedReminds++;
      this.markViolation(npc);
      setHint('提醒对他没用——再提醒一次他就会跟你吵起来。', 3.4);
      // 给玩家心理预期：下一次提醒会进入话术对辩
      tutorial('argueWarn', this.level.tutorial.argueWarn);
      return;
    }

    if (npc.levelNum === 3) {
      if (this.needApproach(npc, 'npc')) return;
      this.openNegotiation(npc);
      return;
    }
    if (this.needApproach(npc, 'npc')) return;
    const res = npc.remind();
    toast(res.text, res.result === 'comply' ? 'good' : 'bad', 4.2);
    setHint('已提醒。注意确认他是否真的进入吸烟区。', 3.4);
    if (res.result === 'comply') tutorial(`l${this.level.id}-remind`, this.level.tutorial.onRemind);
    else if (res.result === 'ignore') {
      // 被无视：愤怒上升，并把这个位置标记为“反复违规点”
      this.player.addAnger(CONFIG.anger.riseIgnore);
      this.stats.wastedReminds++;
      this.markViolation(npc);
    }
  }

  openNegotiation(npc) {
    this.negotiatingWith = npc;
    this.negotiateLock = false;
    npc.state = 'negotiating';
    npc.moving = false;
    const opts = [
      { id: 'rule', label: '指出规则与吸烟区位置', cost: '规则敏感型更吃这套' },
      { id: 'smoke', label: '指出烟雾正在影响他人', cost: '先观察周围更有效' },
      { id: 'manager', label: '表示已请管理人员一同介入', cost: '对反复违规者更可靠' },
    ];
    $('dlg-who').textContent = `三级 NPC · 配合度 ${npc.compliance}/${npc.cfg.negotiateNeed}（连续重复同一句会失效）`;
    $('dlg-say').textContent = npc.clue || '他叼着烟，斜着眼看你。';
    const box = $('dlg-opts');
    box.innerHTML = '';
    opts.forEach((o) => {
      const b = document.createElement('div');
      b.className = 'opt';
      b.innerHTML = `<span>${o.label}</span><span class="cost">${o.cost}</span>`;
      b.onclick = () => this.doNegotiate(o.id);
      box.appendChild(b);
    });
    $('dialog').classList.add('show');
    this.dialogOpen = true;
  }

  doNegotiate(id) {
    const npc = this.negotiatingWith;
    if (!npc || this.negotiateLock) return;
    // 濒临失控：情绪让交涉更容易搞砸（对应策划案 13.2）——只是提高成本，不直接判负
    if (this.player.angerState === 'brink' && Math.random() < CONFIG.anger.brinkFailChance) {
      npc.compliance = Math.max(0, npc.compliance + (CONFIG.negotiate.wrongPenalty ?? 0));
      toast('你语气太冲，他反而更抵触了。先离开烟雾、冷静一下再来。', 'bad', 4.6);
      $('dlg-who').textContent = `三级 NPC · 配合度 ${npc.compliance}/${npc.cfg.negotiateNeed}（你已濒临失控）`;
      const t0 = CONFIG.negotiate.optionTime;
      if (t0 > 0) {
        this.negotiateLock = true;
        $('dlg-opts').classList.add('locked');
        setTimeout(() => { this.negotiateLock = false; $('dlg-opts').classList.remove('locked'); }, t0 * 1000);
      }
      return;
    }
    const res = npc.negotiate(id);
    toast(res.text, res.result === 'comply' ? 'good' : res.result === 'partial' ? 'info' : 'bad', 5);
    if (res.say) $('dlg-say').textContent = res.say;
    $('dlg-who').textContent = `三级 NPC · 配合度 ${npc.compliance}/${npc.cfg.negotiateNeed}（连续重复同一句会失效）`;
    if (res.result === 'comply') {
      this.closeDialog();
      if (npc.state === 'walking') toast('他动身了——但请确认方向，别只看他答应。', 'info', 5);
      else toast('他动身了……方向好像不太对，跟上去确认。', 'bad', 5);
      return;
    }
    // 交涉耗时：每次选择后短时间锁定选项（对应 8：交涉消耗时间）
    const t = CONFIG.negotiate.optionTime;
    if (t > 0) {
      this.negotiateLock = true;
      $('dlg-opts').classList.add('locked');
      setTimeout(() => {
        this.negotiateLock = false;
        $('dlg-opts').classList.remove('locked');
      }, t * 1000);
    }
  }

  closeDialog() {
    if (this.negotiatingWith && this.negotiatingWith.state === 'negotiating') this.negotiatingWith.state = 'smoking';
    this.negotiatingWith = null;
    this.dialogOpen = false;
    this.negotiateLock = false;
    $('dlg-opts').classList.remove('locked');
    $('dialog').classList.remove('show');
  }

  // -------------------------------------------------------------------------
  // 话术对辩（三级 NPC-2，对应策划案 21）
  // 对辩期间锁住玩家移动与其它操作，但主循环继续跑：
  // 烟雾继续扩散、健康继续扣血、NPC 继续活动（这就是“时间成本”）。
  // -------------------------------------------------------------------------
  openArgument(npc) {
    if (this.argueOpen || this.state !== 'playing') return;
    this.argueNpc = npc;
    this.argueOpen = true;
    this.negotiatingWith = null;
    this.pendingAction = null;
    npc.state = 'arguing';
    npc.moving = false;
    npc.path = null;
    npc.clue = null;
    sfx.unlock();
    this.argue = new ArgueFight(this, npc);
    // 首次进入对辩：跑一次手把手教学（完整教完一次后不再触发；其余情况直接正常开打）
    const teaching = !argueTutorialDone && CONFIG.argue.tutorial?.enabled !== false;
    this.argue.start(teaching);
  }

  /** 由 ArgueFight 在手把手教学完整跑完后回调，标记「已教过一次」 */
  markArgueTutorialDone() { argueTutorialDone = true; }

  closeArgument(result) {
    const npc = this.argueNpc;
    if (this.argue) this.argue.destroy();
    this.argue = null;
    this.argueNpc = null;
    this.argueOpen = false;
    this.updateActionButtons();
    if (!npc) return;
    if (result === 'win') {
      npc.winArgument();
      toast('你赢下了话术对辩——他掐灭烟，动身去吸烟区了。', 'good', 4.4);
    } else if (result === 'exit') {
      npc.abortArgument();
      toast('你中止了争论，未受惩罚。再提醒他一次可以重新开始。', 'info', 4.2);
    } else {
      npc.loseArgument();
      // 失败惩罚：愤怒值上升 + 冷却 + 按所在位置烟雾浓度持续扣血（沿用既有健康模型）
      this.player.addAnger(CONFIG.argue.loseAnger);
      this.markViolation(npc);
      toast(`你没吵赢，他继续抽。愤怒 +${CONFIG.argue.loseAnger}，他进入 ${CONFIG.npc.argue.cooldown}s 冷却。`, 'bad', 4.8);
    }
  }

  /** 对辩开启时的非阻塞提示（不得使用会暂停主循环的模态卡片） */
  argueTip(text) {
    if (!text) return;
    toast(text, 'info', 9);
    setHint(text, 8);
  }

  /** F / 点击通风 */
  actionVent(explicit) {
    if (this.state !== 'playing') return;
    if (!this.vents.length) { setHint('本关没有通风设备。', 2); return; }
    const v = explicit || this.nearestOf(this.vents, 2.6, (d) => this.grid.worldOf(d.tile.x, d.tile.z));
    if (!v) { setHint('走近通风设备按 E 开关。', 2); return; }
    if (this.needApproach(v, 'vent')) return;
    if (v.busy) { setHint('正在操作……', 1.2); return; }
    v.toggle();
    this.stats.ventToggled = true;
    toast(`通风设备${v.on ? '正在关闭' : '正在启动'}（约 ${CONFIG.vent.operateTime.toFixed(1)} 秒）`, 'info', 3);
    if (!v.on) toast('注意：停机后烟雾会开始积累。', 'bad', 4);
  }

  /** 教学关：开门，稍后进入第一关（学习提醒） */
  openDoor() {
    if (!this.door || this.door.open || this.state !== 'playing') return;
    // 点击门时若离得太远，先走过去再开
    if (this.distTo({ x: this.door.cell.x, z: this.door.cell.z }) > 2.2) {
      if (this.needApproach(this.door.cell, 'door')) return;
    }
    this.door.open = true;
    if (this.world.anchors.door) this.world.anchors.door.open = true;
    sfx.unlock(); sfx.keyE();
    const obj = this.objectives.find((o) => o.id === 'walk');
    if (obj && !obj.done) { obj.done = true; this.updateObjectivesHUD(); }
    toast('门开了——进去看看候车区的情况。', 'good', 3);
    this.doorOpenTimer = 1.2;
  }

  /** E / M / 点击管理亭或管理者：申请介入（靠近管理亭或管理人员本体均可） */
  actionManager() {
    if (this.state !== 'playing') return;
    if (!this.manager) { setHint('本关没有管理人员。', 2); return; }
    const range = CONFIG.manager.requestRange;
    const dMgr = Math.hypot(this.player.pos.x - this.manager.pos.x, this.player.pos.z - this.manager.pos.z);
    const booth = this.world.anchors.booth;
    const dBo = booth ? Math.hypot(this.player.pos.x - booth.wx, this.player.pos.z - booth.wz) : Infinity;
    if (dMgr > range && dBo > range) {
      // 不在范围内：走向更近的一个（管理人员本体或管理亭）
      if (dMgr <= dBo) {
        const t = this.grid.nearestWalkable(this.manager.cell) || this.manager.cell;
        this.moveTo(t);
        this.pendingAction = { kind: 'manager', ref: this.manager };
        setHint('正在靠近管理人员……', 2);
      } else {
        this.moveTo(this.grid.nearestWalkable(booth.tile));
        this.pendingAction = { kind: 'booth', ref: booth };
        setHint('正在前往管理亭……', 2);
      }
      return;
    }
    if (this.manager.state !== 'idle') { setHint('管理人员正在处理别的事情。', 2.4); return; }
    this.selectManagerTarget = true;
    this.updateActionButtons();
    setHint('已申请介入：点击要处理的目标 NPC（二级/三级）。', 4);
    toast('管理介入已批准，选择目标。', 'info', 3.4);
  }

  dispatchManager(npc) {
    this.selectManagerTarget = false;
    this.updateActionButtons();
    const ok = this.manager.dispatchTo(npc);
    if (!ok) { toast('管理人员过不去——路线被挡住了。', 'bad', 3.6); return; }
    toast(`管理人员正前往目标（${npc.levelNum} 级），需要一点时间。`, 'info', 4);
    tutorial(`l${this.level.id}-manager`, this.level.tutorial.onManager);
  }

  applyManagerIntervention(npc) {
    const res = npc.managerIntervene();
    toast(res.text, res.result === 'comply' ? 'good' : 'info', 5);
  }

  /** R：旋转提示牌（仅地图预置的提示牌，玩家不再放置） */
  actionRotate(explicit) {
    if (this.state !== 'playing') return;
    let sign = explicit;
    if (!sign) sign = this.nearestOf(this.signs, 2.8, (s) => this.grid.worldOf(s.cell.x, s.cell.z));
    if (!sign) { setHint('靠近一块提示牌再按 R 调整朝向。', 2.4); return; }
    sign.angle += CONFIG.sign.turnStep;
    sign.evaluate(this.areaCenter);
    sign.visible = this.computeSignVisible(sign);
    this.world.refreshSign(sign);
    sign.correct = sign.pointsToSmoking && sign.visible;
    sign.posQuality = this.computeSignQuality(sign);
    this.refreshSignRadius(sign);
    if (sign.needsFix && sign.correct) {
      sign.needsFix = false;
      this.stats.signFixed = true;
      this.objectives.find((o) => o.id === 'sign') && (this.objectives.find((o) => o.id === 'sign').done = true);
      this.updateObjectivesHUD();
      toast('提示牌指向正确了——但它现在需要被看见才能真正起作用。', 'good', 4.4);
    } else {
      setHint(sign.correct ? '朝向正确，指向吸烟区。' : '朝向不对：吸烟者在岔路会走错。', 2.4);
    }
  }

  computeSignVisible(sign) {
    let open = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        if (this.grid.isWalkable(sign.cell.x + dx, sign.cell.z + dz)) open++;
      }
    }
    return open >= 4;   // 至少一半邻格开阔，才算不被遮挡
  }

  // 位置质量：越开阔（入口 / 岔路）提示牌越容易发挥指引作用（对应 6.1 位置因素）
  computeSignQuality(sign) {
    let open = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        if (this.grid.isWalkable(sign.cell.x + dx, sign.cell.z + dz)) open++;
      }
    }
    return Math.min(1, open / 8);
  }

  // 提示牌有效半径 = 基础 × 位置质量 × 环境改善加成 × 商店强化（对应 6.1 / 12.3 / 14.3）
  refreshSignRadius(sign) {
    const proMul = this.upgrades?.signPro ? 1.25 : 1;
    const envMul = this.envBoost?.signRadiusMul ?? 1;
    sign.effectiveRadius = CONFIG.sign.effectRadius * (0.7 + 0.3 * (sign.posQuality ?? 0)) * envMul * proMul;
  }

  // 本关是否已解锁某个核心操作（按钮显隐与快捷键共用）
  isUnlocked(id) { return !this.level.actions || this.level.actions.includes(id); }

  // 存档：积分 / 已拥有道具 / 环境修复 / 通关记录（对应 15.4 跨关卡闭环）
  persist() {
    writeSave({
      points: this.points,
      owned: [...this.owned],
      upgrades: this.upgrades,
      envFixes: this.envFixes,
      clearedLevels: this.clearedLevels,
    });
  }

  // 反复违规点：同一位置被反复无视 / 假意配合时累积（对应 14.1）
  markViolation(npc) {
    if (!npc) return;
    const c = npc.cell;
    const k = c.z * this.grid.w + c.x;
    const m = this.violationMarks.get(k) || { cell: { x: c.x, z: c.z }, count: 0, npcs: new Set() };
    m.count++;
    m.npcs.add(npc);
    this.violationMarks.set(k, m);
  }

  /** T：记录违规（对应 12.2） */
  actionRecord(explicit) {
    if (this.state !== 'playing') return;
    if (!this.isUnlocked('record')) { setHint('本关还没解锁记录设备。', 2); return; }
    if (this.recordBusy) { setHint('正在记录……', 1.2); return; }
    const npc = explicit || this.nearestOf(this.npcs.filter((n) => n.state !== 'atArea'), CONFIG.record.range + 0.7, (n) => n.pos);
    if (!npc) { setHint(`走近违规者再按 T 记录（${CONFIG.record.range} 格内）。`, 2.4); return; }
    if (this.needApproach(npc, 'record')) return;
    // 濒临失控：手抖，可能录废一条（对应 13.2：情绪改变决策成本）
    if (this.player.angerState === 'brink' && Math.random() < CONFIG.anger.brinkMissChance) {
      toast('手抖了一下，画面糊了——这一条没记上。', 'bad', 3.6);
      return;
    }
    this.recordBusy = true;
    const need = this.recordNeed;
    toast('正在记录违规画面…', 'info', CONFIG.record.time);
    setTimeout(() => {
      this.recordBusy = false;
      if (this.state !== 'playing') return;
      const n = npc.recordEvidence();
      this.stats.records++;
      this.updateHUD();
      toast(`已存档第 ${n} 次违规（${npc.evidenceEnough ? '证据充足' : `还需 ${Math.max(0, need - n)} 次`}）。`, 'info', 4);
    }, CONFIG.record.time * 1000);
  }

  /** C：调查问题根源（对应 14） */
  findInvestigationTarget() {
    let best = null, bd = CONFIG.investigate.range + 1.2;
    for (const [k, m] of this.violationMarks) {
      if (m.count < CONFIG.investigate.repeatThreshold) continue;
      if (this.investigated.has(k)) continue;
      const w = this.grid.worldOf(m.cell.x, m.cell.z);
      const d = Math.hypot(this.player.pos.x - w.x, this.player.pos.z - w.z);
      if (d < bd) { bd = d; best = { key: k, cell: m.cell, mark: m }; }
    }
    return best;
  }

  actionInvestigate(explicit) {
    if (this.state !== 'playing') return;
    if (!this.isUnlocked('investigate')) { setHint('本关还没解锁调查。', 2); return; }
    if (this.investigateBusy) { setHint('正在调查……', 1.2); return; }
    const target = explicit || this.findInvestigationTarget();
    if (!target) {
      const any = [...this.violationMarks.entries()].some(([k, m]) => m.count >= 1 && !this.investigated.has(k));
      setHint(any
        ? `违规次数还不够（需 ${CONFIG.investigate.repeatThreshold} 次），无法判断根源。`
        : '附近没有可调查的反复违规点，先处理几次再看。', 2.8);
      return;
    }
    if (this.needApproach(target, 'investigate')) return;
    this.investigateBusy = true;
    toast('正在调查这个位置的问题根源…', 'info', CONFIG.investigate.time);
    setTimeout(() => {
      this.investigateBusy = false;
      if (this.state !== 'playing') return;
      this.finishInvestigation(target);
    }, CONFIG.investigate.time * 1000);
  }

  // 三类问题分类：个人反复违规 / 空间设计不合理 / 管理长期失效（对应 14.1）
  classifyProblem(cell, mark) {
    const area = this.smokingTiles.length
      ? Math.min(...this.smokingTiles.map((a) => Math.abs(a.x - cell.x) + Math.abs(a.z - cell.z)))
      : 0;
    const nearCorrectSign = this.signs.some((s) => s.correct
      && Math.hypot(s.cell.x - cell.x, s.cell.z - cell.z) <= (s.effectiveRadius ?? CONFIG.sign.effectRadius));
    if (!nearCorrectSign && area >= 4) return 'layout';
    if ([...mark.npcs].some((n) => n.levelNum === 2)) return 'management';
    return 'personal';
  }

  finishInvestigation(target) {
    this.investigated.add(target.key);
    const type = this.classifyProblem(target.cell, target.mark);
    this.stats.investigations++;
    this.recordFix(type, target.cell, target.mark);
    this.updateHUD();
  }

  // 把调查结果落成“永久或长期改变场景规则”（对应 14.3）
  recordFix(type, cell, mark) {
    if (type === 'personal') {
      for (const npc of mark.npcs) {
        if (npc.state === 'atArea') continue;
        npc.compliance += 1;
        npc.ignoreCount = Math.max(0, npc.ignoreCount - 1);
        npc.setClue('被点名了', 2.6, 'clue');
      }
      this.player.reduceAnger(CONFIG.anger.fallSolved);
      toast('调查结果：这是个人反复违规。定点沟通后，附近的人收敛了些。', 'good', 5.4);
      return;
    }
    const dup = this.envFixes.some((f) => f.type === type && f.cell
      && f.cell.x === cell.x && f.cell.z === cell.z);
    if (!dup) this.envFixes.push({ type, cell: { ...cell }, level: this.level.id });
    this.player.reduceAnger(CONFIG.anger.fallSolved);
    if (type === 'layout') {
      this.envBoost.signRadiusMul = 1 + 0.15 * this.envFixes.filter((f) => f.type === 'layout').length;
      for (const s of this.signs) this.refreshSignRadius(s);
      toast('调查结果：空间设计不合理（缺指引）。长期改善：提示牌作用范围扩大。', 'good', 6);
    } else {
      this.recordNeed = Math.max(1, CONFIG.record.need - this.envFixes.filter((f) => f.type === 'management').length);
      toast(`调查结果：管理长期失效。长期改善：管理介入所需证据降为 ${this.recordNeed} 条。`, 'good', 6);
    }
    this.persist();
  }

  // ---- 道具携带 / 放置（对应 12.3 / 15.3） ----
  // 可携带道具 = 商店中标记 carry 且当前拥有的道具
  carryableOwned() {
    return CONFIG.shopItems.filter((it) => it.carry && this.owned.has(it.id)).map((it) => it.id);
  }

  // 结算上一关「使用过」的道具：消耗掉，下关需重新购买（未使用 / 未携带的保留）
  consumeUsedProps() {
    let changed = false;
    for (const id of this.usedThisLevel) if (this.owned.delete(id)) changed = true;
    if (changed) this.persist();
  }

  // 是否是可放置到地面的道具（棒球棍 kind=tool，只携带不落地）
  isPlaceable(id) {
    return CONFIG.shopItems.find((it) => it.id === id)?.kind === 'equip';
  }

  /** 某格能否放置道具：可通行、在玩家周围 placeRange 格内、且没有别的道具/提示牌 */
  canPlaceEquipAt(cell) {
    if (!cell) return false;
    if (!this.grid.isWalkable(cell.x, cell.z)) return false;
    const pc = this.player.cell;
    if (Math.hypot(cell.x - pc.x, cell.z - pc.z) > CONFIG.equip.placeRange) return false;
    if (this.equips.some((e) => e.tile.x === cell.x && e.tile.z === cell.z)) return false;
    if (this.signs.some((s) => s.cell.x === cell.x && s.cell.z === cell.z)) return false;
    return true;
  }

  /** 从物品栏开始拖拽：生成半透明虚影与实际落点方格提示 */
  beginDrag(type, ev) {
    if (this.state !== 'playing' || this.dragType) return;
    if (!this.isPlaceable(type) || this.equips.some((e) => e.type === type)) return;
    if (ev) ev.preventDefault();
    this.dragType = type;
    this.dragCell = null;

    const { group } = buildEquipGroup(type);
    group.traverse((o) => {
      o.castShadow = false;
      if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.42; o.material.depthWrite = false; }
    });
    group.visible = false;
    this.ghost = group;
    this.world.root.add(group);

    const tile = CONFIG.tile;
    const mark = new THREE.Mesh(
      new THREE.PlaneGeometry(tile * 0.94, tile * 0.94),
      new THREE.MeshBasicMaterial({ color: 0x4fd06a, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide }),
    );
    mark.rotation.x = -Math.PI / 2;
    mark.position.y = 0.02;
    mark.visible = false;
    this.placeTileHint = mark;
    this.world.root.add(mark);

    document.body.style.cursor = 'grabbing';
    window.addEventListener('pointermove', this._dragMove);
    window.addEventListener('pointerup', this._dragUp);
    setHint(`把【${EQUIP_LABEL[type] || type}】拖到地面：绿格可放、红格不可（限周围 ${CONFIG.equip.placeRange} 格）。`, 4.5);
  }

  onDragMove(ev) {
    if (!this.dragType) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, this.hitPoint)) return;
    const cell = this.grid.cellOf(this.hitPoint.x, this.hitPoint.z);
    this.dragCell = cell;
    const w = this.grid.worldOf(cell.x, cell.z);
    const ok = this.canPlaceEquipAt(cell);
    if (this.ghost) { this.ghost.visible = true; this.ghost.position.set(w.x, 0, w.z); }
    if (this.placeTileHint) {
      this.placeTileHint.visible = true;
      this.placeTileHint.position.set(w.x, 0.02, w.z);
      this.placeTileHint.material.color.setHex(ok ? 0x4fd06a : 0xd23b30);
    }
  }

  onDragUp() {
    if (!this.dragType) return;
    const type = this.dragType;
    const cell = this.dragCell;
    const ok = this.canPlaceEquipAt(cell);
    this.endDrag();
    if (ok) this.placeEquipAt(cell, type);
    else setHint(`只能放在周围 ${CONFIG.equip.placeRange} 格内的空地上。`, 2.6);
  }

  /** 结束拖拽：清理虚影 / 方格提示 / 监听 */
  endDrag() {
    if (this._dragMove) window.removeEventListener('pointermove', this._dragMove);
    if (this._dragUp) window.removeEventListener('pointerup', this._dragUp);
    if (this.ghost) {
      this.ghost.traverse((o) => { if (o.isMesh && o.material && o.material.dispose) o.material.dispose(); });
      if (this.ghost.parent) this.ghost.parent.remove(this.ghost);
      this.ghost = null;
    }
    if (this.placeTileHint) {
      if (this.placeTileHint.parent) this.placeTileHint.parent.remove(this.placeTileHint);
      this.placeTileHint.material.dispose();
      this.placeTileHint.geometry.dispose();
      this.placeTileHint = null;
    }
    this.dragType = null;
    this.dragCell = null;
    document.body.style.cursor = '';
  }

  placeEquipAt(cell, type) {
    if (!type) return;
    if (!this.canPlaceEquipAt(cell)) { setHint('这里放不了道具。', 1.8); return; }
    // 濒临失控：可能放偏（对应 13.2）
    let target = cell;
    if (this.player.angerState === 'brink' && Math.random() < CONFIG.anger.brinkMissChance) {
      const alt = this.grid.nearestWalkable({ x: cell.x + (Math.random() < 0.5 ? -1 : 1), z: cell.z });
      if (alt && this.canPlaceEquipAt(alt)) { target = alt; toast('手一抖，道具放偏了。', 'bad', 3.4); }
    }
    // 风扇朝吸烟区方向吹：把烟推回吸烟区，玩家所在的通道一侧才会变干净。
    // （原来用 +π 反向吹，等于把烟吹向玩家/出口一侧，效果与「保护通道」相反）
    const angle = angleToArea(target, this.areaCenter);
    const eq = new Equip(type, target, angle);
    this.world.addEquip(eq);
    this.equips.push(eq);
    this.usedThisLevel.add(type);   // 本关使用过 → 下关需重新购买
    this.updateActionButtons();
    toast(`已放置【${EQUIP_LABEL[type] || type}】。`, 'good', 3.2);
    tutorial(`l${this.level.id}-equip`, this.level.tutorial.onEquip);
  }

  /** 底部两格物品栏：显示携带道具的模型缩略图，可拖拽的加抓取光标 */
  renderItemBar() {
    const bar = $('item-bar');
    if (!bar) return;
    const show = this.hintOn('equip') && this.carried.length > 0;
    bar.classList.toggle('hidden', !show);
    if (!show) { bar.innerHTML = ''; return; }
    bar.innerHTML = '';
    const slots = CONFIG.loadout.maxCarry;
    for (let i = 0; i < slots; i++) {
      const id = this.carried[i];
      const el = document.createElement('div');
      el.className = `item-slot${id ? ' filled' : ' empty'}`;
      if (id) {
        const it = CONFIG.shopItems.find((s) => s.id === id);
        const img = document.createElement('img');
        img.src = this.equipThumbs[id] || '';
        img.alt = it?.name || id;
        el.appendChild(img);
        const nm = document.createElement('div');
        nm.className = 'slot-name';
        nm.textContent = it?.name || id;
        el.appendChild(nm);
        const onField = this.equips.some((e) => e.type === id);
        if (this.isPlaceable(id) && !onField) {
          el.classList.add('draggable');
          el.title = '按住拖到地面放下';
          el.addEventListener('pointerdown', (ev) => this.beginDrag(id, ev));
        } else if (id === 'bat') {
          el.title = '棒球棍：靠近吸烟者按鼠标右键攻击';
        } else if (onField) {
          el.title = '已放置在场地上';
        }
      }
      bar.appendChild(el);
    }
  }

  recycleEquip(equip) {
    if (!equip) return;
    this.world.removeEquip(equip);
    const i = this.equips.indexOf(equip);
    if (i >= 0) this.equips.splice(i, 1);
    this.updateActionButtons();
    toast(`已收回【${EQUIP_LABEL[equip.type] || equip.type}】，可以换个位置再放。`, 'info', 2.8);
  }

  // ---- 棒球棍道具：鼠标右键攻击吸烟者，打完必须逃出危险半径 ----
  /** 鼠标右键：用棒球棍攻击一格内正在吸烟的 NPC（需携带棒球棍） */
  tryBat() {
    if (this.state !== 'playing') return;
    if (this.argueOpen || this.shopOpen || this.dialogOpen || isTutorialOpen()) return;
    if (!this.carried.includes('bat')) {
      setHint(`没带棒球棍。商店里 ${CONFIG.shopItems.find((it) => it.id === 'bat')?.price ?? 100} 积分可购买并携带。`, 2.8);
      return;
    }
    const B = CONFIG.bat;
    const npc = this.nearestOf(
      this.npcs.filter((n) => n.state === 'smoking' || n.state === 'annoyed' || n.state === 'misled'),
      B.range + 0.5,
      (n) => n.pos,
    );
    if (!npc) { setHint('走近正在吸烟的人（一格以内）再按右键。', 2.6); return; }
    const dx = npc.pos.x - this.player.pos.x;
    const dz = npc.pos.z - this.player.pos.z;
    const res = npc.hitByBat(dx, dz);
    this.usedThisLevel.add('bat');   // 本关使用过 → 下关需重新购买
    this.batTarget = npc;
    this.batDanger = 0;
    this.batDangerOn = true;
    sfx.unlock();
    sfx.batHit();
    toast(`挥棍打中了！${res.text}`, 'bad', 3.8);
    tutorial('batHit', this.level.tutorial?.onBat);
    setHint(`他被击退 ${B.push} 格、停止吸烟 ${B.stopSmoke} 秒——${B.escapeTime} 秒内跑出他 ${B.dangerRadius} 格以外，否则会被抓住！`, 5);
    this.updateActionButtons();
  }

  /** 每帧：打人后在危险半径内停留超时 → 被抓住 = 被赶出去（关卡失败） */
  updateBatDanger(dt) {
    const npc = this.batTarget;
    if (!npc) { this.batDangerOn = false; return; }
    if (this.state !== 'playing') return;
    const B = CONFIG.bat;
    const d = Math.hypot(this.player.pos.x - npc.pos.x, this.player.pos.z - npc.pos.z);
    if (d > B.dangerRadius) {
      // 已逃出危险半径：解除警戒（他已彻底愤怒的扣分仍保留）
      this.batTarget = null;
      this.batDanger = 0;
      if (this.batDangerOn) { this.batDangerOn = false; toast('你成功脱身，他没有追上来。', 'good', 3); }
      return;
    }
    this.batDangerOn = true;
    this.batDanger += dt;
    if (this.batDanger >= B.escapeTime) {
      this.batDanger = 0;
      this.batTarget = null;
      this.batDangerOn = false;
      this.endLevel(false, 'chased');
    }
  }

  /** 被打中的人身边烟雾较快消散 */
  clearSmokeAroundHitNpcs(dt) {
    const B = CONFIG.bat;
    const R2 = B.smokeClearRadius * B.smokeClearRadius;
    const r = Math.ceil(B.smokeClearRadius);
    const keep = Math.max(0, 1 - B.smokeClearRate * dt);
    for (const n of this.npcs) {
      if (n.batStopTimer <= 0) continue;
      const c = n.cell;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz > R2) continue;
          const x = c.x + dx, z = c.z + dz;
          if (!this.grid.inBounds(x, z)) continue;
          const i = this.grid.i(x, z);
          const s = this.grid.smoke[i];
          if (s > 0) this.grid.smoke[i] = s * keep;
        }
      }
    }
  }

  /** 商店按钮 / B：关卡中打开商店查看与购买（按钮常驻，点击即开） */
  actionShop() {
    if (this.state !== 'playing') return;
    this.openShop('browse');
  }

  // 出击准备：开局先选购并携带道具，点「开始关卡」才真正进入关卡
  openLoadout() {
    this.openShop('loadout');
    setHint(`出击准备：购买道具并选择携带（最多 ${CONFIG.loadout.maxCarry} 个），随后点「开始关卡」。`, 5.5);
  }

  startFromLoadout() {
    if (!this.shopOpen) return;
    this.shopOpen = false;
    this.shopMode = 'browse';
    $('shop').classList.remove('show');
    if (this.state === 'loadout') this.state = 'playing';
    this.updateActionButtons();
    setHint(this.carried.length
      ? `已携带 ${this.carried.length} 个道具：按住左下角物品栏里的道具拖到地面即可放置。`
      : '本关未携带道具。想买的话点下方商店按钮。', 4.5);
  }

  openShop(mode = 'browse') {
    this.shopMode = mode;
    // 出击准备暂停关卡；关卡中查看不暂停（与原有手感一致）
    if (mode === 'loadout' && this.state === 'playing') this.state = 'loadout';
    this.shopOpen = true;
    this.renderShop();
    $('shop').classList.add('show');
  }

  closeShop() {
    // 出击准备界面「关闭」= 直接开始关卡
    if (this.shopMode === 'loadout') { this.startFromLoadout(); return; }
    this.shopOpen = false;
    $('shop').classList.remove('show');
  }

  toggleCarry(id) {
    const i = this.carried.indexOf(id);
    if (i >= 0) { this.carried.splice(i, 1); this.renderShop(); return; }
    if (this.carried.length >= CONFIG.loadout.maxCarry) {
      toast(`最多携带 ${CONFIG.loadout.maxCarry} 个道具。`, 'bad', 3);
      return;
    }
    this.carried.push(id);
    this.renderShop();
  }

  renderShop() {
    const loadout = this.shopMode === 'loadout';
    const maxCarry = CONFIG.loadout.maxCarry;
    $('shop-title-text').textContent = loadout ? '出击准备' : '辅助装备商店';
    $('shop-sub').textContent = loadout
      ? `选择最多 ${maxCarry} 个道具携带进本关 · 每个道具限购 1 个 · 用过下关需重买`
      : '买装备只是多一种解法，不买也一样能通关';
    $('shop-points').textContent = `${Math.round(this.points)}`;
    $('shop-close').textContent = loadout ? '开始关卡 (B)' : '关闭 (B)';

    const list = $('shop-list');
    list.innerHTML = '';
    for (const item of CONFIG.shopItems) {
      const isUpgrade = item.kind === 'upgrade';
      const owned = isUpgrade ? !!this.upgrades[item.id]
        : item.consume ? this.boughtThisLevel.has(item.id)
          : this.owned.has(item.id);
      const carried = this.carried.includes(item.id);
      const afford = this.points >= item.price;
      // 电池只对场上已放置的净化器 / 风扇有效：没设备时按钮直接禁用，避免白花积分
      const noDevice = item.id === 'battery'
        && !this.equips.some((e) => e.type === 'purifier' || e.type === 'fan');
      const el = document.createElement('div');
      el.className = `shop-item${carried ? ' picked' : ''}`;
      let action;
      if (isUpgrade) {
        action = owned
          ? '<span class="si-tag">已拥有</span>'
          : `<button class="si-buy${afford ? '' : ' disabled'}">${afford ? '购买' : '积分不足'}</button>`;
      } else if (item.consume) {
        if (owned) action = '<span class="si-tag">本关已购</span>';
        else if (noDevice) action = '<button class="si-buy disabled">需先放置设备</button>';
        else action = `<button class="si-buy${afford ? '' : ' disabled'}">${afford ? '购买' : '积分不足'}</button>`;
      } else if (!owned) {
        action = `<button class="si-buy${afford ? '' : ' disabled'}">${afford ? '购买' : '积分不足'}</button>`;
      } else {
        action = `<button class="si-carry${carried ? ' on' : ''}">${carried ? '取消携带' : '携带'}</button>`;
      }
      const ownedNote = isUpgrade ? '' : (owned && item.consume ? '已使用' : '');
      el.innerHTML = `
        <div class="si-main">
          <div class="si-name">${item.name}</div>
          <div class="si-desc">${SHOP_DESC[item.id] || ''}</div>
        </div>
        <div class="si-side">
          <div class="si-price">${item.price} 积分</div>
          <div class="si-owned">${ownedNote}</div>
        </div>
        ${action}`;
      const buyBtn = el.querySelector('.si-buy');
      if (buyBtn && afford && !noDevice) buyBtn.onclick = () => this.buyItem(item);
      const carryBtn = el.querySelector('.si-carry');
      if (carryBtn) carryBtn.onclick = () => this.toggleCarry(item.id);
      list.appendChild(el);
    }

    // 底部携带槽（仅出击准备显示）
    $('shop-foot').classList.toggle('show', loadout);
    $('carry-count').textContent = `${this.carried.length} / ${maxCarry}`;
    const slots = $('carry-slots');
    slots.innerHTML = '';
    for (let i = 0; i < maxCarry; i++) {
      const id = this.carried[i];
      const it = id ? CONFIG.shopItems.find((s) => s.id === id) : null;
      const slot = document.createElement('div');
      slot.className = `carry-slot${id ? ' filled' : ''}`;
      slot.textContent = it ? it.name : '空';
      slots.appendChild(slot);
    }
  }

  buyItem(item) {
    if (this.points < item.price) return;
    if (item.kind === 'upgrade') {
      if (this.upgrades[item.id]) return;             // 永久强化：只能买一次
      this.points -= item.price;
      this.upgrades[item.id] = true;
      if (item.id === 'signPro') for (const s of this.signs) this.refreshSignRadius(s);
    } else if (item.consume) {
      if (this.boughtThisLevel.has(item.id)) return;  // 购买即消耗：本关限一次
      // 电池只对场上已放置的净化器 / 风扇有效：没有设备（或在出击准备界面）时
      // 直接提示、不扣积分，避免玩家白花 40 积分
      const devices = item.id === 'battery'
        ? this.equips.filter((e) => e.type === 'purifier' || e.type === 'fan')
        : [];
      if (item.id === 'battery') {
        if (!devices.length) {
          toast('场上还没有净化器 / 风扇，电池无处可用——先把设备拖到地面再买。', 'bad', 3.8);
          return;
        }
        if (!devices.some((e) => e.powerRemaining < e.power)) {
          toast('设备电力都是满的，暂时用不上电池。', 'bad', 3.4);
          return;
        }
      }
      this.points -= item.price;
      this.boughtThisLevel.add(item.id);
      for (const e of devices) e.addPower(30);
    } else {
      if (this.owned.has(item.id)) return;            // 每个道具只能买一次
      this.points -= item.price;
      this.owned.add(item.id);
      // 出击准备中若有空位，自动携带，少点一步
      if (this.carried.length < CONFIG.loadout.maxCarry) this.carried.push(item.id);
    }
    this.persist();
    toast(`已购买【${item.name}】。`, 'good', 3.2);
    this.updateActionButtons();
    this.updateHUD();
    this.renderShop();
    tutorial(`l${this.level.id}-shop`, this.level.tutorial.onShop);
  }

  /** G：引导路人 */
  actionGuide(explicit) {
    if (this.state !== 'playing') return;
    if (!this.pedestrians.length) { setHint('本关没有需要引导的路人。', 2); return; }

    // 已在跟随中的路人：再按一次 G（或再点他一次）→ 取消跟随
    const guiding = explicit
      ? (explicit.state === 'guiding' ? explicit : null)
      : this.nearestOf(this.pedestrians.filter((p) => !p.safe && p.state === 'guiding'), CONFIG.pedestrian.guideRange + 0.6, (d) => d.pos);
    if (guiding) {
      guiding.stopGuide();
      toast('已让路人停止跟随，他自己继续走。', 'info', 3);
      setHint('路人已停止跟随；再按 G 可重新引导。', 3);
      return;
    }

    const ped = explicit || this.nearestOf(this.pedestrians.filter((p) => !p.safe), CONFIG.pedestrian.guideRange + 0.6, (d) => d.pos);
    if (!ped) { setHint('走近路人再按 G 引导。', 2.2); return; }
    // 一次只能引导一个路人：还有别人跟着就先拒绝
    if (this.pedestrians.some((p) => !p.safe && p !== ped && p.state === 'guiding')) {
      setHint('一次只能引导一个路人：先按 G 让正在跟随的路人停下。', 3);
      return;
    }
    ped.startGuide();
    toast('路人开始跟着你。把他带到出口（青色圆圈）。', 'info', 4.2);
    tutorial(`l${this.level.id}-pedestrian`, this.level.tutorial.onPedestrian);
  }

  updateActionButtons() {
    this.renderItemBar();
  }

  // 调试台数值改动 -> 让构造时被缓存的项即时同步（其余 CONFIG 值运行时直接读取，无需处理）
  onConfigChanged(path) {
    if (path.startsWith('camera.')) {
      const aspect = window.innerWidth / window.innerHeight;
      this.camera.fov = CONFIG.camera.fov;
      this.camera.aspect = aspect;
      this.camera.userData.distance = computeDistance(this.grid, aspect);
      this.camDistance = this.camera.userData.distance;
      this.camera.updateProjectionMatrix();
    } else if (path === 'player.maxHealth') {
      this.player.maxHealth = CONFIG.player.maxHealth;
    } else if (path.startsWith('npc.argue.')) {
      for (const n of this.npcs) if (n.isArgue) n.cfg = { ...CONFIG.npc.argue };
    } else if (path.startsWith('npc.')) {
      const lvl = Number(path.split('.')[1]);
      for (const n of this.npcs) {
        if (n.levelNum === lvl) n.cfg = { ...CONFIG.npc[lvl], ...(this.level.npcOverrides?.[lvl] || {}) };
      }
    } else if (path === 'anger.max') {
      this.player.maxAnger = CONFIG.anger.max;
      this.player.anger = Math.min(this.player.anger, this.player.maxAnger);
    } else if (path === 'record.need') {
      this.recordNeed = Math.max(1, CONFIG.record.need - this.envFixes.filter((f) => f.type === 'management').length);
    } else if (path === 'sign.effectRadius') {
      for (const s of this.signs) this.refreshSignRadius(s);
    } else if (path.startsWith('audio.')) {
      // 调试台实时调整音量：背景音乐 / 音效总音量
      sfx.setSfxVolume(CONFIG.audio.sfxVolume);
      sfx.setBgmVolume(CONFIG.audio.bgmVolume);
    }
  }

  // -------------------------------------------------------------------------
  // 事件回调（由实体触发）
  // -------------------------------------------------------------------------
  onNpcSolved(npc) {
    toast(`${npc.levelNum} 级 NPC 已实际抵达吸烟区。`, 'good', 3.6);
    // 反复违规者被真正解决：情绪缓解（对应 13.3）
    if (npc.ignoreCount > 0) this.player.reduceAnger(CONFIG.anger.fallSolved);
    this.updateObjectivesHUD();
    tutorial(`l${this.level.id}-solved`, this.level.tutorial.onSolved);
  }
  onNpcFake(npc) {
    toast('他说“去去去”，但脚步偏了——这是线索。', 'bad', 4.6);
    // 当面答应却改道：最伤情绪（对应 13.2）
    this.player.addAnger(CONFIG.anger.riseFake);
    this.markViolation(npc);
  }
  onFakeClue(npc) {
    tutorial(`l${this.level.id}-fake`, this.level.tutorial.onFake);
  }
  onSignWorked(npc, sign) { toast('一级 NPC 看到提示牌，自己走向吸烟区了。', 'good', 4); }
  onNpcMisled(npc, sign) { toast('他被方向错误的提示牌带偏了，正走向反方向——把牌子转正试试。', 'bad', 4.6); }
  onPedestrianAffected(ped) { this.pedToast('blocked', '路人被烟雾挡住，停在原地。可按 G 引导。', 'bad', 4.2); }
  onPedestrianReroute(ped) { this.pedToast('reroute', '路人重新规划了路线。', 'info', 3); }
  onPedestrianSafe(ped) { this.stats.pedSafe++; this.updateHUD(); toast('路人安全通过。', 'good', 2.6); }
  // 路人多了以后同一时刻会有好几个一起被挡住 / 抱怨，这里做同类提示节流，
  // 避免弹幕刷屏（每个路人的头顶标签仍然各自显示状态）。
  pedToast(key, text, kind, seconds) {
    this.pedToastAt ??= {};
    const now = performance.now();
    if (now - (this.pedToastAt[key] ?? -1e9) < 6000) return;
    this.pedToastAt[key] = now;
    toast(text, kind, seconds);
  }
  // 路人身处烟雾中会抱怨（抱怨只显示在角色头顶的气泡里，不进右侧提示区）；
  // 连续暴露超时会愤怒（头顶冒火，结算时扣星）
  onPedestrianAngry(ped) {
    this.pedToast('angry', '路人在烟雾里待太久，被激怒了（头顶冒火）。愤怒的路人会让本关星级下降。', 'bad', 5);
  }
  onPedestrianCalm(ped) { toast('烟雾散去，路人的怒气消了。', 'good', 2.6); }

  // -------------------------------------------------------------------------
  // 帧循环
  // -------------------------------------------------------------------------
  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.fps = this.fps * 0.92 + (1 / Math.max(dt, 1e-4)) * 0.08;
    if (this.state === 'playing' && !isTutorialOpen()) this.update(dt);
    else {
      // 结束后 / 新手提示弹出时仍让角色保持动画
      this.animateOnly(dt);
    }
    this.updateCamera(dt);
    this.world.update(dt, { ventPower: this.vents.map((v) => v.power), time: this.time });
    this.world.updateSmoke(this.grid, this.time);
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    this.updateDebug(dt);
    if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) hintEl.classList.remove('show'); }
  }

  animateOnly(dt) {
    this.time += dt * 0.35;
    this.player.animate(dt, this.player.rig);
    this.player.group.position.copy(this.player.pos);
    for (const n of this.npcs) { n.animate(dt, n.rig); n.group.position.copy(n.pos); }
    for (const p of this.pedestrians) if (!p.safe) { p.animate(dt, p.rig); p.group.position.copy(p.pos); }
    if (this.manager) { this.manager.animate(dt, this.manager.rig); }
  }

  update(dt) {
    this.time += dt;
    this.levelTime += dt;

    // 玩家移动
    this.handlePlayerInput(dt);

    // 剧情提示
    for (const h of this.level.hints || []) {
      if (!this.usedHints.has(h) && this.levelTime >= h.after) {
        this.usedHints.add(h);
        toast(h.text, 'info', 5.5);
        setHint(h.text, 5);
      }
    }

    // 通风脚本
    for (const s of this.ventScript) {
      if (s.done || this.levelTime < s.at) continue;
      s.done = true;
      const v = this.vents[0];
      if (v) {
        v.setOn(s.action === 'on');
        toast(s.action === 'off' ? '通风设备停机了！室内烟雾开始积累。' : '通风设备重新启动。', s.action === 'off' ? 'bad' : 'good', 5);
      }
    }

    // 通风更新
    this.vents.forEach((v) => v.update(dt));
    // 辅助装备更新（耗电 / 失效）
    this.equips.forEach((e) => e.update(dt));

    // 实体更新
    const ctx = { dt };
    this.player.animate(dt, this.player.rig);
    this.player.group.position.copy(this.player.pos);
    const hp = this.player.updateHealth(dt, this.grid);
    // 愤怒值：暴露累积 / 安全区与调查平复（对应 13.2 / 13.3）
    this.player.updateAnger(dt, { investigating: this.investigateBusy });
    this.stats.peakExposure = Math.max(this.stats.peakExposure, this.player.exposure);

    for (const n of this.npcs) n.update(dt, ctx);
    if (this.manager) this.manager.update(dt, this);
    for (const p of this.pedestrians) p.update(dt, this);

    // 交涉超出范围自动关闭
    if (this.negotiatingWith && this.distTo(this.negotiatingWith.pos) > CONFIG.negotiate.range + 0.8) this.closeDialog();

    // 话术对辩：计时 / 出牌结算（主循环不停，健康仍按烟雾扣除）
    if (this.argue) this.argue.update(dt);

    // 烟雾（含辅助装备对烟雾的影响）
    const sources = this.npcs
      .filter((n) => n.emission > 0)
      .map((n) => ({ cell: n.cell, rate: n.emission }));
    this.grid.stepSmoke(dt, sources, this.vents.map((v) => ({ cell: v.tile, active: v.active, strength: v.strength })), this.equips, { radiusLimit: this.level.smokeLimit });

    // 棒球棍：被打者身边烟雾加速消散；打人后须逃出危险半径，否则被抓住
    this.clearSmokeAroundHitNpcs(dt);
    this.updateBatDanger(dt);

    // 待执行动作
    this.resolvePendingAction();

    // 教学关：开门后短暂停留，再进入第一关
    if (this.doorOpenTimer > 0) {
      this.doorOpenTimer -= dt;
      if (this.doorOpenTimer <= 0 && this.levelIndex + 1 < LEVELS.length) {
        this.loadLevel(this.levelIndex + 1);
        return;
      }
    }

    // 胜负
    this.checkEnd();
    this.checkObjectives();
    this.updateHUD();
  }

  handlePlayerInput(dt) {
    if (this.dialogOpen || this.argueOpen) { this.player.moving = false; return; }
    const k = this.keys;
    let dx = 0, dz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) dz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) dz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) dx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) dx += 1;
    if (dx || dz) {
      // 屏幕方向 -> 等距世界方向
      const ry = CONFIG.camera.rotY;
      const wx = dx * Math.cos(ry) + dz * Math.sin(ry);
      const wz = -dx * Math.sin(ry) + dz * Math.cos(ry);
      this.player.manual = true;
      this.player.path = null;
      this.pendingAction = null;
      this.player.moveManual(wx, wz, dt);
    } else if (this.player.path) {
      const arrived = this.player.followPath(dt, CONFIG.player.speed);
      if (arrived) this.player.moving = false;
    } else {
      this.player.moving = false;
    }
  }

  resolvePendingAction() {
    const pa = this.pendingAction;
    if (!pa) return;
    const range = CONFIG.player.interactRange + 0.5;
    let pos;
    if (pa.kind === 'booth') pos = { x: pa.ref.wx, z: pa.ref.wz };
    else if (pa.ref.pos) pos = pa.ref.pos;
    else if (pa.ref.cell) pos = this.grid.worldOf(pa.ref.cell.x, pa.ref.cell.z);
    else if (pa.ref.tile) pos = this.grid.worldOf(pa.ref.tile.x, pa.ref.tile.z);
    if (!pos) { this.pendingAction = null; return; }
    const d = Math.hypot(this.player.pos.x - pos.x, this.player.pos.z - pos.z);
    if (d > range) {
      // 目标移动了就重新走一遍
      if (!this.player.path && !this.player.moving) {
        const tile = this.tileOfRef(pa.ref);
        if (tile) this.moveTo(this.grid.nearestWalkable(tile) || tile);
        else this.pendingAction = null;
      }
      return;
    }
    this.pendingAction = null;
    const kind = pa.kind, ref = pa.ref;
    if (kind === 'npc') this.actionRemind(ref);
    else if (kind === 'vent') this.actionVent(ref);
    else if (kind === 'booth') this.actionManager();
    else if (kind === 'manager') this.actionManager();
    else if (kind === 'door') this.openDoor();
    else if (kind === 'pedestrian') this.actionGuide(ref);
    else if (kind === 'sign') this.actionRotate(ref);
    else if (kind === 'record') this.actionRecord(ref);
    else if (kind === 'investigate') this.actionInvestigate(ref);
  }

  checkObjectives() {
    const solveObj = this.objectives.find((o) => o.id === 'solve' || o.id === 'solveAll');
    if (solveObj) {
      const done = this.npcs.every((n) => n.state === 'atArea');
      if (done !== solveObj.done) { solveObj.done = done; this.updateObjectivesHUD(); }
    }
    const ventObj = this.objectives.find((o) => o.id === 'vent');
    if (ventObj) {
      const done = this.vents.length > 0 && this.vents.some((v) => v.active) && this.stats.ventToggled;
      if (done !== ventObj.done) { ventObj.done = done; this.updateObjectivesHUD(); }
    }
    const pedObj = this.objectives.find((o) => o.id === 'ped');
    if (pedObj) {
      const done = this.pedestrians.length > 0 && this.pedestrians.every((p) => p.safe);
      if (done !== pedObj.done) { pedObj.done = done; this.updateObjectivesHUD(); }
    }
  }

  checkEnd() {
    if (this.state !== 'playing') return;
    if (this.player.health <= 0) {
      this.endLevel(false);
      return;
    }
    if (this.npcs.length && this.npcs.every((n) => n.state === 'atArea')) this.endLevel(true);
  }

  endLevel(win, reason = 'health') {
    this.state = win ? 'won' : 'lost';
    if (win) { sfx.unlock(); sfx.levelClear(); }   // 通关音效：关卡通关.wav
    // 若在话术对辩中触发结算（通常是健康归零），先关闭对辩界面
    if (this.argue) { this.argue.destroy(); this.argue = null; this.argueNpc = null; this.argueOpen = false; }
    this.stats.ventOnAtEnd = this.vents.some((v) => v.active);
    const s = this.computeScore();
    const gained = win ? s.points : 0;
    // 调试台“直接通关”不写积分/存档，避免污染测试进度
    if (win && !this.__devSkipSave) {
      this.points += gained;
      if (!this.clearedLevels.includes(this.level.id)) this.clearedLevels.push(this.level.id);
      this.persist();
    }
    const stars = '★'.repeat(s.stars) + '☆'.repeat(Math.max(0, 3 - s.stars));
    const loseTitle = reason === 'chased' ? '失败：被赶出去' : '失败：健康值归零';
    $('res-title').textContent = win ? `通关 · ${stars}` : loseTitle;
    $('res-flavor').textContent = win
      ? '你让原本被烟雾侵占的空间重新可用了。评价只看表现，不影响通关。'
      : reason === 'chased'
        ? '你动了手又没及时拉开距离——被当场抓住，直接赶了出去。'
        : '你被二手烟拖垮了。下一次先处理最近的烟雾源，或先去开通风。';
    const grades = $('res-grades');
    const pedAngryTxt = s.pedTotal ? `${s.pedAngry} / ${s.pedTotal}` : '—';
    const batRow = s.batAngry
      ? `<div class="grade"><span>动手打人（激怒 ${s.batAngry} 人）</span><b>公共安全 −${Math.round(s.batAngry * CONFIG.bat.pubPenaltyPerAngry * 100)}</b></div>`
      : '';
    grades.innerHTML = `
      <div class="grade"><span>目标完成度</span><b>${Math.round(s.parts.goal * 100)}</b></div>
      <div class="grade"><span>健康保护</span><b>${Math.round(s.parts.health * 100)}</b></div>
      <div class="grade"><span>公共安全</span><b>${Math.round(s.parts.pub * 100)}</b></div>
      <div class="grade"><span>策略与调查</span><b>${Math.round(s.parts.strategy * 100)}</b></div>
      <div class="grade"><span>综合评分</span><b>${Math.round(s.score * 100)}</b></div>
      <div class="grade"><span>愤怒路人</span><b>${pedAngryTxt}${s.starPenalty ? `（−${s.starPenalty} 星）` : ''}</b></div>
      ${batRow}
      <div class="grade"><span>获得星级</span><b>${s.stars} 星 ${stars}</b></div>
      <div class="grade"><span>剩余健康</span><b>${Math.round(this.player.health)} / ${this.player.maxHealth}</b></div>
      <div class="grade"><span>行动用时</span><b>${fmtTime(this.levelTime)}</b></div>
    `;
    $('res-points').textContent = `+${gained}`;
    $('res-total').textContent = `累计 ${Math.round(this.points)}`;
    $('res-next').textContent = this.levelIndex + 1 < LEVELS.length ? '下一关' : '回到第 1 关';
    $('overlay').classList.add('show');
    this.updateObjectivesHUD();
    this.updateHUD();
  }

  // 四维评分 → 星级 → 积分（对应策划案 15.1 / 15.2）
  computeScore() {
    const W = CONFIG.score;
    const goal = this.npcs.length ? this.npcs.filter((n) => n.state === 'atArea').length / this.npcs.length : 1;
    const health = clamp01(this.player.health / this.player.maxHealth);
    const pubBase = this.pedestrians.length ? this.stats.pedSafe / this.pedestrians.length : 1;
    // 棒球棍：被激怒（被打 3 次及以上）的 NPC 会拉低公共安全评分
    const batAngry = this.npcs.filter((n) => n.batAngry).length;
    const pub = clamp01(pubBase - batAngry * CONFIG.bat.pubPenaltyPerAngry);
    const signPart = this.signs.some((s) => s.needsFix) ? 0 : 1;
    const strategyBase = clamp01(
      0.4 * (this.stats.investigations > 0 ? 1 : 0)
      + 0.2 * (this.stats.records > 0 ? 1 : 0)
      + 0.2 * (this.stats.ventToggled ? 1 : 0)
      + 0.2 * signPart,
    );
    const par = W.parTimePerLevel[this.level.id] || 150;
    const time = clamp01(par / Math.max(this.levelTime, 1));
    const strategy = clamp01(0.55 * strategyBase + 0.45 * time);
    const score = clamp01(
      W.goalWeight * goal + W.healthWeight * health + W.publicWeight * pub + W.strategyWeight * strategy,
    );
    let stars = score >= W.star3 ? 3 : score >= W.star2 ? 2 : 1;
    if (goal < 1) stars = 0;   // 未通关不给星、不给积分
    // 路人愤怒扣星：愤怒比例达到 1/3 扣 1 星，达到 1/2 及以上扣 2 星
    const pedTotal = this.pedestrians.length;
    const pedAngry = this.pedestrians.filter((p) => p.angry).length;
    const angryRatio = pedTotal ? pedAngry / pedTotal : 0;
    const starPenalty = pedTotal
      ? (angryRatio >= (W.angryPenalty2Ratio ?? 0.5) ? (W.angryPenalty2Stars ?? 2)
        : angryRatio >= (W.angryPenalty1Ratio ?? 0.333) ? (W.angryPenalty1Stars ?? 1) : 0)
      : 0;
    const starsBeforePenalty = stars;
    stars = Math.max(0, stars - starPenalty);
    const points = CONFIG.economy.starPoints[stars] ?? 0;
    return { score, stars, points, parts: { goal, health, pub, strategy }, pedTotal, pedAngry, angryRatio, starPenalty, starsBeforePenalty, batAngry };
  }

  // -------------------------------------------------------------------------
  // 相机 / HUD / 标签 / 调试
  // -------------------------------------------------------------------------
  snapCamera() {
    const b = this.activityBounds;
    this.camFocus.set(b.cx, CONFIG.camera.lookAtLift, b.cz);
    const p = isoCameraTarget(this.camFocus, this.camDistance, 0);
    this.camBase.copy(p);
    this.camera.position.copy(p);
    this.camera.lookAt(this.camFocus);
  }

  updateCamera(dt) {
    const b = this.activityBounds;
    const center = new THREE.Vector3(b.cx, CONFIG.camera.lookAtLift, b.cz);
    // 跟随玩家，但把视点限制在可活动区域内，避免镜头看到活动范围之外
    const target = center.clone().addScaledVector(
      new THREE.Vector3(this.player.pos.x, 0, this.player.pos.z).sub(center),
      CONFIG.camera.follow ? CONFIG.camera.followStrength : 0,
    );
    target.x = Math.max(b.cx - b.halfX, Math.min(b.cx + b.halfX, target.x));
    target.z = Math.max(b.cz - b.halfZ, Math.min(b.cz + b.halfZ, target.z));
    this.camFocus.lerp(target, Math.min(1, dt * CONFIG.camera.followLerp));
    const p = isoCameraTarget(this.camFocus, this.camDistance, 0);
    this.camBase.lerp(p, Math.min(1, dt * 3.4));

    // 低血量震动提示：血条黄色时轻微抖动，红色时加剧（仅游戏进行中生效）
    // 画面抖动与血条抖动共用同一套判定，只取不同的幅度/频率
    const S = CONFIG.health.shake;
    const hp = this.player.health;
    let tAmp = 0, tFreq = S.warnFreq, tRot = 0, tBarAmp = 0, tBarFreq = S.barWarnFreq;
    let tier = 0; // 0=正常 1=黄条 2=红条
    if (this.state === 'playing' && !isTutorialOpen()) {
      if (hp <= CONFIG.health.lowHealthWarn) {          // 红条：剧烈
        tier = 2;
        tAmp = S.dangerAmp; tFreq = S.dangerFreq; tRot = S.dangerRot;
        tBarAmp = S.barDangerAmp; tBarFreq = S.barDangerFreq;
      } else if (hp <= CONFIG.health.warnHealth) {      // 黄条：轻微
        tier = 1;
        tAmp = S.warnAmp; tFreq = S.warnFreq; tRot = S.warnRot;
        tBarAmp = S.barWarnAmp; tBarFreq = S.barWarnFreq;
      }
    }
    this.updateCoughFeedback(dt, tier);
    const k = Math.min(1, dt * 9);
    this.shakeAmp += (tAmp - this.shakeAmp) * k;
    this.shakeFreq += (tFreq - this.shakeFreq) * k;
    this.shakeRot += (tRot - this.shakeRot) * k;
    this.barShakeAmp += (tBarAmp - this.barShakeAmp) * k;
    this.barShakeFreq += (tBarFreq - this.barShakeFreq) * k;
    if (this.shakeAmp < 0.0005) this.shakeAmp = 0;
    if (this.barShakeAmp < 0.05) this.barShakeAmp = 0;
    this.shakePhase += dt * this.shakeFreq;
    this.barShakePhase += dt * this.barShakeFreq;

    this.camera.position.copy(this.camBase);
    this.camera.lookAt(this.camFocus);
    if (this.shakeAmp > 0) {
      const ph = this.shakePhase;
      this.camera.position.x += Math.sin(ph) * this.shakeAmp;
      this.camera.position.y += Math.cos(ph * 1.37 + 1.1) * this.shakeAmp * 0.55;
      this.camera.position.z += Math.sin(ph * 0.83 + 2.3) * this.shakeAmp;
      this.camera.rotateZ(Math.sin(ph * 1.19) * this.shakeRot);
    }
  }

  /**
   * 低血量咳嗽音效（与震动同判定）：
   * 黄条循环播放 Cough1，红条循环播放 Cough2；
   * 进入某个区间（或黄转红）时立刻咳一声，之后按各自间隔重复。
   */
  updateCoughFeedback(dt, tier) {
    if (tier === 0) { this.coughTimer = 0; this.coughTier = 0; return; }
    if (tier !== this.coughTier) { this.coughTimer = 0; this.coughTier = tier; }
    this.coughTimer -= dt;
    if (this.coughTimer > 0) return;
    const S = CONFIG.health.shake;
    sfx.cough(tier === 2 ? 2 : 1);
    this.coughTimer = tier === 2 ? S.coughDangerInterval : S.coughWarnInterval;
  }

  updateHUD() {
    const hp = this.player.health;
    const pct = clamp01(hp / this.player.maxHealth) * 100;
    const fill = $('health-fill');
    fill.style.width = `${pct}%`;
    fill.classList.toggle('warn', hp <= CONFIG.health.warnHealth && hp > CONFIG.health.lowHealthWarn);
    fill.classList.toggle('danger', hp <= CONFIG.health.lowHealthWarn);
    // 血条抖动（与画面抖动同逻辑）：黄条轻微、红条剧烈，幅度以像素计
    const hw = $('health-wrap');
    if (this.barShakeAmp > 0) {
      const bp = this.barShakePhase;
      const bx = Math.sin(bp) * this.barShakeAmp;
      const by = Math.cos(bp * 1.31 + 0.9) * this.barShakeAmp * 0.7;
      hw.style.transform = `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px)`;
    } else if (hw.style.transform) {
      hw.style.transform = '';
    }
    $('health-num').textContent = Math.round(hp);
    // 愤怒值（对应策划案 13：冷静 / 愤怒上升 / 濒临失控）
    const ar = clamp01(this.player.angerRatio) * 100;
    const af = $('anger-fill');
    af.style.width = `${ar}%`;
    af.classList.toggle('warn', this.player.angerState === 'rising');
    af.classList.toggle('danger', this.player.angerState === 'brink');
    $('anger-num').textContent = Math.round(this.player.anger);
    $('anger-tag').textContent = ANGER_LABEL[this.player.angerState] || '冷静';
    $('stat-points').textContent = Math.round(this.points);
    const solved = this.npcs.filter((n) => n.state === 'atArea').length;
    $('stat-solved').textContent = `${solved} / ${this.npcs.length}`;
    const ventActive = this.vents.filter((v) => v.active).length;
    $('stat-vent').textContent = this.vents.length ? (ventActive ? '运行' : '停机') : '无';
    $('stat-time').textContent = fmtTime(this.levelTime);
    const s = this.player.exposure;
    const tag = this.player.inSafe ? `通风安全区 · 恢复中` : s >= CONFIG.health.cleanThreshold ? `暴露 ${Math.round(s * 100)}%` : '空气洁净';
    $('exposure-tag').textContent = tag;
    $('exposure-tag').style.color = this.player.inSafe ? '#5d7d40' : s > 0.3 ? '#b8452c' : '';
  }

  updateObjectivesHUD() {
    const box = $('level-objectives');
    box.innerHTML = '';
    for (const o of this.objectives) {
      const el = document.createElement('div');
      el.className = `obj${o.done ? ' done' : ''}`;
      const scoring = ['vent', 'ped', 'sign'].includes(o.id) ? '（评分项）' : '';
      el.innerHTML = `<span class="dot">✓</span><span>${o.text}${scoring}</span>`;
      box.appendChild(el);
    }
  }

  label(key, worldPos, text, cls = 'wlabel', lift = 1.6) {
    let el = this.labels.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = cls;
      $('labels').appendChild(el);
      this.labels.set(key, el);
    }
    el.textContent = text;
    el.className = cls;
    this.usedLabels.add(key);
    this.placeLabel(el, worldPos, lift);
  }

  // 头顶按键提示：靠近可交互目标时显示，如 [E] 提醒
  keyHint(key, worldPos, keyText, text, cls = 'wlabel keyhint', lift = 2.1) {
    let el = this.labels.get(key);
    if (!el) {
      el = document.createElement('div');
      $('labels').appendChild(el);
      this.labels.set(key, el);
    }
    const html = `<span class="key">${keyText}</span><span class="lbl">${text}</span>`;
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
    el.className = cls;
    this.usedLabels.add(key);
    this.placeLabel(el, worldPos, lift);
  }

  // 把世界坐标投影成屏幕坐标（lift = 相对锚点的抬升高度）
  placeLabel(el, worldPos, lift) {
    const p = worldPos.clone();
    p.y += lift;
    p.project(this.camera);
    const w = window.innerWidth, h = window.innerHeight;
    const x = (p.x * 0.5 + 0.5) * w;
    const y = (-p.y * 0.5 + 0.5) * h;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.display = (x < -60 || y < -40 || x > w + 60 || y > h + 40) ? 'none' : '';
  }

  // 玩家与该目标（世界 XZ 坐标）的距离是否在给范围内
  nearXZ(pos, range) {
    return Math.hypot(this.player.pos.x - pos.x, this.player.pos.z - pos.z) <= range;
  }

  // 该机制在本关是否可用（提醒为核心操作，始终可用）
  hintOn(id) { return id === 'remind' || this.isUnlocked(id); }

  updateLabels() {
    this.usedLabels.clear();
    const R = CONFIG.player.interactRange + 0.7;   // 头顶按键提示的触发距离
    // 吸烟区
    if (this.world.anchors.smokingArea) {
      const a = this.world.anchors.smokingArea;
      this.label('area', new THREE.Vector3(a.wx, 0, a.wz), '指定吸烟区', 'wlabel soft');
    }
    // 通风
    (this.world.anchors.vents || []).forEach((v, i) => {
      const w = this.grid.worldOf(v.tile.x, v.tile.z);
      const dev = this.vents[i];
      const txt = dev ? (dev.busy ? '切换中…' : dev.on ? '通风运行中' : '通风已停机') : '通风设备';
      const cls = dev && dev.active ? 'wlabel good' : 'wlabel clue';
      this.label(`vent${i}`, new THREE.Vector3(w.x, 1.4, w.z), txt, cls);
      if (dev && !dev.busy && this.hintOn('vent') && this.nearXZ(w, R)) {
        this.keyHint(`ventK${i}`, new THREE.Vector3(w.x, 1.4, w.z), 'E', '开关通风', 'wlabel keyhint', 2.5);
      }
    });
    // 管理亭
    if (this.world.anchors.booth) {
      const b = this.world.anchors.booth;
      this.label('booth', new THREE.Vector3(b.wx, 1.5, b.wz), '管理亭', 'wlabel soft');
      if (this.hintOn('manager') && this.manager && this.manager.state === 'idle'
        && this.nearXZ({ x: b.wx, z: b.wz }, CONFIG.manager.requestRange + 0.4)) {
        this.keyHint('boothK', new THREE.Vector3(b.wx, 1.5, b.wz), 'E', '申请介入', 'wlabel keyhint', 2.5);
      }
    }
    // 管理人员本体：靠近同样可按 E 申请介入
    if (this.manager && this.hintOn('manager') && this.manager.state === 'idle'
      && this.nearXZ(this.manager.pos, CONFIG.manager.requestRange + 0.4)) {
      this.keyHint('mgrK', this.manager.pos.clone(), 'E', '申请介入', 'wlabel keyhint', 2.4);
    }
    // 教学关的门：靠近可按 E / 点击开门
    if (this.door && !this.door.open
      && this.nearXZ({ x: this.door.wx, z: this.door.wz }, 2.4)) {
      this.label('door', new THREE.Vector3(this.door.wx, 1.7, this.door.wz), '出口', 'wlabel soft');
      this.keyHint('doorK', new THREE.Vector3(this.door.wx, 1.7, this.door.wz), 'E', '开门', 'wlabel keyhint', 0.6);
    }
    // 提示牌：靠近可调整朝向
    if (this.hintOn('rotate')) {
      this.signs.forEach((s, i) => {
        const w = this.grid.worldOf(s.cell.x, s.cell.z);
        if (this.nearXZ(w, R + 0.6)) {
          this.keyHint(`signK${i}`, new THREE.Vector3(w.x, 1.2, w.z), 'R', '调整朝向', 'wlabel keyhint', 1.6);
        }
      });
    }
    // 辅助装备
    this.equips.forEach((e, i) => {
      const w = this.grid.worldOf(e.tile.x, e.tile.z);
      const name = EQUIP_LABEL[e.type] || e.type;
      this.label(`equip${i}`, new THREE.Vector3(w.x, 1.5, w.z), e.active ? name : `${name}（已耗尽）`, e.active ? 'wlabel soft' : 'wlabel clue');
    });
    // 反复违规点：给玩家一个可寻找、可调查的提示（对应 14.1）
    if (this.isUnlocked('investigate')) {
      for (const [k, m] of this.violationMarks) {
        if (m.count < CONFIG.investigate.repeatThreshold || this.investigated.has(k)) continue;
        const w = this.grid.worldOf(m.cell.x, m.cell.z);
        this.label(`vm${k}`, new THREE.Vector3(w.x, 2.1, w.z), '反复违规点 · 可调查 (C)', 'wlabel clue');
      }
    }
    // NPC
    for (const n of this.npcs) {
      const idx = n.id ?? this.npcs.indexOf(n);
      const key = `npc${idx}`;
      if (n.clue) {
        this.label(key, n.pos.clone(), n.clue, `wlabel ${n.clueKind === 'good' ? 'good' : 'clue'}`);
      } else if (this.debugOn) {
        this.label(key, n.pos.clone(), `${n.levelNum}级 · ${NPC_STATE_LABEL[n.state]}`, 'wlabel');
      } else {
        const el = this.labels.get(key);
        if (el) el.style.display = 'none';
      }
      // 靠近时的按键提示（管理介入选目标时改为"点击"；带棒球棍时右键攻击优先）
      const hk = `npcK${idx}`;
      const batReady = this.carried.includes('bat') && this.hintOn('equip')
        && (n.state === 'smoking' || n.state === 'annoyed' || n.state === 'misled')
        && this.nearXZ(n.pos, CONFIG.bat.range + 0.5);
      if (this.selectManagerTarget && n.state !== 'atArea') {
        this.keyHint(hk, n.pos.clone(), '点击', '选择目标', 'wlabel keyhint', 2.4);
      } else if (batReady) {
        this.keyHint(hk, n.pos.clone(), '右键', '棒球棍攻击', 'wlabel keyhint', 2.7);
      } else if (n.state !== 'atArea' && n.state !== 'arguing' && this.hintOn('remind') && this.nearXZ(n.pos, R)) {
        let txt = n.levelNum === 3 ? '交涉' : '提醒';
        if (n.isArgue) {
          const need = n.cfg.triggerRemind ?? 2;
          txt = n.argueCooldown > 0 ? `冷静 ${Math.ceil(n.argueCooldown)}s`
            : n.argueRemindCount > 0 ? `再提醒 (${n.argueRemindCount}/${need})` : '提醒';
        }
        this.keyHint(hk, n.pos.clone(), 'E', txt, 'wlabel keyhint', 2.4);
      }
    }
    // 路人
    this.pedestrians.forEach((p, i) => {
      const key = `ped${i}`;
      if (p.safe) { const el = this.labels.get(key); if (el) el.style.display = 'none'; return; }
      if (p.angry) {
        // 愤怒：头顶冒火，标签提示
        this.label(key, p.pos.clone(), '🔥 愤怒', 'wlabel angry');
      } else if (p.bubbleTimer > 0 && p.bubbleText) {
        // 抱怨：头顶说话气泡（不进右侧提示区）
        this.label(key, p.pos.clone(), p.bubbleText, 'wlabel speech');
      } else if (p.state === 'guiding') {
        this.label(key, p.pos.clone(), '跟随中', 'wlabel good');
      } else if (p.state === 'affected') {
        this.label(key, p.pos.clone(), '被烟雾挡住', 'wlabel clue');
      } else if (p.inSmoke) {
        this.label(key, p.pos.clone(), `咳…好呛 ${Math.min(100, Math.round(p.smokeTime / CONFIG.pedestrian.angerExposureTime * 100))}%`, 'wlabel complaint');
      } else {
        const el = this.labels.get(key);
        if (el) el.style.display = 'none';
      }
      if (this.hintOn('guide') && this.nearXZ(p.pos, CONFIG.pedestrian.guideRange + 0.8)) {
        const on = p.state === 'guiding';
        this.keyHint(`pedK${i}`, p.pos.clone(), 'G', on ? '取消跟随' : '引导', 'wlabel keyhint', 2.4);
      }
    });
    // 棒球棍：打人后在危险半径内的逃命倒计时（醒目红标）
    if (this.batDangerOn && this.batTarget) {
      const left = Math.max(0, CONFIG.bat.escapeTime - this.batDanger);
      this.label('batDanger', this.player.pos.clone().add(new THREE.Vector3(0, 0.6, 0)),
        `快跑！被抓住就失败 ${left.toFixed(1)}s`, 'wlabel angry');
    }
    // 隐藏未使用的
    for (const [key, el] of this.labels) if (!this.usedLabels.has(key)) el.style.display = 'none';
  }

  updateDebug(dt) {
    if (!this.debugOn) return;
    this.debugAcc += dt;
    if (this.debugAcc < 0.25) return;
    this.debugAcc = 0;
    const c = this.player.cell;
    const s = this.grid.smokeAt(c.x, c.z);
    const f = this.grid.ventAtWorld(this.player.pos.x, this.player.pos.z);
    let maxSmoke = 0, sum = 0, n = 0;
    for (let i = 0; i < this.grid.smoke.length; i++) {
      const v = this.grid.smoke[i];
      maxSmoke = Math.max(maxSmoke, v);
      sum += v;
      if (v > 0.05) n++;
    }
    const rows = [];
    rows.push(`<div class="sec"><h3>运行</h3><table>
      <tr><td>FPS</td><td>${this.fps.toFixed(0)}</td></tr>
      <tr><td>关卡时间</td><td>${this.levelTime.toFixed(1)}s</td></tr>
      <tr><td>相机距离</td><td>${this.camDistance.toFixed(1)}</td></tr>
      <tr><td>状态</td><td>${this.state}</td></tr></table></div>`);
    rows.push(`<div class="sec"><h3>玩家</h3><table>
      <tr><td>格子 (x,z)</td><td>${c.x}, ${c.z}</td></tr>
      <tr><td>健康</td><td>${this.player.health.toFixed(1)}</td></tr>
      <tr><td>位置烟雾浓度</td><td>${s.toFixed(3)}</td></tr>
      <tr><td>通风场</td><td>${f.toFixed(3)}</td></tr>
      <tr><td>是否安全区</td><td>${this.player.inSafe ? '是' : '否'}</td></tr>
      <tr><td>危险停留</td><td>${this.player.stats.dangerTime.toFixed(1)}s</td></tr></table></div>`);
    rows.push(`<div class="sec"><h3>烟雾网格</h3><table>
      <tr><td>最大浓度</td><td>${maxSmoke.toFixed(3)}</td></tr>
      <tr><td>平均浓度</td><td>${(sum / this.grid.smoke.length).toFixed(4)}</td></tr>
      <tr><td>有效格数</td><td>${n}</td></tr></table></div>`);
    rows.push(`<div class="sec"><h3>通风</h3><table>${this.vents.map((v, i) => `<tr><td>#${i} ${v.tile.x},${v.tile.z}</td><td>${v.on ? 'on' : 'off'} p=${v.power.toFixed(2)}</td></tr>`).join('') || '<tr><td>无</td><td>-</td></tr>'}</table></div>`);
    rows.push(`<div class="sec"><h3>NPC</h3><table>${this.npcs.map((x, i) => `<tr><td>${i} L${x.levelNum} ${x.cell.x},${x.cell.z}</td><td>${NPC_STATE_LABEL[x.state]} e=${x.emission.toFixed(2)} c=${x.compliance}</td></tr>`).join('') || '<tr><td>无</td><td>-</td></tr>'}</table></div>`);
    rows.push(`<div class="sec"><h3>提示牌</h3><table>${this.signs.map((sg, i) => `<tr><td>#${i} ${sg.cell.x},${sg.cell.z}</td><td>${sg.correct ? '正确' : '错误'} a=${(sg.angle * 180 / Math.PI).toFixed(0)}°</td></tr>`).join('') || '<tr><td>无</td><td>-</td></tr>'}</table></div>`);
    if (this.pedestrians.length) {
      rows.push(`<div class="sec"><h3>路人 · 烟雾暴露/愤怒</h3><table>${this.pedestrians.map((p, i) => `<tr><td>${i} ${p.cell.x},${p.cell.z}</td><td>${p.safe ? '安全' : p.state} 烟=${(p.smokeLevel ?? 0).toFixed(2)} 暴露=${(p.smokeTime ?? 0).toFixed(1)}s ${p.angry ? '🔥愤怒' : p.inSmoke ? '抱怨中' : ''}</td></tr>`).join('')}
      <tr><td>抱怨阈值 / 愤怒时长</td><td>${CONFIG.pedestrian.complainSmoke} / ${CONFIG.pedestrian.angerExposureTime}s</td></tr>
      <tr><td>愤怒比例</td><td>${(this.pedestrians.filter((p) => p.angry).length)} / ${this.pedestrians.length}</td></tr></table></div>`);
    }
    // V0.3：情绪 / 成长 / 记录 / 调查 / 装备 / 评分预览
    const sc = this.computeScore();
    rows.push(`<div class="sec"><h3>情绪与成长</h3><table>
      <tr><td>愤怒值</td><td>${this.player.anger.toFixed(1)} / ${this.player.maxAnger}（${ANGER_LABEL[this.player.angerState]}）</td></tr>
      <tr><td>峰值暴露</td><td>${(this.stats.peakExposure * 100).toFixed(0)}%</td></tr>
      <tr><td>积分</td><td>${Math.round(this.points)}</td></tr>
      <tr><td>已修复环境</td><td>${this.envFixes.length} 处</td></tr>
      <tr><td>所需证据数</td><td>${this.recordNeed}</td></tr>
      <tr><td>提示牌半径加成</td><td>×${(this.envBoost?.signRadiusMul ?? 1).toFixed(2)}</td></tr></table></div>`);
    rows.push(`<div class="sec"><h3>记录 / 调查</h3><table>
      <tr><td>记录次数</td><td>${this.stats.records}</td></tr>
      <tr><td>调查次数</td><td>${this.stats.investigations}</td></tr>
      <tr><td>反复违规点</td><td>${[...this.violationMarks.values()].filter((m) => m.count >= CONFIG.investigate.repeatThreshold).length} 处</td></tr>
      <tr><td>无效提醒</td><td>${this.stats.wastedReminds}</td></tr></table></div>`);
    rows.push(`<div class="sec"><h3>NPC 证据</h3><table>${this.npcs.map((x, i) => `<tr><td>${i} L${x.levelNum} 无视${x.ignoreCount}</td><td>证据 ${x.evidence}/${this.recordNeed}${x.evidenceEnough ? ' 足' : ''}</td></tr>`).join('') || '<tr><td>无</td><td>-</td></tr>'}</table></div>`);
    rows.push(`<div class="sec"><h3>辅助装备</h3><table>${this.equips.map((e, i) => `<tr><td>${i} ${EQUIP_LABEL[e.type] || e.type} ${e.tile.x},${e.tile.z}</td><td>${e.type === 'barrier' ? '常驻' : `${e.powerRemaining.toFixed(0)}s`}</td></tr>`).join('') || '<tr><td>无</td><td>-</td></tr>'}</table></div>`);
    rows.push(`<div class="sec"><h3>评分预览</h3><table>
      <tr><td>目标 / 健康</td><td>${Math.round(sc.parts.goal * 100)} / ${Math.round(sc.parts.health * 100)}</td></tr>
      <tr><td>公共 / 策略</td><td>${Math.round(sc.parts.pub * 100)} / ${Math.round(sc.parts.strategy * 100)}</td></tr>
      <tr><td>总分</td><td>${Math.round(sc.score * 100)}</td></tr>
      <tr><td>愤怒扣星</td><td>比例 ${sc.pedTotal ? (sc.angryRatio * 100).toFixed(0) + '%' : '—'} · −${sc.starPenalty} 星（阈值 ${Math.round(CONFIG.score.angryPenalty1Ratio * 100)}% / ${Math.round(CONFIG.score.angryPenalty2Ratio * 100)}%）</td></tr>
      <tr><td>星级(扣前→扣后)</td><td>${sc.starsBeforePenalty} → ${sc.stars} 星</td></tr>
      <tr><td>预计积分</td><td>+${sc.points}</td></tr></table></div>`);
    $('debug').innerHTML = rows.join('');
  }
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 启动
new Game();