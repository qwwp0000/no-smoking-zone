import { CONFIG } from './config.js';

// 地图图例
//  #  墙            .  室内地砖        ~  室外铺装
//  S  指定吸烟区     o  障碍物(座椅/花坛等)   V  通风设备
//  B  管理亭        D  出口/门(路人目标)   +  正确提示牌   -  错误提示牌
//  1/2/3 目标NPC     A  三级NPC-2(争论型)   M  管理人员          p  路人            P  玩家出生点
//  .  普通地板
export const BLOCKING = new Set(['#', 'o', 'V', 'B']);

export class Grid {
  constructor(rows) {
    this.rawRows = rows;
    this.h = rows.length;
    this.w = Math.max(...rows.map((r) => r.length));
    // 补全为矩形
    this.cells = [];
    for (let z = 0; z < this.h; z++) {
      const row = rows[z].padEnd(this.w, '#');
      for (let x = 0; x < this.w; x++) this.cells.push(row[x]);
    }
    this.smoke = new Float32Array(this.w * this.h);
    this.ventField = new Float32Array(this.w * this.h);
    this.purifyField = new Float32Array(this.w * this.h);   // 空气净化器清除场
    this.windowField = new Float32Array(this.w * this.h);   // 窗户洁净区场（无烟安全区）
    this.windowZoneIdx = [];                                // 洁净区格子索引（每步强制清烟）
    this.windowAvoid = new Set();                           // 窗户附近（NPC 不在此抽烟）
    this.windows = [];
    this._bank = new Float32Array(this.w * this.h);
    this._bank2 = new Float32Array(this.w * this.h);
    this._fans = [];                                        // 便携风扇（改变烟雾流向）
    this._barrier = new Set();                              // 隔离挡板（阻断烟雾扩散）
    this.marks = {};        // 图例 -> [{x,z}]
    this.scanMarks();
  }

