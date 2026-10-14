import * as THREE from 'three';
import { PALETTE as P, CONFIG } from './config.js';

// ---------------------------------------------------------------------------
// 低多边形等距场景（配色与构图参考“参考图”：暖陶土 + 奶油地砖 + 暗棕背景 + 立体模型地台）
// ---------------------------------------------------------------------------

const M = {}; // 材质缓存
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!M[key]) M[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.94, metalness: 0, ...opts });
  return M[key];
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(P.bg);
  scene.fog = new THREE.Fog(P.fog, 42, 88);

  const hemi = new THREE.HemisphereLight(0xffe9cf, 0x3d2b20, 0.72);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffe4bd, 1.45);
  key.position.set(-9, 15, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0007;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  scene.userData.keyLight = key;

  const fill = new THREE.DirectionalLight(0xbcd0e0, 0.35);
  fill.position.set(10, 8, -8);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffbf87, 0.35);
  rim.position.set(3, 4, 14);
  scene.add(rim);

  return scene;
}

export function createCamera(aspect, grid) {
  const cam = new THREE.PerspectiveCamera(CONFIG.camera.fov, aspect, 0.1, 400);
  cam.userData.distance = computeDistance(grid, aspect);
  return cam;
}

/** 玩家可活动区域（可通行格）的世界坐标包围盒 */
export function activityBounds(grid) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let z = 0; z < grid.h; z++) {
    for (let x = 0; x < grid.w; x++) {
      if (!grid.isWalkable(x, z)) continue;
      const p = grid.worldOf(x, z);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
  }
  const t = CONFIG.tile;
  if (!isFinite(minX)) {
    return { cx: 0, cz: 0, halfX: (grid.w * t) / 2, halfZ: (grid.h * t) / 2 };
  }
  return {
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    halfX: (maxX - minX + t) / 2,
    halfZ: (maxZ - minZ + t) / 2,
  };
}

/** 按玩家可活动区域与窗口比例计算相机距离（为正交视图下刚好框住该区域的距离） */
export function computeDistance(grid, aspect) {
  const { pitch, fov, edgePadding, viewScale } = CONFIG.camera;
  const b = activityBounds(grid);
  const tanY = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const tanX = tanY * Math.max(aspect, 0.6);
  const halfDiag = b.halfX + b.halfZ;             // 等距投影下活动区域的半对角
  const horiz = halfDiag * 2 + 1.2;
  const vert = halfDiag * 2 * Math.sin(pitch) + 3.6;
  const fit = Math.max(horiz / 2 / tanX, vert / 2 / tanY) * (edgePadding + 0.5);
  return fit * viewScale;
}

/** 等距相机目标位置 */
export function isoCameraTarget(center, distance, heightLift = 0) {
  const { rotY, pitch } = CONFIG.camera;
  return new THREE.Vector3(
    center.x + Math.sin(rotY) * Math.cos(pitch) * distance,
    center.y + Math.sin(pitch) * distance + heightLift,
    center.z + Math.cos(rotY) * Math.cos(pitch) * distance,
  );
}

// ---------------------------------------------------------------------------
// 角色模型（低多边形小人）
// ---------------------------------------------------------------------------
export function makeCharacter({ cloth = P.cloth[0], hair = P.hairDark, skin = P.skin, scale = 1 } = {}) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.3, 4, 10), mat(cloth));
  body.position.y = 0.56;
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 12), mat(skin));
  head.position.y = 0.94;
  head.castShadow = true;
  g.add(head);

  const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.163, 14, 12), mat(hair));
  hairMesh.position.set(0, 0.965, -0.012);
  hairMesh.scale.set(1, 0.86, 1.02);
  g.add(hairMesh);

  const legGeo = new THREE.CapsuleGeometry(0.062, 0.22, 3, 8);
  const legL = new THREE.Mesh(legGeo, mat(0x5b4a3c));
  legL.position.set(-0.09, 0.2, 0);
  const legR = legL.clone();
  legR.position.x = 0.09;
  legL.castShadow = legR.castShadow = true;
  g.add(legL, legR);

  const armGeo = new THREE.CapsuleGeometry(0.05, 0.2, 3, 8);
  const armL = new THREE.Mesh(armGeo, mat(cloth));
  armL.position.set(-0.22, 0.6, 0);
  const armR = new THREE.Mesh(armGeo, mat(cloth));
  armR.position.set(0.22, 0.6, 0);
  armL.castShadow = armR.castShadow = true;
  g.add(armL, armR);

  g.scale.setScalar(scale);
  return { group: g, body, head, legL, legR, armL, armR };
}

