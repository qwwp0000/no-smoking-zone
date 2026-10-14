// ---------------------------------------------------------------------------
// 界面布局调试台：把静态 HUD 的位置 / 大小 / 显隐变成可调参数
//   - 位置：只写各元素自己的锚点属性（left/top/right/bottom），保留原有布局语义
//   - 大小：用独立的 CSS `scale` 属性，绝不改写元素自身的 transform
//           （居中、#hint.show 弹出动画、:hover 上浮等都依赖 transform）
//   - 拖动：开启拖动模式后直接在画面上拖拽摆放，增量按锚点换算回位置属性
//   - 持久化：写入 localStorage（键 nsa_ui_v1），启动时自动应用
//   - 世界空间标签（#labels 下的 .wlabel）每帧由 3D 投影定位，不能拖动，
//     只提供统一字号缩放（CSS 变量 --ui-label-scale）
// ---------------------------------------------------------------------------
const UI_KEY = 'nsa_ui_v1';

const SCALE_MIN = 0.5;
const SCALE_MAX = 2.5;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 锚点：
//   tl = 左上(left/top)   bl = 左下(left/bottom)   bc = 底部居中(left:50%/bottom)
//   tc = 顶部居中(left:50%/top:34%)                tr = 右上(right/top)
// xSign / ySign：拖动增量 → 位置属性增量的符号（bottom / right 锚点取反）
// display：编辑模式下需要临时把隐藏元素显示出来时使用的 display 值
export const UI_TARGETS = [
  { id: 'hudTop',    name: '顶部状态条', sel: '#hud-top',     anchor: 'tl', origin: 'top left',     display: 'flex', def: { x: 14, y: 14 },   xSign: 1,  ySign: 1 },
  { id: 'hudBottom', name: '底部操作栏', sel: '#hud-bottom',  anchor: 'bc', origin: 'center bottom', display: 'flex', def: { x: 0, y: 16 },    xSign: 1,  ySign: -1 },
  { id: 'itemBar',   name: '道具栏',     sel: '#item-bar',    anchor: 'bl', origin: 'left bottom',   display: 'flex', def: { x: 16, y: 16 },   xSign: 1,  ySign: -1 },
  { id: 'hint',      name: '中间提示条', sel: '#hint',        anchor: 'tc', origin: 'center center', display: 'block', def: { x: 0, y: 0 },    xSign: 1,  ySign: 1 },
  { id: 'toast',     name: 'toast 提示', sel: '#toast-stack', anchor: 'tr', origin: 'right top',     display: 'flex', def: { x: 14, y: 120 }, xSign: -1, ySign: 1 },
];

function defaultState() {
  const targets = {};
  UI_TARGETS.forEach((t) => { targets[t.id] = { x: t.def.x, y: t.def.y, scale: 1, visible: true }; });
  return { targets, labelScale: 1 };
}

function loadState() {
  const st = defaultState();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(UI_KEY) || 'null'); } catch (e) { saved = null; }
  if (!saved) return st;
  if (typeof saved.labelScale === 'number') st.labelScale = saved.labelScale;
  if (saved.targets) {
    UI_TARGETS.forEach((t) => {
      const s = saved.targets[t.id];
      if (!s) return;
      const cur = st.targets[t.id];
      if (typeof s.x === 'number') cur.x = s.x;
      if (typeof s.y === 'number') cur.y = s.y;
      if (typeof s.scale === 'number') cur.scale = clamp(s.scale, SCALE_MIN, SCALE_MAX);
      if (typeof s.visible === 'boolean') cur.visible = s.visible;
    });
  }
  return st;
}