  scanMarks() {
    for (let z = 0; z < this.h; z++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.cells[this.i(x, z)];
        if ('.#S~oVD123AMpP+-'.includes(c)) {
          (this.marks[c] ||= []).push({ x, z });
        }
      }
    }
  }

  i(x, z) { return z * this.w + x; }
  inBounds(x, z) { return x >= 0 && z >= 0 && x < this.w && z < this.h; }
  charAt(x, z) { return this.inBounds(x, z) ? this.cells[this.i(x, z)] : '#'; }
  isWalkable(x, z) { return this.inBounds(x, z) && !BLOCKING.has(this.cells[this.i(x, z)]); }
  isWall(x, z) { return !this.isWalkable(x, z); }

  /** 设置窗户：填充洁净区场，并标记「NPC 不得在此抽烟」的避让范围 */
  setWindows(windows) {
    this.windows = windows || [];
    this.windowField.fill(0);
    this.windowZoneIdx = [];
    this.windowAvoid = new Set();
    const R = CONFIG.window?.npcAvoidRadius ?? 2;
    const field = CONFIG.window?.safeField ?? 1;
    for (const win of this.windows) {
      for (const c of win.zone) {
        if (!this.inBounds(c.x, c.z)) continue;
        const idx = this.i(c.x, c.z);
        this.windowField[idx] = field;
        this.windowZoneIdx.push(idx);
      }
      for (const c of [...win.cells, ...win.zone]) {
        for (let dz = -R; dz <= R; dz++) {
          for (let dx = -R; dx <= R; dx++) {
            const nx = c.x + dx, nz = c.z + dz;
            if (this.inBounds(nx, nz)) this.windowAvoid.add(this.i(nx, nz));
          }
        }
      }
    }
  }

  /** 该格是否在窗户附近（NPC 不应在此抽烟） */
  isWindowAvoid(x, z) { return this.inBounds(x, z) && this.windowAvoid.has(this.i(x, z)); }

  /** 格子中心的世界坐标（关卡以网格中心为原点） */
  worldOf(x, z) {
    return {
      x: (x - (this.w - 1) / 2) * CONFIG.tile,
      z: (z - (this.h - 1) / 2) * CONFIG.tile,
    };
  }
  /** 世界坐标 -> 最近格子 */
  cellOf(wx, wz) {
    return {
      x: Math.round(wx / CONFIG.tile + (this.w - 1) / 2),
      z: Math.round(wz / CONFIG.tile + (this.h - 1) / 2),
    };
  }

  allTilesOf(chars) {
    const out = [];
    for (let z = 0; z < this.h; z++) {
      for (let x = 0; x < this.w; x++) {
        if (chars.includes(this.cells[this.i(x, z)])) out.push({ x, z });
      }
    }
    return out;
  }

  // ---------------- 寻路：A*（8 向 + 拐角判定） ----------------
  findPath(start, goal, opts = {}) {
    const { avoidSmoke = null, blockedExtra = null } = opts;
    if (!this.isWalkable(goal.x, goal.z)) {
      goal = this.nearestWalkable(goal) || goal;
    }
    if (!this.isWalkable(goal.x, goal.z) || !this.isWalkable(start.x, start.z)) return null;

    const key = (x, z) => z * this.w + x;
    const open = [{ x: start.x, z: start.z, g: 0, f: 0, parent: null }];
    const best = new Map();
    best.set(key(start.x, start.z), 0);
    const closed = new Set();
    const DIRS = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142],
    ];
    const depthLimit = this.w * this.h * 2;
    let iterate = 0;

    while (open.length) {
      if (++iterate > depthLimit) break;
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k].f < open[bi].f) bi = k;
      const cur = open.splice(bi, 1)[0];
      const ck = key(cur.x, cur.z);
      if (closed.has(ck)) continue;
      closed.add(ck);

      if (cur.x === goal.x && cur.z === goal.z) {
        const path = [];
        for (let n = cur; n; n = n.parent) path.push({ x: n.x, z: n.z });
        return path.reverse();
      }

      for (const [dx, dz, cost] of DIRS) {
        const nx = cur.x + dx, nz = cur.z + dz;
        if (!this.isWalkable(nx, nz)) continue;
        if (dx && dz && (!this.isWalkable(cur.x + dx, cur.z) || !this.isWalkable(cur.x, cur.z + dz))) continue;
        if (blockedExtra && blockedExtra(nx, nz)) continue;

        let step = cost;
        if (avoidSmoke) {
          const s = this.smoke[this.i(nx, nz)];
          if (s > avoidSmoke) step *= 1 + (s - avoidSmoke) * 22; // 高浓度区域代价极高
        }
        const g = cur.g + step;
        const nk = key(nx, nz);
        if (best.has(nk) && best.get(nk) <= g) continue;
        best.set(nk, g);
        const hx = Math.abs(nx - goal.x), hz = Math.abs(nz - goal.z);
        const hcost = Math.max(hx, hz) + (Math.SQRT2 - 1) * Math.min(hx, hz);
        open.push({ x: nx, z: nz, g, f: g + hcost * 1.05, parent: cur });
      }
    }
    return null;
  }

  nearestWalkable(cell, filter = null) {
    let best = null, bd = Infinity;
    for (let z = 0; z < this.h; z++) {
      for (let x = 0; x < this.w; x++) {
        if (!this.isWalkable(x, z)) continue;
        if (filter && !filter(x, z)) continue;
        const d = (x - cell.x) ** 2 + (z - cell.z) ** 2;
        if (d < bd) { bd = d; best = { x, z }; }
      }
    }
    return best;
  }

  /** 视线判定：用于提示牌遮挡（对应策划案 6.1 可见性） */
  hasLineOfSight(a, b) {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(2, Math.ceil(dist * 4));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = Math.round(a.x + (b.x - a.x) * t);
      const z = Math.round(a.z + (b.z - a.z) * t);
      if (x === b.x && z === b.z) return true;
      if (this.isWall(x, z)) return false;
    }
    return true;
  }

  // ---------------- 烟雾模拟（网格浓度扩散，对应策划案 4.3） ----------------
  /**
   * @param {number} dt 秒
   * @param {Array<{cell:{x,z}, rate:number}>} sources 烟雾源
   * @param {Array<{cell:{x,z}, active:boolean, strength:number}>} vents 通风设备
   * @param {Array} equips 辅助装备
   * @param {{radiusLimit?:number}} opts 可选：把烟雾限制在烟雾源周围若干格内（教学关用）
   */
  stepSmoke(dt, sources, vents, equips = [], opts = {}) {
    const { diffusion, decay, max, ventRemoval } = CONFIG.smoke;
    const n = this.w * this.h;
    const s = this.smoke, bank = this._bank;
    bank.fill(0);

    // 辅助装备场（净化器清除场 / 风扇 / 挡板）
    this.updateEquipFields(equips);

    // 1) 扩散：与可通行邻格交换浓度（挡板阻断）
    for (let z = 0; z < this.h; z++) {
      for (let x = 0; x < this.w; x++) {
        const idx = this.i(x, z);
        const v = s[idx];
        if (v <= 0.0001) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (!this.isWalkable(nx, nz)) continue;
          const nIdx = this.i(nx, nz);
          if (this._barrier.has(nIdx)) continue;    // 隔离挡板：烟雾不进入
          const flow = diffusion * 0.25 * (v - s[nIdx]);
          bank[idx] -= flow;
          bank[nIdx] += flow;
        }
      }
    }
    for (let k = 0; k < n; k++) s[k] += bank[k] * dt * 10.0;

    // 2) 通风场（用于清除与恢复判定）
    this.updateVentField(vents);

    // 3) 通风 + 净化器 + 窗户洁净区清除 / 自然消散
    const windowClearRate = CONFIG.window?.clearRate ?? 0;
    for (let k = 0; k < n; k++) {
      if (s[k] <= 0) continue;
      const removal = ventRemoval * this.ventField[k] + ventRemoval * this.purifyField[k] + windowClearRate * this.windowField[k];
      s[k] -= s[k] * (decay + removal) * dt;
      if (s[k] < 0) s[k] = 0;
    }

    // 4) 风扇：把烟雾往朝向方向推（改变烟雾流向，对应 12.3）
    if (this._fans.length) {
      const b2 = this._bank2;
      b2.fill(0);
      for (const fan of this._fans) {
        const dirX = Math.sin(fan.angle), dirZ = Math.cos(fan.angle);
        const r = CONFIG.equip.fan.radius, push = CONFIG.equip.fan.push * (fan.powerRatio || 1);
        const cx = fan.tile.x, cz = fan.tile.z;
        const r2 = r * r;
        for (let z = Math.max(0, cz - Math.ceil(r)); z <= Math.min(this.h - 1, cz + Math.ceil(r)); z++) {
          for (let x = Math.max(0, cx - Math.ceil(r)); x <= Math.min(this.w - 1, cx + Math.ceil(r)); x++) {
            const d2 = (x - cx) ** 2 + (z - cz) ** 2;
            if (d2 > r2) continue;
            const idx = this.i(x, z);
            const v = s[idx];
            if (v <= 0.0001) continue;
            const nx = x + Math.round(dirX), nz = z + Math.round(dirZ);
            if (!this.isWalkable(nx, nz)) continue;
            const nIdx = this.i(nx, nz);
            if (this._barrier.has(nIdx)) continue;
            // 定向输运（对流）：把本格的烟按自身浓度搬到朝向的邻格。
            // 注意不能用 (v - s[nIdx])，那只是沿该轴做额外扩散，推不动烟流（旧 bug）。
            const flow = push * 0.3 * v;
            b2[idx] -= flow;
            b2[nIdx] += flow;
          }
        }
      }
      for (let k = 0; k < n; k++) {
        s[k] += b2[k] * dt;
        if (s[k] < 0) s[k] = 0;
      }
    }

    // 5) 烟雾源释放
    for (const src of sources) {
      if (!this.inBounds(src.cell.x, src.cell.z)) continue;
      const idx = this.i(src.cell.x, src.cell.z);
      s[idx] = Math.min(max, s[idx] + src.rate * dt);
    }

    // 6) 教学关烟雾范围限制：清除烟雾源 radiusLimit 格之外的烟雾
    //    （无烟雾源时不限制，让残留烟雾按自身衰减消散）
    const limit = opts.radiusLimit;
    if (limit && sources.length) {
      const r2 = limit * limit;
      for (let z = 0; z < this.h; z++) {
        for (let x = 0; x < this.w; x++) {
          const idx = this.i(x, z);
          if (s[idx] <= 0) continue;
          let near = false;
          for (const src of sources) {
            const dx = x - src.cell.x, dz = z - src.cell.z;
            if (dx * dx + dz * dz <= r2) { near = true; break; }
          }
          if (!near) s[idx] = 0;
        }
      }
    }

    // 7) 窗户洁净区：强制压到极低浓度 → 窗户前方「消除烟雾」（无烟安全区）
    if (this.windowZoneIdx.length) {
      const cap = CONFIG.window?.safeCap ?? 0;
      for (const idx of this.windowZoneIdx) if (s[idx] > cap) s[idx] = cap;
    }
  }

  /** 汇总辅助装备对烟雾的影响（对应策划案 12.3） */
  updateEquipFields(equips) {
    this.purifyField.fill(0);
    this._fans.length = 0;
    this._barrier.clear();
    if (!equips || !equips.length) return;
    for (const e of equips) {
      if (!e.active) continue;
      if (e.type === 'purifier') {
        const spec = CONFIG.equip.purifier;
        const r = spec.radius, r2 = r * r;
        for (let z = 0; z < this.h; z++) {
          for (let x = 0; x < this.w; x++) {
            if (!this.isWalkable(x, z)) continue;
            const d2 = (x - e.tile.x) ** 2 + (z - e.tile.z) ** 2;
            if (d2 > r2) continue;
            const f = Math.max(0, 1 - Math.sqrt(d2) / r) * spec.strength * (e.powerRatio || 1);
            const idx = this.i(x, z);
            this.purifyField[idx] = Math.min(1, this.purifyField[idx] + f);
          }
        }
      } else if (e.type === 'fan') {
        this._fans.push(e);
      } else if (e.type === 'barrier') {
        // 挡板阻断范围：曼哈顿距离 ≤ block 的格子全部拒绝烟雾流入
        // （block=1 → 自身 + 上下左右，共 5 格，形成一格宽的挡烟面）
        const spread = CONFIG.equip.barrier.block ?? 0;
        for (let dz = -spread; dz <= spread; dz++) {
          for (let dx = -spread; dx <= spread; dx++) {
            if (Math.abs(dx) + Math.abs(dz) > spread) continue;
            const nx = e.tile.x + dx, nz = e.tile.z + dz;
            if (this.inBounds(nx, nz)) this._barrier.add(this.i(nx, nz));
          }
        }
      }
    }
  }

  updateVentField(vents) {
    const { ventRadius } = CONFIG.smoke;
    this.ventField.fill(0);
    for (const v of vents) {
      if (!v.active) continue;
      const r = ventRadius * (v.strength ?? 1);
      const r2 = r * r;
      for (let z = 0; z < this.h; z++) {
        for (let x = 0; x < this.w; x++) {
          if (!this.isWalkable(x, z)) continue;
          const d2 = (x - v.cell.x) ** 2 + (z - v.cell.z) ** 2;
          if (d2 > r2) continue;
          const f = Math.max(0, 1 - Math.sqrt(d2) / r);
          const idx = this.i(x, z);
          this.ventField[idx] = Math.min(1, this.ventField[idx] + f);
        }
      }
    }
  }

  smokeAt(x, z) { return this.inBounds(x, z) ? this.smoke[this.i(x, z)] : 0; }
  smokeAtWorld(wx, wz) { const c = this.cellOf(wx, wz); return this.smokeAt(c.x, c.z); }
  /** 安全区强度：取通风场与窗户洁净区场中较高者（窗户前方同样可回血） */
  ventAtWorld(wx, wz) {
    const c = this.cellOf(wx, wz);
    if (!this.inBounds(c.x, c.z)) return 0;
    const idx = this.i(c.x, c.z);
    return Math.max(this.ventField[idx], this.windowField[idx]);
  }
}