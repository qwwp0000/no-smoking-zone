// ---------------------------------------------------------------------------
// 离线音效：全部用 WebAudio 实时合成，不依赖任何外部音频文件
// （对应策划案 21.6 强反馈三件套之「音效反馈」）
// ---------------------------------------------------------------------------
import { CONFIG } from './config.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// 音量缩放（0~1）：由 CONFIG.audio 提供初始值，调试台可实时调整
let sfxScale = clamp01(CONFIG.audio?.sfxVolume ?? 1);
let bgmVolume = clamp01(CONFIG.audio?.bgmVolume ?? 0.5);

let ctx = null;

function audioCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch { return null; }
  return ctx;
}

/** 合成一个短音：支持滑音，用于打击感 */
function tone({ freq = 440, type = 'sine', dur = 0.18, gain = 0.08, when = 0, slideTo = null, attack = 0.008 }) {
  const a = audioCtx();
  if (!a) return;
  if (sfxScale <= 0) return;
  gain *= sfxScale;   // 合成音同样受音效总音量缩放
  if (a.state === 'suspended') a.resume();
  const t0 = a.currentTime + when;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

// ---------------------------------------------------------------------------
// 真实音频文件音效：直接播放「音效」目录下的 wav / mp3
// 每个音效预建多个 Audio 实例做池，避免上一次还没播完就被打断
// ---------------------------------------------------------------------------
// 所有真实音频文件实例登记在此，便于 setSfxVolume 统一调整音量（base × 缩放）
const fileSounds = [];

function makePool(path, volume = 0.7, voices = 3) {
  const pool = [];
  // 预加载：用 Audio 元素直接引用相对路径，http 与 file:// 下均可播放
  for (let i = 0; i < voices; i++) {
    try {
      const el = new Audio(encodeURI(path));
      el.preload = 'auto';
      el.volume = clamp01(volume * sfxScale);
      fileSounds.push({ el, base: volume });
      pool.push(el);
    } catch { /* 忽略：无法播放时静默降级 */ }
  }
  let next = 0;
  return function play() {
    if (!pool.length) return;
    const el = pool[next % pool.length];
    next++;
    try {
      if (el.readyState > 0) el.currentTime = 0;
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* 未解锁音频时忽略 */ });
    } catch { /* 忽略 */ }
  };
}

// 咳嗽（低血量震动时使用）：黄条咳嗽 1，红条咳嗽 2
const COUGH_FILES = { 1: '音效/Cough1.wav', 2: '音效/Cough2.wav' };
const COUGH_VOLUME = { 1: 0.55, 2: 0.7 };
const coughPools = {
  1: makePool(COUGH_FILES[1], COUGH_VOLUME[1]),
  2: makePool(COUGH_FILES[2], COUGH_VOLUME[2]),
};

// 按键与结算音效：E 键 / X 键 / 关卡通关 / 棒球棍打击
const keyEPool = makePool('音效/E.wav', 0.6);
const keyXPool = makePool('音效/X.mp3', 0.6);
const levelClearPool = makePool('音效/关卡通关.wav', 0.7, 2);
const batHitPool = makePool('音效/Hit.wav', 0.75);

// 背景音乐：单实例循环播放，不进入 fileSounds（音量独立于音效总音量）
let bgm = null;
let bgmStarted = false;   // 已成功开始播放：避免每次交互都重复调用 play()
let bgmPending = false;   // play() 正在等待 resolve，期间不再重复调用

function ensureBgm() {
  if (bgm) return bgm;
  try {
    bgm = new Audio(encodeURI('音效/Background music.mp3'));
    bgm.loop = true;
    bgm.preload = 'auto';
    bgm.volume = bgmVolume;
  } catch { bgm = null; }
  return bgm;
}

ensureBgm();   // 模块加载即预下载（3.6MB），首次交互时可直接播放

function playBgm() {
  const el = ensureBgm();
  // 已经开始播放、正在等待 play() 的 Promise、或已被播放，都不再重复触发
  if (!el || bgmStarted || bgmPending || !el.paused) return;
  bgmPending = true;
  const p = el.play();
  if (p && typeof p.then === 'function') {
    p.then(() => { bgmStarted = true; bgmPending = false; })
      .catch(() => { bgmPending = false; /* 播放被拦截：留待下次交互重试 */ });
  } else {
    bgmStarted = true;
    bgmPending = false;
  }
}

export const sfx = {
  /** 首次交互时解锁音频（浏览器策略要求用户手势后才能播放），同时循环播放背景音乐 */
  unlock() {
    const a = audioCtx();
    if (a && a.state === 'suspended') a.resume();
    playBgm();
  },
  /** 设置音效总音量 0~1：统一缩放全部音效（文件音效 + 合成音） */
  setSfxVolume(v) {
    sfxScale = clamp01(v);
    for (const { el, base } of fileSounds) el.volume = clamp01(base * sfxScale);
  },
  /** 设置背景音乐音量 0~1 */
  setBgmVolume(v) {
    bgmVolume = clamp01(v);
    if (bgm) bgm.volume = bgmVolume;
  },
  /** 咳嗽音效（走真实音频文件）：1 = Cough1，2 = Cough2 */
  cough(n = 1) { coughPools[n === 2 ? 2 : 1](); },
  /** E 键（提醒）：播放 E.wav */
  keyE() { keyEPool(); },
  /** X 键（道具）：播放 X.mp3 */
  keyX() { keyXPool(); },
  /** 关卡通关：播放 关卡通关.wav */
  levelClear() { levelClearPool(); },
  /** 棒球棍打中 NPC：播放 Hit.wav */
  batHit() { batHitPool(); },
  card() { tone({ freq: 320, type: 'triangle', dur: 0.10 }); tone({ freq: 540, type: 'triangle', dur: 0.08, when: 0.045 }); },
  advantage() { tone({ freq: 560, type: 'square', dur: 0.09, gain: 0.055 }); tone({ freq: 840, type: 'square', dur: 0.14, when: 0.07, gain: 0.05 }); },
  neutral() { tone({ freq: 430, type: 'sine', dur: 0.13, gain: 0.06 }); },
  countered() { tone({ freq: 320, type: 'sawtooth', dur: 0.20, gain: 0.06, slideTo: 140 }); },
  tick() { tone({ freq: 960, type: 'square', dur: 0.045, gain: 0.045 }); },
  win() { [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.22, gain: 0.07, when: i * 0.1 })); },
  lose() { [392, 311, 247].forEach((f, i) => tone({ freq: f, type: 'sawtooth', dur: 0.26, gain: 0.06, when: i * 0.13 })); },
};

/** 震动反馈：支持则用设备震动，不支持则由调用方降级为界面抖动 */
export function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* 忽略 */ }
}

export function canVibrate() {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}