export function initUITune() {
  const state = loadState();
  const els = new Map();
  UI_TARGETS.forEach((t) => els.set(t.id, document.querySelector(t.sel)));
  const labelLayer = document.getElementById('labels');

  const targetOf = (id) => UI_TARGETS.find((t) => t.id === id);
  let editing = false;
  let saveTimer = 0;
  const forced = new Set();     // 编辑模式下被临时显示出来的元素
  const listeners = [];
  let drag = null;

  const fireChange = () => { listeners.forEach((fn) => { try { fn(); } catch (e) { /* 忽略 */ } }); };
  const persist = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(state)); } catch (e) { /* 忽略 */ } };
  const persistSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 200); };

  // --- 把存储值写回元素 ---
  function apply(id) {
    const tg = targetOf(id);
    const el = els.get(id);
    if (!tg || !el) return;
    const s = state.targets[id];
    const px = (v) => `${v}px`;
    el.style.transformOrigin = tg.origin;
    el.style.scale = String(s.scale);
    if (tg.anchor === 'tl') {
      el.style.left = px(s.x);
      el.style.top = px(s.y);
    } else if (tg.anchor === 'bl') {
      el.style.left = px(s.x);
      el.style.bottom = px(s.y);
    } else if (tg.anchor === 'bc') {
      el.style.left = `calc(50% + ${s.x}px)`;
      el.style.bottom = px(s.y);
    } else if (tg.anchor === 'tc') {
      el.style.left = `calc(50% + ${s.x}px)`;
      el.style.top = `calc(34% + ${s.y}px)`;
    } else if (tg.anchor === 'tr') {
      el.style.right = px(s.x);
      el.style.top = px(s.y);
    }
    el.style.display = s.visible ? '' : 'none';
  }

  function applyLabelScale() {
    if (labelLayer) labelLayer.style.setProperty('--ui-label-scale', String(state.labelScale));
  }

  function applyAll() {
    UI_TARGETS.forEach((t) => apply(t.id));
    applyLabelScale();
  }

  // --- 拖动：把屏幕位移换算成位置属性的增量 ---
  function onDown(e) {
    if (!editing || e.button !== 0) return;
    const el = e.currentTarget;
    const id = el.dataset.uiId;
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    drag = { id, el, sx: e.clientX, sy: e.clientY, ox: state.targets[id].x, oy: state.targets[id].y };
    el.classList.add('ui-dragging');
  }

  function onMove(e) {
    if (!drag) return;
    const tg = targetOf(drag.id);
    state.targets[drag.id].x = Math.round(drag.ox + (e.clientX - drag.sx) * tg.xSign);
    state.targets[drag.id].y = Math.round(drag.oy + (e.clientY - drag.sy) * tg.ySign);
    apply(drag.id);
    persistSoon();
  }

  function onUp() {
    if (!drag) return;
    drag.el.classList.remove('ui-dragging');
    drag = null;
    persist();
    fireChange();
  }

  UI_TARGETS.forEach((tg) => {
    const el = els.get(tg.id);
    if (!el) return;
    el.dataset.uiId = tg.id;
    el.addEventListener('pointerdown', onDown);
  });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  // --- 编辑模式开关 ---
  function setEdit(on) {
    editing = !!on;
    document.body.classList.toggle('ui-edit', editing);
    UI_TARGETS.forEach((tg) => {
      const el = els.get(tg.id);
      if (!el) return;
      el.classList.toggle('ui-movable', editing);
      if (editing) {
        // 原本被隐藏的目标（如未携带道具时的道具栏）临时显示，否则没法拖
        if (state.targets[tg.id].visible !== false && getComputedStyle(el).display === 'none') {
          el.style.display = tg.display;
          forced.add(tg.id);
        }
      } else if (forced.has(tg.id)) {
        forced.delete(tg.id);
        apply(tg.id);
      }
    });
    if (!editing) persist();
  }

  // --- 窗口变化后把元素拉回可视范围（允许部分出屏，但至少留 40px） ---
  function clampAll() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    UI_TARGETS.forEach((tg) => {
      const s = state.targets[tg.id];
      const el = els.get(tg.id);
      const w = el ? el.offsetWidth : 0;
      const h = el ? el.offsetHeight : 0;
      const minX = -Math.max(0, w - 40);
      const minY = -Math.max(0, h - 40);
      if (tg.anchor === 'bc' || tg.anchor === 'tc') {
        s.x = clamp(s.x, -W / 2 + 40, W / 2 - 40);
      } else {
        s.x = clamp(s.x, minX, W - 40);
      }
      if (tg.anchor === 'bc' || tg.anchor === 'bl') {
        s.y = clamp(s.y, minY, H - 40);
      } else if (tg.anchor === 'tc') {
        s.y = clamp(s.y, -H * 0.34 + 10, H * 0.66 - 40);
      } else {
        s.y = clamp(s.y, minY, H - 40);
      }
      apply(tg.id);
    });
  }

  function resetOne(id) {
    const tg = targetOf(id);
    if (!tg) return;
    state.targets[id] = { x: tg.def.x, y: tg.def.y, scale: 1, visible: true };
    apply(id);
    persist();
    fireChange();
  }

  function resetAll() {
    const d = defaultState();
    state.labelScale = d.labelScale;
    UI_TARGETS.forEach((tg) => { state.targets[tg.id] = d.targets[tg.id]; });
    applyAll();
    persist();
    fireChange();
  }

  function resetLabels() {
    state.labelScale = 1;
    applyLabelScale();
    persist();
    fireChange();
  }

  applyAll();

  return {
    targets: UI_TARGETS,
    scaleMin: SCALE_MIN,
    scaleMax: SCALE_MAX,
    isEditing: () => editing,
    setEdit,
    get: (id) => ({ ...state.targets[id] }),
    set(id, key, val) {
      const s = state.targets[id];
      if (!s || !(key in s)) return;
      s[key] = key === 'scale' ? clamp(val, SCALE_MIN, SCALE_MAX) : val;
      apply(id);
      persistSoon();
      fireChange();
    },
    getLabelScale: () => state.labelScale,
    setLabelScale(v) {
      state.labelScale = clamp(v, 0.5, 2);
      applyLabelScale();
      persistSoon();
      fireChange();
    },
    apply,
    applyAll,
    resetOne,
    resetAll,
    resetLabels,
    clampAll,
    onChange(cb) { listeners.push(cb); },
  };
}