/** 头顶“冒火”愤怒标识（路人处于烟雾中过久时显示） */
export function makeFlame() {
  const g = new THREE.Group();
  const outerMat = new THREE.MeshStandardMaterial({
    color: 0xff7a1e, emissive: 0xff5a00, emissiveIntensity: 1.3,
    roughness: 0.6, transparent: true, opacity: 0.92,
  });
  const innerMat = new THREE.MeshStandardMaterial({
    color: 0xffe08a, emissive: 0xffcf3a, emissiveIntensity: 1.7, roughness: 0.45,
  });
  const outer = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.36, 8), outerMat);
  outer.position.y = 0.18;
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.22, 8), innerMat);
  inner.position.y = 0.13;
  g.add(outer, inner);
  g.userData.outer = outer;
  return g;
}

/** 香烟（含亮起的烟头） */
export function makeCigarette() {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.16, 6), mat(0xf6f1e6));
  stick.rotation.z = Math.PI / 2;
  g.add(stick);
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 8), mat(0xff7a3d, { emissive: 0xff5a1f, emissiveIntensity: 1.6 }));
  ember.position.x = 0.09;
  g.add(ember);
  return g;
}

/**
 * 道具 3D 模型（供场景放置、物品栏缩略图、拖拽虚影共用）。
 * 返回 { group, fan }：fan 为需要转动的扇叶节点（便携风扇）。
 */
export function buildEquipGroup(type) {
  const grp = new THREE.Group();
  let fan = null;
  if (type === 'purifier') {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.12, 14), mat(P.metalDark));
    base.position.y = 0.06; base.castShadow = true;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.84, 14), mat(P.teal));
    body.position.y = 0.55; body.castShadow = true;
    const grille = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.28, 14), mat(P.paper));
    grille.position.y = 0.72;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.26, 0.1, 14), mat(P.amber));
    cap.position.y = 1.0;
    grp.add(base, body, grille, cap);
  } else if (type === 'fan') {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.1, 12), mat(P.metalDark));
    base.position.y = 0.05; base.castShadow = true;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.16), mat(P.blue));
    body.position.y = 0.42; body.castShadow = true;
    fan = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.36, 0.03), mat(P.metal));
      b.rotation.z = (k / 4) * Math.PI * 2;
      fan.add(b);
    }
    fan.position.set(0, 0.42, 0.12);
    grp.add(base, body, fan);
  } else if (type === 'barrier') {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.7, 0.12), mat(P.woodDark));
    panel.position.y = 0.35; panel.castShadow = true;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), mat(P.metalDark));
    foot.position.y = 0.03;
    grp.add(panel, foot);
  } else if (type === 'bat') {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 10), mat(P.woodDark));
    handle.position.y = 0.25;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.05, 0.42, 12), mat(0xc98a4b));
    barrel.position.y = 0.68;
    grp.add(handle, barrel);
  }
  return { group: grp, fan };
}

/** 脚下圆形光效（用于吸烟 NPC 的红色光圈等） */
export function makeFootGlow(color, radius, opacity) {
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.016;
  return glow;
}

