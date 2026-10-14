import { CONFIG } from './config.js';

// ---------------------------------------------------------------------------
// 窗户布置：在「相对的两面墙」（上/下 或 左/右）里随机选一对各开一扇窗，
// 保证两扇窗不会挤在一起；每扇窗占墙 span 格、朝房间内侧，
// 窗户正前方的 span×depth 格为洁净区（无烟安全区）。
// 第 2~4 关使用（见 CONFIG.window.fromLevel / toLevel）。
// ---------------------------------------------------------------------------

// 确定性伪随机（同关卡布局稳定，便于试玩与复现）
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIDES = ['up', 'down', 'left', 'right'];
// 各面墙的「朝向房间内侧」方向与旋转角（局部 +Z = 内侧）
const INWARD = {
  up: { dx: 0, dz: 1 },
  down: { dx: 0, dz: -1 },
  left: { dx: 1, dz: 0 },
  right: { dx: -1, dz: 0 },
};
const YAW = { up: 0, down: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 };

// 洁净区内不允许出现的地图字符：吸烟区 / 出口 / 各类出生点与提示牌
const FORBIDDEN = new Set(['S', 'D']);
const OCCUPIED = new Set(['1', '2', '3', 'A', 'M', 'p', '+', '-']);

/** 某一面墙沿墙的格子序列 */
function wallLine(grid, side) {
  const out = [];
  if (side === 'up') { for (let x = 0; x < grid.w; x++) out.push({ x, z: 0 }); }
  else if (side === 'down') { for (let x = 0; x < grid.w; x++) out.push({ x, z: grid.h - 1 }); }
  else if (side === 'left') { for (let z = 0; z < grid.h; z++) out.push({ x: 0, z }); }
  else { for (let z = 0; z < grid.h; z++) out.push({ x: grid.w - 1, z }); }
  return out;
}

/** 枚举某面墙上所有合法的窗户位置 */
function candidatesOfSide(grid, side) {
  const W = CONFIG.window;
  const dir = INWARD[side];
  const line = wallLine(grid, side);
  const out = [];
  for (let i = 0; i + W.span <= line.length; i++) {
    const cells = line.slice(i, i + W.span);
    if (!cells.every((c) => grid.charAt(c.x, c.z) === '#')) continue;
    const zone = [];
    let ok = true;
    for (const c of cells) {
      for (let d = 1; d <= W.depth; d++) {
        const zx = c.x + dir.dx * d;
        const zz = c.z + dir.dz * d;
        if (!grid.inBounds(zx, zz) || !grid.isWalkable(zx, zz) || FORBIDDEN.has(grid.charAt(zx, zz))) { ok = false; break; }
        // 洁净区及其紧邻范围内不得有 NPC / 路人 / 提示牌等，避免“窗户边上抽烟”
        for (let rz = -W.npcAvoidRadius; rz <= W.npcAvoidRadius && ok; rz++) {
          for (let rx = -W.npcAvoidRadius; rx <= W.npcAvoidRadius && ok; rx++) {
            const px = zx + rx, pz = zz + rz;
            if (grid.inBounds(px, pz) && OCCUPIED.has(grid.charAt(px, pz))) ok = false;
          }
        }
        if (!ok) break;
        zone.push({ x: zx, z: zz });
      }
      if (!ok) break;
    }
    if (!ok) continue;
    out.push({ side, cells, zone, dir, yaw: YAW[side] });
  }
  return out;
}

/**
 * 计算本关窗户布置。
 * @returns {Array<{side, cells, zone, dir, yaw}>}
 */
export function computeWindows(grid) {
  const W = CONFIG.window;
  const pool = {};
  for (const s of SIDES) pool[s] = candidatesOfSide(grid, s);

  const rng = mulberry32(W.seed + grid.w * 131 + grid.h * 17);

  const chosen = [];
  const occupied = new Set();          // 已选窗户洁净区格子，尽量避免两扇窗的洁净区叠在一起
  const overlaps = (win) => win.zone.some((c) => occupied.has(`${c.x},${c.z}`));
  const pickFrom = (side) => {
    const list = pool[side];
    if (!list.length) return false;
    const free = list.filter((w) => !overlaps(w));
    const from = free.length ? free : list;
    const win = from[Math.floor(rng() * from.length)];
    chosen.push(win);
    for (const c of win.zone) occupied.add(`${c.x},${c.z}`);
    return true;
  };

  // 两扇窗不能靠在一起：只在「相对的两面墙」成对开窗（上/下 或 左/右）
  const PAIRS = [['up', 'down'], ['left', 'right']];
  const pairOrder = PAIRS.slice();
  for (let i = pairOrder.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pairOrder[i], pairOrder[j]] = [pairOrder[j], pairOrder[i]];
  }
  for (const [a, b] of pairOrder) {
    if (!pool[a].length || !pool[b].length) continue;
    pickFrom(a);
    pickFrom(b);
    break;
  }

  // 兜底：相对墙面都开不出窗时，退回「随机选两面」
  if (!chosen.length) {
    const order = SIDES.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const s of order) {
      if (chosen.length >= W.count) break;
      pickFrom(s);
    }
  }

  return chosen.slice(0, W.count);
}