// ---------------------------------------------------------------------------
// 场景构建
// ---------------------------------------------------------------------------
export class World {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.smokeMesh = null;
    this.anchors = {};
    this.dynamic = [];
    this.trees = [];
  }

  clear() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.root.clear();
    this.dynamic.length = 0;
    this.trees.length = 0;
    this.anchors = {};
  }

  build(grid, level, windows = []) {
    this.clear();
    const worldOf = (c) => grid.worldOf(c.x, c.z);
    const tile = CONFIG.tile;
    // 窗户占用的墙格：这些格不生成实体墙，改由 buildWindow 单独构建（形成真实窗洞）
    const windowCellKeys = new Set();
    for (const win of windows) for (const c of win.cells) windowCellKeys.add(`${c.x},${c.z}`);

    // --- 地台（立体模型底座） ---
    const span = Math.max(grid.w, grid.h);
    const slabR = span * 0.66 + 1.3;
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(slabR, slabR * 0.985, 0.55, 48), mat(P.floorEdge));
    slab.position.y = -0.42;
    slab.receiveShadow = true;
    this.root.add(slab);

    const under = new THREE.Mesh(
      new THREE.CylinderGeometry(slabR * 0.72, slabR * 0.5, 1.7, 30),
      mat(0x2b1e17),
    );
    under.position.y = -1.5;
    this.root.add(under);

    // --- 地面格 ---
    const floorGeo = new THREE.BoxGeometry(tile * 0.99, 0.14, tile * 0.99);
    const floorCount = grid.w * grid.h;
    const floorMesh = new THREE.InstancedMesh(floorGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), floorCount);
    floorMesh.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    let fi = 0;
    for (let z = 0; z < grid.h; z++) {
      for (let x = 0; x < grid.w; x++) {
        const ch = grid.charAt(x, z);
        const w = grid.worldOf(x, z);
        const checker = (x + z) % 2 === 0 ? P.floorA : P.floorB;
        let c = checker;
        if (ch === 'S') c = P.floorSmoking;
        else if (ch === '#' || ch === 'o' || ch === 'B' || ch === 'V') c = P.floorOut;
        else if (ch === '~' || ch === 'D') c = P.floorOut;
        m4.makeTranslation(w.x, -0.07, w.z);
        floorMesh.setMatrixAt(fi, m4);
        col.setHex(c);
        const jitter = 1 + (Math.sin(x * 12.9898 + z * 78.233) * 0.5 + 0.5 - 0.5) * 0.045;
        col.multiplyScalar(jitter);
        floorMesh.setColorAt(fi, col);
        fi++;
      }
    }
    floorMesh.instanceMatrix.needsUpdate = true;
    this.root.add(floorMesh);

    // --- 墙体 ---
    const wallTiles = [];
    for (let z = 0; z < grid.h; z++) {
      for (let x = 0; x < grid.w; x++) {
        const ch = grid.charAt(x, z);
        if (ch !== '#' && ch !== 'o' && ch !== 'V' && ch !== 'B') continue;
        if (windowCellKeys.has(`${x},${z}`)) continue;   // 窗户格改由 buildWindow 构建
        wallTiles.push({ x, z, ch });
      }
    }
    const obsGeo = new THREE.BoxGeometry(tile * 0.99, 1.62, tile * 0.99);
    const obsMesh = new THREE.InstancedMesh(obsGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), wallTiles.length);
    obsMesh.castShadow = true;
    obsMesh.receiveShadow = true;
    wallTiles.forEach((t, i) => {
      const w = grid.worldOf(t.x, t.z);
      m4.makeTranslation(w.x, 0.81, w.z);
      obsMesh.setMatrixAt(i, m4);
      col.setHex(t.ch === '#' ? P.wall : P.wood);
      if (t.ch === 'V') col.setHex(P.metalDark);
      obsMesh.setColorAt(i, col);
    });
    obsMesh.instanceMatrix.needsUpdate = true;
    this.root.add(obsMesh);

    // 墙顶压边（让轮廓更清晰，参考图里的浅色台面）
    const capGeo = new THREE.BoxGeometry(tile * 1.03, 0.09, tile * 1.03);
    const capMesh = new THREE.InstancedMesh(capGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), wallTiles.length);
    wallTiles.forEach((t, i) => {
      const w = grid.worldOf(t.x, t.z);
      m4.makeTranslation(w.x, 1.66, w.z);
      capMesh.setMatrixAt(i, m4);
      col.setHex(t.ch === 'V' ? P.metal : P.wallTop);
      capMesh.setColorAt(i, col);
    });
    capMesh.instanceMatrix.needsUpdate = true;
    this.root.add(capMesh);

    // --- 门（教学关：走到门前按 E / 点击即可开门进入第一关） ---
    this.anchors.door = null;
    if (level.door) {
      const dt = grid.allTilesOf('D')[0];
      if (dt) {
        const w = grid.worldOf(dt.x, dt.z);
        // 朝向房间内侧：取第一个可通行的相邻格方向
        let dir = { dx: -1, dz: 0 };
        for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          if (grid.isWalkable(dt.x + dx, dt.z + dz)) { dir = { dx, dz }; break; }
        }
        const theta = dir.dx === -1 ? 0 : dir.dx === 1 ? Math.PI : dir.dz === -1 ? -Math.PI / 2 : Math.PI / 2;
        const grp = new THREE.Group();
        grp.position.set(w.x, 0, w.z);
        grp.rotation.y = theta;

        const H = 1.62;
        const half = tile * 0.46;
        const postGeo = new THREE.BoxGeometry(0.16, H, 0.16);
        const postA = new THREE.Mesh(postGeo, mat(P.woodDark));
        postA.position.set(0, H / 2, -half);
        const postB = new THREE.Mesh(postGeo, mat(P.woodDark));
        postB.position.set(0, H / 2, half);
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, tile * 0.98), mat(P.woodDark));
        lintel.position.set(0, H, 0);

        // 门板绕左侧门柱旋转打开
        const pivot = new THREE.Group();
        pivot.position.set(0, 0, -half);
        const panel = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, H * 0.86, tile * 0.86),
          mat(P.blue, { emissive: 0x1d4e6b, emissiveIntensity: 0.4 }),
        );
        panel.position.set(0, H * 0.46, tile * 0.43);
        panel.castShadow = true;
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), mat(P.amber));
        knob.position.set(-0.09, H * 0.46, tile * 0.74);
        pivot.add(panel, knob);

        grp.add(postA, postB, lintel, pivot);
        grp.userData.kind = 'door';
        this.root.add(grp);
        this.anchors.door = { group: grp, pivot, open: false };
      }
    }

    // --- 吸烟区布置 ---
    const smokingTiles = grid.allTilesOf('S');
    if (smokingTiles.length) {
      const cx = smokingTiles.reduce((a, t) => a + t.x, 0) / smokingTiles.length;
      const cz = smokingTiles.reduce((a, t) => a + t.z, 0) / smokingTiles.length;
      const wc = grid.worldOf(cx, cz);
      this.anchors.smokingArea = { x: cx, z: cz, wx: wc.x, wz: wc.z };

      // 地面圈线（加强的绿光引导：填充 + 双层亮圈，并做呼吸动画）
      const H = CONFIG.highlight;
      const fill = new THREE.Mesh(
        new THREE.CircleGeometry(tile * 1.75, 48),
        new THREE.MeshBasicMaterial({ color: 0x7f9b62, transparent: true, opacity: H.smokingAreaFillOpacity, depthWrite: false, side: THREE.DoubleSide }),
      );
      fill.rotation.x = -Math.PI / 2;
      fill.position.set(wc.x, 0.011, wc.z);
      this.root.add(fill);

      const glow = new THREE.Mesh(
        new THREE.RingGeometry(tile * 1.78, tile * 2.5, 48),
        new THREE.MeshBasicMaterial({ color: 0x9fd47a, transparent: true, opacity: H.smokingAreaFillOpacity * 0.5, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(wc.x, 0.01, wc.z);
      this.root.add(glow);

      const ring = new THREE.Mesh(new THREE.RingGeometry(tile * 0.95, tile * 1.75, 40), new THREE.MeshBasicMaterial({ color: 0x7f9b62, transparent: true, opacity: H.smokingAreaRingOpacity, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(wc.x, 0.012, wc.z);
      this.root.add(ring);

      // 记录供每帧呼吸动画使用
      this.anchors.smokingGlow = { fill, ring, glow };

      // 立式烟灰柱
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 1.05, 10), mat(P.metalDark));
      post.position.set(wc.x, 0.52, wc.z);
      post.castShadow = true;
      this.root.add(post);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.2, 12), mat(P.metal));
      head.position.set(wc.x, 1.11, wc.z);
      head.castShadow = true;
      this.root.add(head);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 12), mat(0x4a4a48));
      bowl.position.set(wc.x, 1.23, wc.z);
      this.root.add(bowl);

      // 标识牌
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.42, 0.05), mat(P.greenB));
      board.position.set(wc.x, 1.62, wc.z);
      board.castShadow = true;
      this.root.add(board);
      const glyph = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.02), mat(0xf1e4cd));
      glyph.position.set(wc.x, 1.62, wc.z + 0.035);
      this.root.add(glyph);
    }

    // --- 通风设备 ---
    this.anchors.vents = [];
    const ventTiles = grid.allTilesOf('V');
    ventTiles.forEach((t, i) => {
      const w = grid.worldOf(t.x, t.z);
      const grp = new THREE.Group();
      grp.position.set(w.x, 0, w.z);

      const base = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.1, 0.86), mat(P.metalDark));
      base.position.y = 0.05;
      grp.add(base);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.74, 1.15, 0.74), mat(P.amberLight));
      body.position.y = 0.63;
      body.castShadow = true;
      body.receiveShadow = true;
      grp.add(body);
      const grill = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.06, 18), mat(P.metalDark));
      grill.rotation.x = Math.PI / 2;
      grill.position.set(0, 0.75, 0.38);
      grp.add(grill);
      const fanGrp = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.03), mat(P.metal));
        blade.rotation.z = (k / 4) * Math.PI * 2;
        fanGrp.add(blade);
      }
      fanGrp.position.set(0, 0.75, 0.4);
      grp.add(fanGrp);
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.12, 0.86), mat(P.amber));
      top.position.y = 1.26;
      top.castShadow = true;
      grp.add(top);

      const led = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), mat(0x7f9b62, { emissive: 0x4e7a2f, emissiveIntensity: 1.4 }));
      led.position.set(0.28, 1.18, 0.36);
      grp.add(led);

      // 通风场的可视化光晕
      const halo = new THREE.Mesh(
        new THREE.CircleGeometry(CONFIG.smoke.ventRadius, 48),
        new THREE.MeshBasicMaterial({ color: 0x9fd4e8, transparent: true, opacity: 0.1, depthWrite: false }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.014;
      this.root.add(halo);

      this.root.add(grp);
      this.anchors.vents.push({ index: i, tile: t, group: grp, led, fan: fanGrp, halo });
      this.dynamic.push({ kind: 'vent', fan: fanGrp, led, halo });
    });

    // --- 管理亭 ---
    this.anchors.booth = null;
    const boothTiles = grid.allTilesOf('B');
    if (boothTiles.length) {
      const t = boothTiles[0];
      const w = grid.worldOf(t.x, t.z);
      const grp = new THREE.Group();
      grp.position.set(w.x, 0, w.z);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.5, 0.92), mat(P.amber));
      body.position.y = 0.75;
      body.castShadow = true;
      body.receiveShadow = true;
      grp.add(body);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.12, 1.06), mat(P.amberDeep));
      roof.position.y = 1.56;
      grp.add(roof);
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.04), mat(P.blue));
      win.position.set(0, 0.92, 0.47);
      grp.add(win);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.04), mat(0xf1e4cd));
      sign.position.set(0, 1.34, 0.47);
      grp.add(sign);
      this.root.add(grp);
      this.anchors.booth = { tile: t, wx: w.x, wz: w.z, group: grp };
    }

    // --- 障碍物（长椅 / 花坛） ---
    grid.allTilesOf('o').forEach((t, i) => {
      const w = grid.worldOf(t.x, t.z);
      const bench = (t.x + t.z) % 2 === 0;
      const grp = new THREE.Group();
      grp.position.set(w.x, 0, w.z);
      if (bench) {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.08, 0.42), mat(P.wood));
        seat.position.y = 0.42;
        seat.castShadow = true;
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.34, 0.07), mat(P.woodDark));
        back.position.set(0, 0.62, -0.17);
        back.castShadow = true;
        const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.42, 0.34), mat(P.metalDark));
        l1.position.set(-0.36, 0.21, 0);
        const l2 = l1.clone();
        l2.position.x = 0.36;
        grp.add(seat, back, l1, l2);
        grp.rotation.y = ((t.x % 2) === 0 ? 0 : Math.PI / 2);
      } else {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.36, 10), mat(P.amberDeep));
        pot.position.y = 0.18;
        pot.castShadow = true;
        const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 10), mat(0x5a4632));
        soil.position.y = 0.37;
        const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.33, 0), mat(P.greenB));
        bush.position.y = 0.62;
        bush.castShadow = true;
        const bush2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), mat(P.greenA));
        bush2.position.set(0.16, 0.52, 0.1);
        grp.add(pot, soil, bush, bush2);
      }
      this.root.add(grp);
    });

    // --- 出口标记 ---
    grid.allTilesOf('D').forEach((t) => {
      const w = grid.worldOf(t.x, t.z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.42, 22), new THREE.MeshBasicMaterial({ color: 0x6c9b95, transparent: true, opacity: 0.5 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(w.x, 0.016, w.z);
      this.root.add(ring);
    });

    // --- 提示牌 ---
    this.anchors.signs = [];
    const signTiles = [...grid.allTilesOf('+').map((t) => ({ ...t, correct: true })), ...grid.allTilesOf('-').map((t) => ({ ...t, correct: false }))];

    // --- 场景点缀：落叶 / 纸屑（呼应参考图的暖红点缀） ---
    for (let i = 0; i < 26; i++) {
      const ang = i * 2.399;
      const r = 0.4 + ((i * 7) % 13) * 0.22;
      const px = Math.cos(ang) * r;
      const pz = Math.sin(ang) * r;
      const c = grid.cellOf(px, pz);
      if (!grid.isWalkable(c.x, c.z)) continue;
      const paper = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.012, 0.11), mat(i % 3 === 0 ? P.red : P.paper));
      paper.position.set(px, 0.008, pz);
      paper.rotation.y = ang;
      this.root.add(paper);
    }

    // --- 场景外的树（参考图边缘那棵深色树） ---
    const treeSpots = [];
    const halfW = grid.w / 2, halfH = grid.h / 2;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      treeSpots.push({ x: Math.cos(a) * (halfW + 1.5), z: Math.sin(a) * (halfH + 1.4) });
    }
    treeSpots.forEach((s, i) => this.root.add(makeTree(s.x, s.z, i)));

    this.floorMesh = floorMesh;
    this.obsMesh = obsMesh;
    this.col = col;
    this.m4 = m4;
    this.grid = grid;
    this.level = level;

    // --- 烟雾实例网格 ---
    const cellCount = grid.w * grid.h;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const smokeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: CONFIG.smoke.puffOpacity, depthWrite: false });
    this.smokeMesh = new THREE.InstancedMesh(geo, smokeMat, cellCount);
    this.smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.smokeMesh.count = 0;
    this.smokeMesh.frustumCulled = false;
    this.root.add(this.smokeMesh);

    // --- 窗户（窗洞 + 玻璃 + 洁净区光效） ---
    this.buildWindows(windows);

    return this.anchors;
  }

  /** 窗户：在墙上开窗，并在窗前地面画出洁净区光效（第 1~4 关使用） */
  buildWindows(windows) {
    this.anchors.windows = [];
    for (const win of windows || []) this.buildWindow(win);
  }

  buildWindow(win) {
    const grid = this.grid;
    const tile = CONFIG.tile;
    const W = CONFIG.window;
    const first = grid.worldOf(win.cells[0].x, win.cells[0].z);
    const last = grid.worldOf(win.cells[win.cells.length - 1].x, win.cells[win.cells.length - 1].z);
    const cx = (first.x + last.x) / 2;
    const cz = (first.z + last.z) / 2;

    const spanLen = W.span * tile;
    const depthLen = W.depth * tile;
    const half = spanLen / 2;
    const wallH = 1.62, wallT = tile * 0.99;   // 与普通墙一致
    const y0 = 0.52, y1 = 1.36;                // 窗洞上下沿
    const midY = (y0 + y1) / 2;
    const glassH = y1 - y0;
    const frameW = 0.09;

    const grp = new THREE.Group();
    grp.position.set(cx, 0, cz);
    grp.rotation.y = win.yaw;                  // 局部 +Z = 朝房间内侧
    grp.userData.kind = 'window';

    // 窗台下墙体 + 窗楣（补全被挖空的墙格，形成真实窗洞）
    const sillWall = new THREE.Mesh(new THREE.BoxGeometry(spanLen, y0, wallT), mat(P.wall));
    sillWall.position.set(0, y0 / 2, 0);
    const headWall = new THREE.Mesh(new THREE.BoxGeometry(spanLen, wallH - y1, wallT), mat(P.wall));
    headWall.position.set(0, (y1 + wallH) / 2, 0);
    sillWall.castShadow = headWall.castShadow = true;
    sillWall.receiveShadow = headWall.receiveShadow = true;

    // 玻璃：嵌在墙厚中央，两种朝向的墙都能看到
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(spanLen - frameW * 2 - 0.02, glassH, 0.14),
      mat(0xbfe6f2, { emissive: 0x3f8fb5, emissiveIntensity: 0.7, transparent: true, opacity: 0.8 }),
    );
    glass.position.set(0, midY, 0);

    // 窗框：贯穿墙厚，从内外两侧都能看清
    const frameMat = mat(P.woodDark);
    const fd = wallT + 0.06;
    const topRail = new THREE.Mesh(new THREE.BoxGeometry(spanLen, frameW, fd), frameMat);
    topRail.position.set(0, y1 - frameW / 2, 0);
    const botRail = new THREE.Mesh(new THREE.BoxGeometry(spanLen, frameW, fd), frameMat);
    botRail.position.set(0, y0 + frameW / 2, 0);
    const postGeo = new THREE.BoxGeometry(frameW, glassH, fd);
    const leftPost = new THREE.Mesh(postGeo, frameMat);
    leftPost.position.set(-half + frameW / 2, midY, 0);
    const rightPost = leftPost.clone();
    rightPost.position.x = half - frameW / 2;
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(frameW * 0.7, glassH, fd * 0.9), frameMat);
    mullion.position.set(0, midY, 0);

    // 亮青色压顶：俯视时最醒目，明确标出“墙上有窗”
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(spanLen, 0.09, tile * 1.03),
      mat(0x9fe0f5, { emissive: 0x2f8fb8, emissiveIntensity: 0.85 }),
    );
    cap.position.set(0, 1.66, 0);
    cap.castShadow = true;

    for (const m of [topRail, botRail, leftPost, rightPost, mullion]) m.castShadow = true;
    grp.add(sillWall, headWall, glass, topRail, botRail, leftPost, rightPost, mullion, cap);

    // 地面洁净区光效（窗户正前方，无烟安全区）：填充 + 亮边框，保证醒目
    const zoneW = spanLen * 0.98, zoneD = depthLen * 0.98;
    const zone = new THREE.Mesh(
      new THREE.PlaneGeometry(zoneW, zoneD),
      new THREE.MeshBasicMaterial({
        color: 0xbfe6f2, transparent: true, opacity: 0.28,
        depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      }),
    );
    zone.rotation.x = -Math.PI / 2;
    zone.position.set(0, 0.02, 0.5 + depthLen / 2);
    grp.add(zone);

    // 亮边框（四边细条，平铺在地面）
    const edgeMat = new THREE.MeshBasicMaterial({
      color: 0x8fd8f0, transparent: true, opacity: 0.6,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const ew = 0.07, zc = 0.5 + depthLen / 2;
    const edges = [
      [zoneW, ew, 0, zc - zoneD / 2],       // 近墙侧
      [zoneW, ew, 0, zc + zoneD / 2],       // 房间内侧
      [ew, zoneD, -zoneW / 2, zc],
      [ew, zoneD, zoneW / 2, zc],
    ];
    for (const [w, d, ex, ez] of edges) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, d), edgeMat);
      bar.rotation.x = -Math.PI / 2;
      bar.position.set(ex, 0.024, ez);
      grp.add(bar);
    }

    this.root.add(grp);
    this.anchors.windows.push({ win, group: grp, zonePlane: zone });
  }

  addSign(sign) {
    const w = this.grid.worldOf(sign.cell.x, sign.cell.z);
    const grp = new THREE.Group();
    grp.position.set(w.x, 0, w.z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.95, 8), mat(P.metalDark));
    post.position.y = 0.48;
    post.castShadow = true;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.44, 0.05), mat(sign.correct ? P.amberLight : P.red));
    panel.position.y = 1.06;
    panel.castShadow = true;
    const inner = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.28, 0.02), mat(0xf7efe0));
    inner.position.set(0, 1.06, 0.035);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.18, 4), mat(sign.correct ? P.greenB : P.red));
    arrow.rotation.z = -Math.PI / 2;
    arrow.position.set(0.14, 1.06, 0.055);
    grp.add(post, panel, inner, arrow);
    // 方向指示箭头（平铺在地面，指向目标）
    const arrowFlat = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 3), new THREE.MeshBasicMaterial({ color: sign.correct ? 0x7f9b62 : 0xc9553b, transparent: true, opacity: 0.55 }));
    arrowFlat.rotation.x = -Math.PI / 2;
    arrowFlat.position.set(0, 0.02, 0.62);
    grp.add(arrowFlat);
    this.root.add(grp);
    sign.group = grp;
    sign.arrowFlat = arrowFlat;
    this.anchors.signs.push(sign);
    return grp;
  }

  removeSign(sign) {
    const i = this.anchors.signs.indexOf(sign);
    if (i >= 0) this.anchors.signs.splice(i, 1);
    if (sign.group) this.root.remove(sign.group);
  }

  /** 朝向变化时刷新箭头与面板颜色 */
  refreshSign(sign) {
    if (!sign.arrowFlat) return;
    sign.group.rotation.y = 0;
    sign.arrowFlat.position.set(Math.sin(sign.angle) * 0.62, 0.02, Math.cos(sign.angle) * 0.62);
    sign.arrowFlat.rotation.z = -sign.angle;
    sign.arrowFlat.material.color.setHex(sign.correct ? 0x7f9b62 : 0xc9553b);
  }

  // --- 辅助装备模型（对应策划案 12.3） ---
  addEquip(equip) {
    const w = this.grid.worldOf(equip.tile.x, equip.tile.z);
    const { group: grp, fan } = buildEquipGroup(equip.type);
    grp.position.set(w.x, 0, w.z);
    grp.rotation.y = equip.angle || 0;
    if (fan) equip.fan = fan;

    if (equip.type === 'purifier') {
      const halo = new THREE.Mesh(
        new THREE.CircleGeometry(CONFIG.equip.purifier.radius, 40),
        new THREE.MeshBasicMaterial({ color: 0x9fd4e8, transparent: true, opacity: 0.1, depthWrite: false }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(w.x, 0.013, w.z);
      this.root.add(halo);
      equip.halo = halo;
    }

    this.root.add(grp);
    equip.group = grp;
    grp.userData.kind = 'equip';
    grp.userData.ref = equip;
    (this.anchors.equips ||= []).push(equip);
    return grp;
  }

  removeEquip(equip) {
    if (equip.halo && equip.halo.parent) equip.halo.parent.remove(equip.halo);
    equip.dispose();
    const arr = this.anchors.equips || [];
    const i = arr.indexOf(equip);
    if (i >= 0) arr.splice(i, 1);
  }

  /** 每帧烟雾可视化：网格浓度 -> 实例化烟团 */
  updateSmoke(grid, time) {
    const mesh = this.smokeMesh;
    const { renderThreshold, puffRadius, max } = CONFIG.smoke;
    let n = 0;
    const m4 = this.m4;
    const col = this.col;
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    for (let z = 0; z < grid.h; z++) {
      for (let x = 0; x < grid.w; x++) {
        const s = grid.smokeAt(x, z);
        if (s < renderThreshold) continue;
        const w = grid.worldOf(x, z);
        const t = s / max;
        const wob = Math.sin(time * 0.9 + x * 1.7 + z * 2.3);
        const scale = puffRadius * (0.75 + t * 1.5);
        pos.set(w.x + wob * 0.1, 0.2 + t * 0.72 + wob * 0.04, w.z + Math.cos(time * 0.7 + x * 2.1) * 0.1);
        scl.set(scale, scale * 0.78, scale);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), time * 0.2 + x);
        m4.compose(pos, q, scl);
        mesh.setMatrixAt(n, m4);
        col.setHex(P.smoke).lerp(new THREE.Color(P.smokeDark), Math.min(0.8, t * 1.15));
        mesh.setColorAt(n, col);
        n++;
        if (n >= mesh.instanceMatrix.count) break;
      }
      if (n >= mesh.instanceMatrix.count) break;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  update(dt, state) {
    // 吸烟区绿光呼吸动画（加强引导）
    const sg = this.anchors.smokingGlow;
    if (sg) {
      const H = CONFIG.highlight;
      const t = state.time || 0;
      const pulse = Math.sin(t * 1.9) * 0.5 + 0.5;
      sg.ring.material.opacity = H.smokingAreaRingOpacity * (0.75 + 0.25 * pulse);
      sg.fill.material.opacity = H.smokingAreaFillOpacity * (0.7 + 0.3 * pulse);
      sg.glow.material.opacity = H.smokingAreaFillOpacity * 0.5 * (0.6 + 0.4 * pulse);
      const s = 1 + H.smokingAreaPulse * pulse;
      sg.glow.scale.set(s, s, 1);
    }
    // 门：开门时绕门柱平滑旋开
    const dr = this.anchors.door;
    if (dr) {
      const target = dr.open ? -1.15 : 0;
      dr.pivot.rotation.y += (target - dr.pivot.rotation.y) * Math.min(1, dt * 9);
    }
    // 通风扇叶旋转
    for (const v of this.anchors.vents || []) {
      if (v.fan) v.fan.rotation.z += dt * (state.ventPower[v.index] > 0.05 ? 6 : 0);
      if (v.led) {
        const on = state.ventPower[v.index] > 0.05;
        v.led.material = on ? mat(0x7f9b62, { emissive: 0x4e7a2f, emissiveIntensity: 1.4 }) : mat(0xc9553b, { emissive: 0x7a2a1a, emissiveIntensity: 1.2 });
      }
      if (v.halo) v.halo.material.opacity = 0.02 + 0.1 * (state.ventPower[v.index] || 0);
    }
    // 辅助装备动画（风扇转动 / 净化器光晕）
    for (const eq of this.anchors.equips || []) {
      if (eq.fan) eq.fan.rotation.z += dt * (eq.active ? 8 : 0);
      if (eq.halo) eq.halo.material.opacity = eq.active ? 0.11 : 0.03;
    }
  }
}

function makeTree(x, z, seed) {
  const g = new THREE.Group();
  g.position.set(x, -0.15, z);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, 1.9, 7), mat(0x5a4433));
  trunk.position.y = 0.95;
  trunk.castShadow = true;
  g.add(trunk);
  const c = [P.greenDark, P.greenB, P.greenA][seed % 3];
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.52 - i * 0.11, 0), mat(c));
    leaf.position.set(Math.sin(seed + i * 2) * 0.22, 1.85 + i * 0.34, Math.cos(seed + i * 1.7) * 0.2);
    leaf.castShadow = true;
    g.add(leaf);
  }
  return g;
}