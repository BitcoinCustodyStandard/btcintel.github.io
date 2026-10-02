// BTC Intel — Market Battlefield, 3D renderer (Three.js, WebGL2).
// Draws what the battle model says; it never invents market data. Positions,
// unit counts, walls and set pieces all come from the model's bands and events.
//
// World: x = price (0 = camera price), z = along the front (+z toward the viewer
// = now, −z = the last three minutes of price), y = up.
import * as THREE from './vendor/three.module.min.js';
import { RULES } from './model.js';

const WORLD_HALF = 430;               // world units for ±rangePct of price
const Z_NOW = 300, Z_ARMY0 = 268, Z_PAST = -560, TRAIL_SEC = 180;
const CAP = 2600;                     // max infantry per side
const GORE = {
  clean: { blood: false, corpseMs: 6000, parts: 0.6, limbs: 0, color: [0.2, 0.19, 0.17] },
  stylized: { blood: true, corpseMs: 45000, parts: 1, limbs: 0.35, color: [0.16, 0.008, 0.012] },
  brutal: { blood: true, corpseMs: 60000, parts: 2, limbs: 1, color: [0.2, 0.006, 0.01] },
};
const hash = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fmtUsd = (v) => { const a = Math.abs(v); return a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(0)}K` : `$${a.toFixed(0)}`; };

// ---------------------------------------------------------------- procedural low-poly models
function part(geom, color, m) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  if (m) g.applyMatrix4(m);
  const n = g.attributes.position.count, c = new Float32Array(n * 3), col = new THREE.Color(color);
  for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function merge(parts) {
  const keys = ['position', 'normal', 'color'];
  const total = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const k of keys) {
    const arr = new Float32Array(total * 3); let o = 0;
    for (const g of parts) { arr.set(g.attributes[k].array, o); o += g.attributes[k].array.length; }
    out.setAttribute(k, new THREE.BufferAttribute(arr, 3));
  }
  out.computeBoundingSphere();
  return out;
}
const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = [1, 1, 1]) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(...s));
// Soldiers face +x. Bulls: round shapes, horned helms, round shields. Bears: angular, spiked helms, tower shields.
function soldierGeometry(bull) {
  const P = [];
  const plate = bull ? 0x4a78b5 : 0x1c1c22, cloth = bull ? 0x2a9d8f : 0xd2691e, trim = bull ? 0xc9a227 : 0xd8d0c0;
  P.push(part(new THREE.BoxGeometry(2.2, 4.2, 1.2), 0x2a2a2e, M(0, 2.1, -0.7)));            // legs
  P.push(part(new THREE.BoxGeometry(2.2, 4.2, 1.2), 0x2a2a2e, M(0, 2.1, 0.7)));
  P.push(part(new THREE.BoxGeometry(2.6, 4.4, 3.4), plate, M(0, 6.4, 0)));                  // torso
  P.push(part(new THREE.BoxGeometry(2.8, 2.2, 3.6), cloth, M(0, 4.6, 0)));                  // tabard / skirt
  P.push(part(new THREE.SphereGeometry(1.5, 7, 5), plate, M(0, 9.6, 0)));                   // helm
  if (bull) {
    P.push(part(new THREE.ConeGeometry(0.45, 2.4, 5), 0xece3cf, M(0, 10.6, -1.5, 0.9, 0, 0)));  // horns
    P.push(part(new THREE.ConeGeometry(0.45, 2.4, 5), 0xece3cf, M(0, 10.6, 1.5, -0.9, 0, 0)));
    P.push(part(new THREE.CylinderGeometry(2.3, 2.3, 0.5, 10), cloth, M(1.6, 6.2, 0, 0, 0, Math.PI / 2)));  // round shield
    P.push(part(new THREE.CylinderGeometry(0.8, 0.8, 0.6, 8), trim, M(1.9, 6.2, 0, 0, 0, Math.PI / 2)));  // boss
    P.push(part(new THREE.CylinderGeometry(0.18, 0.18, 15, 5), 0x7a5a3a, M(0.6, 8, 1.9, 0, 0, -0.35)));    // spear
    P.push(part(new THREE.ConeGeometry(0.45, 1.6, 5), 0xd8dde6, M(3.2, 15, 1.9, 0, 0, -0.35)));
  } else {
    for (const a of [-0.9, 0, 0.9]) P.push(part(new THREE.ConeGeometry(0.4, 2.2, 4), 0x0e0e12, M(0, 11, a, a * 0.7, 0, 0)));      // spikes
    P.push(part(new THREE.BoxGeometry(0.6, 7.2, 3.6), plate, M(1.8, 6, 0)));                                                         // tower shield
    P.push(part(new THREE.BoxGeometry(0.7, 6.4, 0.8), cloth, M(1.95, 6, 0)));                                                        // ember stripe
    P.push(part(new THREE.CylinderGeometry(0.18, 0.18, 15, 5), 0x3b2a1e, M(0.6, 8, 1.9, 0, 0, -0.3)));                               // halberd
    P.push(part(new THREE.BoxGeometry(1.8, 1.4, 0.3), 0xcfd3da, M(2.9, 14.3, 1.9, 0, 0, -0.3)));
  }
  return merge(P);
}
function riderGeometry(bull) {
  const P = [], horse = bull ? 0x6b4a2f : 0x141418, bard = bull ? 0x2a9d8f : 0x8b2a12, plate = bull ? 0x4a78b5 : 0x1c1c22;
  P.push(part(new THREE.BoxGeometry(9, 4.2, 3.6), horse, M(0, 7, 0)));                       // body
  P.push(part(new THREE.BoxGeometry(9.4, 2.2, 4), bard, M(0, 6.2, 0)));                       // barding
  P.push(part(new THREE.BoxGeometry(2.6, 4.6, 2.4), horse, M(5, 9.8, 0, 0, 0, -0.5)));        // neck/head
  for (const [x, z] of [[-3.4, -1.2], [-3.4, 1.2], [3.4, -1.2], [3.4, 1.2]]) P.push(part(new THREE.BoxGeometry(1, 5, 1), horse, M(x, 2.5, z)));
  P.push(part(new THREE.BoxGeometry(2.4, 4.4, 3), plate, M(-0.5, 11.6, 0)));                  // rider
  P.push(part(new THREE.SphereGeometry(1.3, 7, 5), plate, M(-0.5, 14.6, 0)));
  P.push(part(new THREE.CylinderGeometry(0.2, 0.2, 18, 5), 0xd8dde6, M(4, 13, 1.8, 0, 0, -1.35)));  // lance
  return merge(P);
}
function textTexture(text, color = '#f3e6c8', size = 28) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = `600 ${size}px "IBM Plex Mono", monospace`;
  c.width = Math.ceil(g.measureText(text).width + 16); c.height = size + 14;
  g.font = `600 ${size}px "IBM Plex Mono", monospace`; g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 8, c.height / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return { t, w: c.width, h: c.height };
}

// ---------------------------------------------------------------- scene
export function createScene3D({ host, overlay, get, onFocus }) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); } catch { return null; }
  if (!renderer.capabilities.isWebGL2) { renderer.dispose(); return null; }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const el = renderer.domElement; el.className = 'gl'; el.setAttribute('aria-hidden', 'true');
  host.insertBefore(el, overlay);

  const scene = new THREE.Scene();
  const FOG = new THREE.Color(0x0a1220), MIST = new THREE.Color(0x3a0a0e);
  scene.background = FOG.clone();
  scene.fog = new THREE.FogExp2(FOG.clone(), 0.00085);
  const camera = new THREE.PerspectiveCamera(42, 1, 5, 6000);
  const hemi = new THREE.HemisphereLight(0xb4c6e4, 0x3a3524, 1.5); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a8, 1.6); sun.position.set(-400, 600, 300); scene.add(sun);
  const trenchLight = new THREE.PointLight(0xff9a3c, 2.2, 520, 1.6); trenchLight.position.set(0, 30, 200); scene.add(trenchLight);
  const flashLight = new THREE.DirectionalLight(0xcfe0ff, 0); flashLight.position.set(0, 800, 0); scene.add(flashLight);

  // terrain: flat battle area, rolling hills beyond
  {
    const geo = new THREE.PlaneGeometry(3600, 2400, 160, 100); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const edge = clamp((Math.abs(x) - 560) / 400, 0, 1) + clamp((z - 420) / 300, 0, 1) + clamp((-z - 700) / 300, 0, 1);
      const hill = (14 * Math.sin(x * 0.006) * Math.cos(z * 0.008) + 8 * Math.sin(x * 0.017 + z * 0.011) + 30) * clamp(edge, 0, 1);
      pos.setY(i, hill - 0.6);
      const n = 0.5 + 0.5 * Math.sin(x * 0.05 + Math.cos(z * 0.04) * 2), mud = clamp(1 - Math.abs(x) / 180, 0, 1) * 0.5;
      const r = 0.10 + 0.04 * n + mud * 0.08, g2 = 0.13 + 0.05 * n - mud * 0.02, b = 0.07 + 0.02 * n;
      col[i * 3] = r; col[i * 3 + 1] = g2; col[i * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));
  }

  // blood map: a price-anchored canvas texture on the ground
  const SPL = { w: 1024, h: 768, worldW: 1300, worldH: 975, price: null, k: null };
  const splC = document.createElement('canvas'); splC.width = SPL.w; splC.height = SPL.h;
  const splG = splC.getContext('2d');
  const splT = new THREE.CanvasTexture(splC); splT.colorSpace = THREE.SRGBColorSpace;
  const splMesh = new THREE.Mesh(new THREE.PlaneGeometry(SPL.worldW, SPL.worldH), new THREE.MeshBasicMaterial({ map: splT, transparent: true, depthWrite: false, fog: true }));
  splMesh.rotation.x = -Math.PI / 2; splMesh.position.set(0, 0.25, (Z_NOW + Z_PAST) / 2 + 40); scene.add(splMesh);
  const splZ0 = splMesh.position.z;

  // territory tints and the trench (rebuilt each frame from the price trail)
  const NZ = 90, zAt = (i) => Z_NOW + 30 - (i / (NZ - 1)) * (Z_NOW + 30 - Z_PAST);
  const ribbon = (color, opacity, blending = THREE.NormalBlending) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NZ * 2 * 3), 3));
    const idx = []; for (let i = 0; i < NZ - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending }));
    m.frustumCulled = false; scene.add(m); return m;
  };
  const bullLand = ribbon(0x2a9d8f, 0.07), bearLand = ribbon(0xd2691e, 0.06);
  const trench = ribbon(0xffb347, 0.95, THREE.AdditiveBlending), trenchGlow = ribbon(0xff7a1a, 0.22, THREE.AdditiveBlending);

  // instanced meshes
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const inst = (geo, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false; m.setColorAt(0, new THREE.Color(1, 1, 1)); scene.add(m); return m; };
  const infantry = { bull: inst(soldierGeometry(true), CAP + 400), bear: inst(soldierGeometry(false), CAP + 400) };
  const cavalry = { bull: inst(riderGeometry(true), 260), bear: inst(riderGeometry(false), 260) };
  const logGeo = merge([part(new THREE.CylinderGeometry(1.4, 1.6, 1, 6), 0x9a7048), part(new THREE.ConeGeometry(1.4, 2, 6), 0x8a6240, M(0, 0.9, 0, 0, 0, 0, [1, 0.12, 1]))]);
  const stoneGeo = merge([part(new THREE.BoxGeometry(3.2, 1, 6.2), 0xa8a39a)]);
  const logs = inst(logGeo, 900), stones = inst(stoneGeo, 900);
  const arrowGeo = merge([part(new THREE.BoxGeometry(5, 0.25, 0.25), 0x3b2a1e), part(new THREE.ConeGeometry(0.35, 1, 4), 0xcfd3da, M(2.8, 0, 0, 0, 0, -Math.PI / 2))]);
  const arrows = inst(arrowGeo, 600);
  const rockGeo = merge([part(new THREE.IcosahedronGeometry(4, 0), 0x55504a)]);
  const rocks = inst(rockGeo, 24);
  const markerGeo = merge([part(new THREE.BoxGeometry(5, 6, 5), 0x8a857c, M(0, 3, 0))]);
  const obeliskGeo = merge([part(new THREE.CylinderGeometry(1.8, 3.4, 26, 4), 0x9a948a, M(0, 13, 0, 0, Math.PI / 4, 0)), part(new THREE.ConeGeometry(2.2, 4, 4), 0x9a948a, M(0, 28, 0, 0, Math.PI / 4, 0))]);
  const markers = inst(markerGeo, 120), obelisks = inst(obeliskGeo, 40);
  const flagGeo = merge([part(new THREE.CylinderGeometry(0.3, 0.3, 30, 5), 0x3b2a1e, M(0, 15, 0)), part(new THREE.BoxGeometry(0.3, 8, 12), 0xffffff, M(0, 25, 6))]);
  const flags = { bull: inst(merge([part(new THREE.CylinderGeometry(0.3, 0.3, 30, 5), 0x3b2a1e, M(0, 15, 0)), part(new THREE.BoxGeometry(0.3, 8, 12), 0xc9a227, M(0, 25, 6))]), 24), bear: inst(merge([part(new THREE.CylinderGeometry(0.3, 0.3, 30, 5), 0x3b2a1e, M(0, 15, 0)), part(new THREE.BoxGeometry(0.3, 8, 12), 0x111114, M(0, 25, 6))]), 24) };
  void flagGeo;

  // particles (blood, dust, sparks, debris) — one pool
  const PMAX = 24000;
  const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3), pVel = new Float32Array(PMAX * 3), pLife = new Float32Array(PMAX), pAge = new Float32Array(PMAX), pKind = new Uint8Array(PMAX);
  let pN = 0;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
  // round, soft-edged particles (ink-like, not confetti)
  const dot = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 2.8, map: dot, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false, alphaTest: 0.05 }));
  points.frustumCulled = false; scene.add(points);
  const chunks = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 3.4, map: dot, vertexColors: true, sizeAttenuation: true, transparent: true, alphaTest: 0.3 }));
  { const g = chunks.geometry; g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3000 * 3), 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(3000 * 3), 3)); g.setDrawRange(0, 0); }
  chunks.frustumCulled = false; scene.add(chunks);
  const chunkList = [];

  // ---------------------------------------------------------------- state
  const st = { k: 1, cam: null, now: 0 };
  const Xp = (price) => (price - st.cam) * st.k;
  const soldiers = { bull: [], bear: [] };       // {x,z,tx,tz,y,state,t0,band,ph,scale,rot}
  const riders = [];                             // {side,x,z,vx,t0,life}
  const flying = [];                             // arrows and rocks
  const walls = new Map();                       // key → {side,p,usd,kind,state,t0,h}
  const captured = [];                           // {side, price}
  const pending = [];                            // timed actions (deaths on impact)
  const labels = [];                             // overlay labels with expiry
  let shake = 0, flash = 0, mist = 0, slowUntil = 0, timeScale = 1, focus = null;
  const view = { yaw: 0.42, pitch: 0.6, dist: 820, tx: 0, tz: 120, mode: 'cinematic', drag: null, keys: new Set() };

  // ---------------------------------------------------------------- helpers
  const dir = (side) => (side === 'bull' ? 1 : -1);         // facing / attack direction along x
  const priceAtAge = (sec) => get().priceAtAge(sec);
  const frontX = (z) => Xp(priceAtAge(z >= Z_ARMY0 - 40 ? 0 : ((Z_ARMY0 - 40 - z) / (Z_ARMY0 - 40 - Z_PAST)) * TRAIL_SEC));
  const gore = () => GORE[get().gore] || GORE.stylized;
  const rand = (seed) => hash(seed);

  function emitParticles(x, y, z, n, opts = {}) {
    const g = gore(), [r, gg, b] = opts.color || (opts.kind === 1 ? g.color : [0.16, 0.15, 0.13]);
    n = Math.round(n * (opts.kind === 1 ? g.parts : 1));
    for (let i = 0; i < n && pN < PMAX; i++, pN++) {
      const s = opts.seed + i * 7.31, a = rand(s) * Math.PI * 2, sp = (opts.speed || 30) * (0.4 + rand(s + 1));
      pPos[pN * 3] = x; pPos[pN * 3 + 1] = y; pPos[pN * 3 + 2] = z;
      pVel[pN * 3] = Math.cos(a) * sp + (opts.vx || 0); pVel[pN * 3 + 1] = (opts.up || 30) * (0.5 + rand(s + 2)); pVel[pN * 3 + 2] = Math.sin(a) * sp;
      const shade = 0.75 + 0.5 * rand(s + 3);
      pCol[pN * 3] = r * shade; pCol[pN * 3 + 1] = gg * shade; pCol[pN * 3 + 2] = b * shade;
      pLife[pN] = (opts.life || 1.6) * (0.6 + rand(s + 4) * 0.8); pAge[pN] = 0; pKind[pN] = opts.kind || 0;
    }
  }
  function emitChunks(x, z, n, side, seed) {
    const g = gore();
    const k = Math.round(n * g.limbs);
    const armor = side === 'bull' ? [0.29, 0.47, 0.71] : [0.11, 0.11, 0.13];
    for (let i = 0; i < k && chunkList.length < 3000; i++) {
      const s = seed + i * 3.7, a = rand(s) * Math.PI * 2;
      const flesh = get().gore === 'brutal' && rand(s + 9) < 0.5;
      chunkList.push({ x, y: 8, z, vx: Math.cos(a) * 26 * rand(s + 1), vy: 30 + 30 * rand(s + 2), vz: Math.sin(a) * 26 * rand(s + 3), c: flesh ? [0.22, 0.03, 0.03] : armor.map((v) => v * 0.35), age: 0, rest: false });
    }
  }
  function splat(x, z, r, rgba) {
    if (SPL.price === null) return;
    const px = (x - Xp(SPL.price)) / SPL.worldW * SPL.w + SPL.w / 2, py = (z - splZ0) / SPL.worldH * SPL.h + SPL.h / 2;
    const rr = r / SPL.worldW * SPL.w;
    const gr = splG.createRadialGradient(px, py, 0, px, py, rr);
    gr.addColorStop(0, rgba); gr.addColorStop(1, rgba.replace(/[\d.]+\)$/, '0)'));
    splG.fillStyle = gr; splG.beginPath(); splG.arc(px, py, rr, 0, Math.PI * 2); splG.fill();
    splT.needsUpdate = true;
  }

  // ---------------------------------------------------------------- layout from the model's bands
  let unitScale = { bull: 1, bear: 1 };
  function layout() {
    const s = get(), B = s.bands;
    if (!B || !st.cam) return;
    const wb = RULES.BAND * st.k;
    const cols = clamp(Math.floor(wb / 5.5), 1, 8), sp = wb / cols;
    for (const [side, arr] of [['bull', B.bids], ['bear', B.asks]]) {
      const total = arr.reduce((t, x) => t + x.n, 0);
      unitScale[side] = total > CAP ? CAP / total : 1;
      const S = soldiers[side];
      const byBand = new Map();
      for (const u of S) if (u.state === 'alive' || u.state === 'rout') { if (!byBand.has(u.band)) byBand.set(u.band, []); byBand.get(u.band).push(u); }
      const seen = new Set();
      for (const b of arr) {
        if (Math.abs(b.p + RULES.BAND / 2 - st.cam) > st.cam * s.rangePct / 100 * 1.05) continue;
        const n = Math.round(b.n * unitScale[side]);
        seen.add(b.p);
        const have = byBand.get(b.p) || [];
        const rows = Math.ceil(n / cols), rowSp = Math.min(7, 250 / Math.max(1, rows));
        const x0 = Xp(b.p);
        for (let i = 0; i < Math.max(n, have.length); i++) {
          let u = have[i];
          if (i >= n) { if (u) { u.state = 'leaving'; u.t0 = st.now; } continue; }
          if (!u) {
            u = { band: b.p, state: 'alive', x: x0 - dir(side) * (90 + 30 * hash(b.p + i)), z: Z_ARMY0 - Math.floor(i / cols) * rowSp, y: 0, ph: hash(b.p * 3 + i) * 6.28, scale: 1, rot: 0, t0: st.now };
            S.push(u);
          }
          const col = i % cols, row = Math.floor(i / cols);
          u.tx = x0 + (col + 0.5) * sp + (hash(b.p + i * 1.7) - 0.5) * sp * 0.3;
          u.tz = Z_ARMY0 - row * rowSp - (hash(b.p - i) * 2);
        }
      }
      for (const [band, us] of byBand) if (!seen.has(band)) for (const u of us) { u.state = 'leaving'; u.t0 = st.now; }
    }
    // walls
    const live = new Set();
    for (const [side, arr] of [['bull', B.bids], ['bear', B.asks]]) for (const b of arr) {
      if (!b.wall || Math.abs(b.p + RULES.BAND / 2 - st.cam) > st.cam * s.rangePct / 100) continue;
      const key = `${side}|${b.p}`; live.add(key);
      const w = walls.get(key);
      if (!w) walls.set(key, { side, p: b.p, usd: b.usd, kind: b.wall, state: 'rising', t0: st.now, mult: b.mult });
      else if (w.state === 'standing' || w.state === 'rising') Object.assign(w, { usd: b.usd, kind: b.wall, mult: b.mult });
    }
    for (const [k, w] of walls) if (!live.has(k) && (w.state === 'standing' || w.state === 'rising')) { w.state = 'pulled'; w.t0 = st.now; } // fallback if no event arrives
  }

  // ---------------------------------------------------------------- events from the model
  function kill(side, px, n, seed, opts = {}) {
    const S = soldiers[side], X = Xp(px);
    const alive = S.filter((u) => u.state === 'alive' || u.state === 'rout').sort((a, b) => Math.abs(a.x - X) + Math.abs(a.z - (opts.z ?? a.z)) * 0.3 - (Math.abs(b.x - X) + Math.abs(b.z - (opts.z ?? b.z)) * 0.3));
    for (let i = 0; i < Math.min(n, alive.length); i++) {
      const u = alive[i];
      u.state = 'dying'; u.t0 = st.now + i * 40; u.fall = hash(seed + i) > 0.5 ? 1 : -1;
      emitParticles(u.x, 7, u.z, 14, { kind: 1, seed: seed + i * 13, speed: 22, up: 34, life: 1.4 });
      emitChunks(u.x, u.z, 2, side, seed + i);
      if (gore().blood) splat(u.x, u.z, 9 + 6 * hash(seed + i), 'rgba(92,8,10,0.55)'); else splat(u.x, u.z, 7, 'rgba(30,26,22,0.45)');
    }
  }
  function charge(side, usd, seed, z0) {
    const n = clamp(Math.round(usd / 100e3), 3, 40), F = frontX(Z_ARMY0);
    for (let i = 0; i < n; i++) riders.push({ side, x: F - dir(side) * (170 + 60 * hash(seed + i)), z: clamp((z0 ?? 150) + (hash(seed - i) - 0.5) * 160, -40, Z_ARMY0), vx: dir(side) * (120 + 30 * hash(seed + i * 2)), t0: st.now + i * 35, life: 2600 });
  }
  function volley(side, usd, seed) {
    const n = clamp(Math.round(usd / 2e3), 4, 30), F = frontX(Z_ARMY0);
    for (let i = 0; i < n; i++) {
      const sx = F - dir(side) * (60 + 60 * hash(seed + i)), ex = F + dir(side) * (15 + 80 * hash(seed + i * 3)), z = 40 + 220 * hash(seed - i * 5);
      flying.push({ kind: 'arrow', side, sx, ex, sz: z, ez: z + (hash(seed + i) - 0.5) * 30, h: 60 + 30 * hash(seed + i * 7), t0: st.now + i * 25, dur: 1100 });
    }
  }
  function surge(side, usd, seed) {
    const n = clamp(Math.round(usd / 10e3), 3, 25), F = frontX(Z_ARMY0);
    for (let i = 0; i < n; i++) soldiers[side].push({ band: null, state: 'surge', x: F - dir(side) * (30 + 20 * hash(seed + i)), z: 40 + 220 * hash(seed + i * 3), y: 0, tx: F + dir(side) * 35, ph: i, scale: 1, rot: 0, t0: st.now + i * 30 });
  }
  function siege(victim, px, usd, seed, tier) {
    const shooter = victim === 'bull' ? 'bear' : 'bull';
    const shots = tier >= 4 ? 3 : 1, X = Xp(px);
    for (let i = 0; i < shots; i++) {
      const z = 80 + 170 * hash(seed + i);
      flying.push({ kind: 'rock', side: shooter, sx: frontX(Z_ARMY0) - dir(shooter) * 420, ex: X + (hash(seed + i * 2) - 0.5) * 30, sz: z - 60, ez: z, h: 220, t0: st.now + i * 380, dur: 1400, onHit: () => impact(victim, px, usd / shots, seed + i, tier, z) });
    }
  }
  function impact(victim, px, usd, seed, tier, z) {
    const X = Xp(px);
    emitParticles(X, 4, z, tier >= 4 ? 700 : 380, { kind: 1, seed, speed: 70, up: 80, life: 2.2 });
    emitParticles(X, 2, z, 160, { kind: 0, seed: seed + 99, speed: 50, up: 40, life: 2.5, color: [0.12, 0.1, 0.08] });
    emitChunks(X, z, tier >= 4 ? 40 : 18, victim, seed);
    splat(X, z, tier >= 4 ? 46 : 30, gore().blood ? 'rgba(80,6,8,0.75)' : 'rgba(25,22,18,0.7)');
    splat(X, z, tier >= 4 ? 18 : 12, 'rgba(10,8,6,0.85)'); // crater
    kill(victim, px, tier >= 4 ? 45 : 22, seed, { z });
    if (!get().reduced) shake = Math.max(shake, tier >= 4 ? 16 : 9);
  }
  function event(e) {
    const seed = (e.t % 100003) + Math.round(e.usd || 0) % 9973;
    const z = 60 + 200 * hash(seed);
    switch (e.kind) {
      case 'volley': volley(e.side, e.usd, seed); break;
      case 'surge': surge(e.side, e.usd, seed); break;
      case 'charge': charge(e.side, e.usd, seed, z); if (e.usd >= 1e6) focusOn(Xp(e.px), z, 2200); break;
      case 'liq': {
        const victim = e.side, enemy = victim === 'bull' ? 'bear' : 'bull';
        if (e.tier === 0) { kill(victim, e.px, 1, seed); break; }
        kill(victim, e.px, clamp(Math.round(e.usd / 10e3), 2, 15), seed, { z });
        if (e.tier >= 2) { charge(enemy, e.usd * 0.6, seed + 1, z); kill(victim, e.px, clamp(Math.round(e.usd / 25e3), 4, 20), seed + 7, { z }); focusOn(Xp(e.px), z, 2400); }
        if (e.tier >= 3) siege(victim, e.px, e.usd, seed, e.tier);
        if (e.tier >= 4) {
          if (!get().reduced) { flash = 1; slowUntil = performance.now() + 400; }
          mist = 1;
          for (const u of soldiers[victim]) if (u.state === 'alive' && Math.abs(u.x - Xp(e.px)) < 120) { u.state = 'rout'; u.t0 = st.now; u.until = st.now + 5000; }
        }
        break;
      }
      case 'wall-hit': case 'wall-pulled': {
        const w = walls.get(`${e.side}|${e.price}`);
        if (w) { w.state = e.kind === 'wall-hit' ? 'smashed' : 'pulled'; w.t0 = st.now; }
        const X = Xp(e.price + RULES.BAND / 2);
        if (e.kind === 'wall-hit') { emitParticles(X, 10, 150, 200, { kind: 0, seed, speed: 40, up: 50, life: 1.8, color: [0.42, 0.3, 0.2] }); if (!get().reduced) shake = Math.max(shake, 5); }
        else emitParticles(X, 6, 150, 160, { kind: 0, seed, speed: 12, up: 6, life: 3, color: [0.55, 0.58, 0.62] });
        labels.push({ x: X, y: 34, z: 150, text: e.kind === 'wall-hit' ? `${fmtUsd(e.usd)} wall broken` : `${fmtUsd(e.usd)} wall withdrawn`, until: st.now + 6000, c: e.kind === 'wall-hit' ? '#ffcf8a' : '#b9c4d4' });
        break;
      }
      case 'rout': for (const u of soldiers[e.side]) if (u.state === 'alive') { u.state = 'rout'; u.t0 = st.now; u.until = st.now + 8000; } break;
      case 'rally': for (const u of soldiers[e.side]) if (u.state === 'rout') u.state = 'alive'; break;
      case 'range-won': {
        captured.push({ side: e.side, price: e.marker });
        if (captured.length > 24) captured.shift();
        const loser = e.side === 'bull' ? 'bear' : 'bull';
        for (const u of soldiers[loser]) if (u.state === 'alive') { u.state = 'rout'; u.t0 = st.now; u.until = st.now + 4500; }
        focusOn(Xp(e.marker), 200, 3000);
        break;
      }
    }
  }
  function focusOn(x, z, ms) { if (view.mode === 'cinematic' && !get().reduced) focus = { x, z, until: st.now + ms, t0: st.now }; }

  // ---------------------------------------------------------------- input (on the overlay canvas, which sits on top)
  const onDown = (e) => { view.drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch }; if (view.mode === 'cinematic') setMode('free'); };
  const onMove = (e) => { if (!view.drag) return; view.yaw = view.drag.yaw - (e.clientX - view.drag.x) * 0.005; view.pitch = clamp(view.drag.pitch + (e.clientY - view.drag.y) * 0.004, 0.18, 1.35); };
  const onUp = () => { view.drag = null; };
  const onWheel = (e) => { e.preventDefault(); view.dist = clamp(view.dist * (1 + e.deltaY * 0.0012), 160, 2000); };
  const onKey = (e, down) => { if (/^(input|select|textarea)$/i.test(e.target.tagName)) return; const k = e.key.toLowerCase(); if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { if (down) { view.keys.add(k); if (view.mode !== 'free') setMode('free'); } else view.keys.delete(k); } };
  const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false);
  overlay.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  overlay.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
  function setMode(m) { view.mode = m; onFocus?.(m); }
  function reset() { Object.assign(view, { yaw: 0.42, pitch: 0.6, dist: 820, tx: 0, tz: 120 }); }

  // ---------------------------------------------------------------- frame
  const dummy = new THREE.Object3D(), tmpC = new THREE.Color(), v3 = new THREE.Vector3();
  let W = 0, H = 0, lastT = performance.now(), slowFrames = 0, quality = 2;
  function resize() {
    const r = host.getBoundingClientRect();
    if (r.width === W && r.height === H) return;
    W = r.width; H = r.height;
    renderer.setSize(W, H, false); el.style.width = W + 'px'; el.style.height = H + 'px';
    camera.aspect = W / Math.max(1, H); camera.updateProjectionMatrix();
  }
  function frame() {
    const now = performance.now();
    let dt = Math.min(0.064, (now - lastT) / 1000); lastT = now;
    // automatic quality: drop pixel ratio when frames stay slow
    if (dt > 0.02) slowFrames++; else slowFrames = Math.max(0, slowFrames - 2);
    if (slowFrames > 180 && quality > 0) { quality--; renderer.setPixelRatio(quality === 1 ? 1 : 0.75); slowFrames = 0; }
    timeScale = now < slowUntil ? 0.35 : timeScale + (1 - timeScale) * 0.1;
    dt *= timeScale;
    resize();
    const s = get();
    st.now = s.now;
    if (!s.mid || !s.cam) { renderer.render(scene, camera); return; }
    const kNew = WORLD_HALF / (s.cam * s.rangePct / 100);
    if (SPL.k !== null && Math.abs(kNew - SPL.k) / SPL.k > 0.01) { splG.clearRect(0, 0, SPL.w, SPL.h); SPL.price = s.cam; splT.needsUpdate = true; }
    st.k = kNew; st.cam = s.cam;
    if (SPL.price === null) SPL.price = s.cam;
    SPL.k = st.k;
    // keep the blood map anchored to price; recentre when it drifts
    const drift = (s.cam - SPL.price) * st.k;
    if (Math.abs(drift) > 200) { const dpx = Math.round(drift / SPL.worldW * SPL.w); const tmp = document.createElement('canvas'); tmp.width = SPL.w; tmp.height = SPL.h; tmp.getContext('2d').drawImage(splC, 0, 0); splG.clearRect(0, 0, SPL.w, SPL.h); splG.drawImage(tmp, -dpx, 0); SPL.price += dpx / SPL.w * SPL.worldW / st.k; splT.needsUpdate = true; }
    splMesh.position.x = Xp(SPL.price);
    if (now - (frame.fadeAt || 0) > 1000) { frame.fadeAt = now; splG.globalCompositeOperation = 'destination-out'; splG.fillStyle = 'rgba(0,0,0,0.0035)'; splG.fillRect(0, 0, SPL.w, SPL.h); splG.globalCompositeOperation = 'source-over'; splT.needsUpdate = true; }

    // trench, territories
    const XL = -1400, XR = 1400;
    const set = (mesh, fn) => { const a = mesh.geometry.attributes.position.array; for (let i = 0; i < NZ; i++) { const z = zAt(i), [x1, x2, y] = fn(z, i); a.set([x1, y, z, x2, y, z], i * 6); } mesh.geometry.attributes.position.needsUpdate = true; mesh.geometry.computeBoundingSphere(); };
    set(bullLand, (z) => [XL, frontX(z), 0.15]);
    set(bearLand, (z) => [frontX(z), XR, 0.15]);
    set(trench, (z) => { const x = frontX(z); return [x - 1.8, x + 1.8, 0.5]; });
    set(trenchGlow, (z) => { const x = frontX(z); return [x - 9, x + 9, 0.4]; });
    const F = frontX(Z_ARMY0);
    trenchLight.position.set(F, 26, 180);

    // markers ($100 stones, $500 obelisks) along the near edge, and captured flags
    const lo = s.cam * (1 - s.rangePct / 100 * 1.6), hi = s.cam * (1 + s.rangePct / 100 * 1.6);
    const step = s.rangePct <= 0.5 ? 100 : s.rangePct <= 1 ? 250 : 500, big = step * 5;
    let mi = 0, oi = 0;
    for (let p = Math.ceil(lo / step) * step; p <= hi && mi < 120; p += step) {
      dummy.position.set(Xp(p), 0, Z_NOW + 18); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      if (p % big === 0 && oi < 40) obelisks.setMatrixAt(oi++, dummy.matrix); else markers.setMatrixAt(mi++, dummy.matrix);
    }
    markers.count = mi; obelisks.count = oi; markers.instanceMatrix.needsUpdate = true; obelisks.instanceMatrix.needsUpdate = true;
    for (const side of ['bull', 'bear']) {
      let n = 0;
      for (const c of captured) if (c.side === side && n < 24) { dummy.position.set(Xp(c.price), 0, Z_NOW + 8); dummy.rotation.set(0, side === 'bull' ? 0 : Math.PI, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); flags[side].setMatrixAt(n++, dummy.matrix); }
      flags[side].count = n; flags[side].instanceMatrix.needsUpdate = true;
    }

    // soldiers
    const g = gore(), reduced = s.reduced;
    for (const side of ['bull', 'bear']) {
      const S = soldiers[side], d = dir(side), mesh = infantry[side];
      let n = 0;
      for (let i = S.length - 1; i >= 0; i--) {
        const u = S[i];
        if (st.now < u.t0 && u.state === 'dying') { /* scheduled */ }
        if (u.state === 'alive') { u.x += (u.tx - u.x) * Math.min(1, dt * 2.2); u.z += (u.tz - u.z) * Math.min(1, dt * 2.2); u.y = reduced ? 0 : Math.abs(Math.sin(now / 260 + u.ph)) * 0.6; u.rot = 0; }
        else if (u.state === 'rout') {
          u.x -= d * 55 * dt; u.y = Math.abs(Math.sin(now / 120 + u.ph)) * 1.2; u.rot = Math.PI; // flee to the rear
          if (st.now > (u.until || 0)) u.state = 'alive';
        } else if (u.state === 'leaving') {
          u.x -= d * 40 * dt; u.y -= dt * 6; if (st.now - u.t0 > 2200) { S.splice(i, 1); continue; }
        } else if (u.state === 'surge') {
          if (st.now >= u.t0) { u.x += d * 70 * dt; u.y = Math.abs(Math.sin(now / 110 + u.ph)) * 1.2; if (d * (u.x - u.tx) > 0) { u.state = 'leaving'; u.t0 = st.now; } }
        } else if (u.state === 'dying') {
          if (st.now >= u.t0) { const a = clamp((st.now - u.t0) / 650, 0, 1); u.fallA = a; if (a >= 1) { u.state = 'corpse'; u.t0 = st.now; } }
        } else if (u.state === 'corpse') {
          const age = st.now - u.t0; if (age > g.corpseMs) { S.splice(i, 1); continue; }
          u.y = -Math.max(0, (age - (g.corpseMs - 4000)) / 4000) * 4;
        }
      }
      for (const u of S) {
        if (n >= mesh.instanceMatrix.count) break;
        const lying = u.state === 'dying' || u.state === 'corpse' ? (u.state === 'corpse' ? 1 : u.fallA || 0) : 0;
        dummy.position.set(u.x, u.y + (lying ? 1.2 * lying : 0), u.z);
        dummy.rotation.set(lying * (u.fall || 1) * Math.PI / 2, (side === 'bull' ? 0 : Math.PI) + (u.rot || 0), 0);
        dummy.scale.setScalar(u.scale || 1); dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
        const shade = u.state === 'corpse' ? 0.4 : u.state === 'rout' ? 0.8 : 1;
        mesh.setColorAt(n, tmpC.setRGB(shade, shade * (u.state === 'corpse' && g.blood ? 0.75 : 1), shade * (u.state === 'corpse' && g.blood ? 0.75 : 1)));
        n++;
      }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // champions in front of walls, and the walls themselves
    let li = 0, si = 0;
    for (const [key, w] of walls) {
      const age = st.now - w.t0, X0 = Xp(w.p), wb = RULES.BAND * st.k, d = dir(w.side);
      const edgeX = w.side === 'bull' ? X0 + wb - 3 : X0 + 3;
      const H0 = clamp(8 + 5 * Math.log2(Math.max(1, w.usd / 2e6)), 8, 22);
      let h = H0, tilt = 0, sink = 0;
      if (w.state === 'rising') { h = H0 * clamp(age / 900, 0.05, 1); if (age > 900) w.state = 'standing'; }
      if (w.state === 'smashed') { tilt = clamp(age / 700, 0, 1) * 1.3; if (age > 5000) { walls.delete(key); continue; } }
      if (w.state === 'pulled') { sink = clamp(age / 1500, 0, 1); if (age > 1600) { walls.delete(key); continue; } }
      const stone = w.kind === 'stone';
      for (let z = Z_ARMY0 - 70; z < Z_ARMY0 + 4; z += stone ? 6.4 : 3.4) {
        const target = stone ? stones : logs, idx = stone ? si : li;
        if (idx >= 900) break;
        const jitter = hash(w.p + z) * 3;
        dummy.position.set(edgeX + d * (tilt * 6 * hash(z)), (stone ? h / 2 : h / 2) * (1 - sink) - sink * h, z);
        dummy.rotation.set(0, 0, -d * tilt * (0.6 + hash(z * 3)));
        dummy.scale.set(1, (h + jitter) * (stone ? 1 : 1), 1); if (!stone) dummy.scale.set(1, h + jitter, 1);
        dummy.updateMatrix(); target.setMatrixAt(idx, dummy.matrix);
        if (stone) si++; else li++;
      }
      if (w.state === 'standing' || w.state === 'rising') labels.push({ x: edgeX, y: h + 10, z: Z_ARMY0 - 30, text: `${fmtUsd(w.usd)} ${w.side === 'bull' ? 'buy' : 'sell'} wall`, until: st.now + 1, c: w.side === 'bull' ? '#7fe0c0' : '#ffb27a' });
    }
    logs.count = li; stones.count = si; logs.instanceMatrix.needsUpdate = true; stones.instanceMatrix.needsUpdate = true;

    // cavalry
    for (const side of ['bull', 'bear']) {
      const mesh = cavalry[side]; let n = 0;
      for (let i = riders.length - 1; i >= 0; i--) {
        const r = riders[i]; if (r.side !== side) continue;
        const age = st.now - r.t0; if (age < 0) continue;
        if (age > r.life) { riders.splice(i, 1); continue; }
        r.x += r.vx * dt;
        if (n < 260) {
          const fade = clamp((r.life - age) / 600, 0, 1);
          dummy.position.set(r.x, Math.abs(Math.sin(now / 90 + i)) * 1.6 - (1 - fade) * 14, r.z); dummy.rotation.set(0, side === 'bull' ? 0 : Math.PI, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
          mesh.setMatrixAt(n++, dummy.matrix);
          if (hash(now + i) < 0.15) emitParticles(r.x - dir(side) * 4, 1, r.z, 1, { kind: 0, seed: now + i, speed: 6, up: 8, life: 0.8 });
        }
      }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
    }

    // arrows and siege rocks
    let ai = 0, ri = 0;
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i], a = (st.now - f.t0) / f.dur;
      if (a < 0) continue;
      if (a >= 1) { if (f.onHit) f.onHit(); else emitParticles(f.ex, 1, f.ez, 3, { kind: 0, seed: f.t0 + i, speed: 8, up: 10, life: 0.6 }); flying.splice(i, 1); continue; }
      const x = f.sx + (f.ex - f.sx) * a, z = f.sz + (f.ez - f.sz) * a, y = 4 * f.h * a * (1 - a) + 4;
      const vy = 4 * f.h * (1 - 2 * a), vx = (f.ex - f.sx);
      dummy.position.set(x, y, z); dummy.rotation.set(0, 0, Math.atan2(vy, vx)); dummy.scale.setScalar(f.kind === 'rock' ? 1.6 : 1); dummy.updateMatrix();
      if (f.kind === 'rock') { if (ri < 24) rocks.setMatrixAt(ri++, dummy.matrix); emitParticles(x, y, z, 1, { kind: 0, seed: now + i, speed: 2, up: 2, life: 0.7, color: [0.9, 0.5, 0.15] }); }
      else if (ai < 600) arrows.setMatrixAt(ai++, dummy.matrix);
    }
    arrows.count = ai; rocks.count = ri; arrows.instanceMatrix.needsUpdate = true; rocks.instanceMatrix.needsUpdate = true;

    // particles
    for (let i = 0; i < pN; i++) {
      pAge[i] += dt;
      if (pAge[i] > pLife[i] || pPos[i * 3 + 1] < 0) {
        if (pKind[i] === 1 && pPos[i * 3 + 1] < 0 && g.blood && hash(i + now) < 0.12) splat(pPos[i * 3], pPos[i * 3 + 2], 2 + 3 * hash(i), 'rgba(90,6,8,0.5)');
        pN--; for (const [arr, k] of [[pPos, 3], [pVel, 3], [pCol, 3]]) arr.copyWithin(i * k, pN * k, pN * k + k);
        pLife[i] = pLife[pN]; pAge[i] = pAge[pN]; pKind[i] = pKind[pN]; i--; continue;
      }
      pVel[i * 3 + 1] -= 60 * dt;
      pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    }
    pGeo.setDrawRange(0, pN); pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
    {
      const cp = chunks.geometry.attributes.position.array, cc = chunks.geometry.attributes.color.array;
      for (let i = chunkList.length - 1; i >= 0; i--) {
        const c = chunkList[i]; c.age += dt;
        if (c.age > (gore().corpseMs / 1000)) { chunkList.splice(i, 1); continue; }
        if (!c.rest) { c.vy -= 60 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt; if (c.y <= 0.6) { c.y = 0.6; c.rest = true; } }
      }
      chunkList.forEach((c, i) => { cp.set([c.x, c.y, c.z], i * 3); cc.set(c.c, i * 3); });
      chunks.geometry.setDrawRange(0, chunkList.length); chunks.geometry.attributes.position.needsUpdate = true; chunks.geometry.attributes.color.needsUpdate = true;
    }

    // lightning, blood mist
    flash *= Math.exp(-dt / 0.12); flashLight.intensity = flash * 6;
    mist *= Math.exp(-dt / 6);
    scene.fog.color.copy(FOG).lerp(MIST, mist * 0.55); scene.background.copy(scene.fog.color);
    scene.fog.density = 0.00085 + mist * 0.00025;

    // camera
    const k = view.keys, spd = 320 * dt * (view.dist / 800);
    const fwdX = -Math.sin(view.yaw), fwdZ = -Math.cos(view.yaw);
    if (k.has('w') || k.has('arrowup')) { view.tx += fwdX * spd; view.tz += fwdZ * spd; }
    if (k.has('s') || k.has('arrowdown')) { view.tx -= fwdX * spd; view.tz -= fwdZ * spd; }
    if (k.has('a') || k.has('arrowleft')) { view.tx += fwdZ * spd; view.tz -= fwdX * spd; }
    if (k.has('d') || k.has('arrowright')) { view.tx -= fwdZ * spd; view.tz += fwdX * spd; }
    if (k.has('q')) view.yaw += dt * 0.9; if (k.has('e')) view.yaw -= dt * 0.9;
    let tx = view.tx, tz = view.tz, dist = view.dist, yaw = view.yaw, pitch = view.pitch;
    if (view.mode === 'cinematic') {
      tx = F * 0.6; tz = 140;
      if (!reduced) { yaw = 0.42 + 0.22 * Math.sin(now / 26000); dist = 820 + 60 * Math.sin(now / 17000); }
      if (focus) {
        const a = st.now < focus.until ? clamp((st.now - focus.t0) / 700, 0, 1) : clamp(1 - (st.now - focus.until) / 900, 0, 1);
        if (a <= 0 && st.now > focus.until) focus = null;
        else { tx += (focus.x - tx) * a; tz += (focus.z - tz) * a; dist += (360 - dist) * a; pitch += (0.42 - pitch) * a; }
      }
    } else if (view.mode === 'orbit') { tx = F * 0.6; tz = 140; if (!reduced) view.yaw += dt * 0.05; yaw = view.yaw; }
    const sx = shake > 0.2 ? (hash(now) - 0.5) * shake : 0, sy = shake > 0.2 ? (hash(now + 1) - 0.5) * shake : 0;
    shake *= Math.exp(-dt / 0.18);
    camera.position.set(tx + Math.sin(yaw) * Math.cos(pitch) * dist + sx, Math.sin(pitch) * dist + sy, tz + Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.lookAt(tx, 0, tz);
    renderer.render(scene, camera);
    drawOverlay(s);
  }

  // ---------------------------------------------------------------- overlay labels (2D canvas on top)
  const og = overlay.getContext('2d');
  function project(x, y, z) { v3.set(x, y, z).project(camera); if (v3.z > 1) return null; return [(v3.x + 1) / 2 * W, (1 - v3.y) / 2 * H]; }
  function drawOverlay(s) {
    const DPR = Math.min(2, window.devicePixelRatio || 1);
    if (overlay.width !== Math.round(W * DPR)) { overlay.width = Math.round(W * DPR); overlay.height = Math.round(H * DPR); }
    og.setTransform(DPR, 0, 0, DPR, 0, 0); og.clearRect(0, 0, W, H);
    og.textAlign = 'center';
    // price markers
    og.font = '600 11px "IBM Plex Mono", monospace';
    const step = s.rangePct <= 0.5 ? 100 : s.rangePct <= 1 ? 250 : 500, big = step * 5;
    const lo = s.cam * (1 - s.rangePct / 100 * 1.4), hi = s.cam * (1 + s.rangePct / 100 * 1.4);
    let lastX = -1e9;
    for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
      const q = project(Xp(p), p % big === 0 ? 34 : 9, Z_NOW + 18); if (!q || q[0] < 20 || q[0] > W - 20) continue;
      if (Math.abs(q[0] - lastX) < 64 && p % big) continue; lastX = q[0];
      og.fillStyle = p % big === 0 ? 'rgba(240,226,196,.95)' : 'rgba(200,210,225,.6)'; og.fillText('$' + p.toLocaleString('en-US'), q[0], q[1]);
    }
    // current price tag at the trench
    const q = project(frontX(Z_ARMY0), 2, Z_NOW + 4);
    if (q) { const t = '$' + s.mid.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); og.font = '600 12px "IBM Plex Mono", monospace'; const tw = og.measureText(t).width + 16; og.fillStyle = 'rgba(255,236,200,.96)'; og.fillRect(q[0] - tw / 2, q[1] + 6, tw, 19); og.fillStyle = '#0a1220'; og.fillText(t, q[0], q[1] + 19.5); }
    // wall pennants and event labels
    og.font = '600 11px "IBM Plex Sans", sans-serif';
    for (let i = labels.length - 1; i >= 0; i--) {
      const l = labels[i];
      if (st.now > l.until) { labels.splice(i, 1); continue; }
      const p = project(l.x, l.y, l.z); if (!p) continue;
      og.fillStyle = 'rgba(6,10,20,.72)'; const tw = og.measureText(l.text).width + 12; og.fillRect(p[0] - tw / 2, p[1] - 15, tw, 18);
      og.fillStyle = l.c; og.fillText(l.text, p[0], p[1] - 2);
    }
    for (let i = labels.length - 1; i >= 0; i--) if (labels[i].until === st.now + 1) labels.splice(i, 1);
    // data X-ray: the USD behind every band
    if (s.xray && s.bands) {
      og.font = '500 10px "IBM Plex Mono", monospace';
      for (const [side, arr] of [['bull', s.bands.bids], ['bear', s.bands.asks]]) for (const b of arr) {
        if (Math.abs(b.p + 25 - s.cam) > s.cam * s.rangePct / 100) continue;
        const p = project(Xp(b.p + RULES.BAND / 2), 16, Z_ARMY0 + 6); if (!p) continue;
        og.fillStyle = side === 'bull' ? 'rgba(127,224,192,.95)' : 'rgba(255,178,122,.95)';
        og.fillText(fmtUsd(b.usd), p[0], p[1]);
      }
      const cap = `X-ray: USD per $50 band · soldiers = 12×log2(1+USD/$250k)${unitScale.bull < 1 || unitScale.bear < 1 ? ' · scaled to fit' : ''}`;
      og.font = '500 11px "IBM Plex Mono", monospace'; const cw = og.measureText(cap).width + 16;
      og.fillStyle = 'rgba(6,10,20,.8)'; og.fillRect(W / 2 - cw / 2, H - 30, cw, 20); og.fillStyle = 'rgba(220,228,240,.95)'; og.fillText(cap, W / 2, H - 16);
    }
    // a gentle vignette
    const v = og.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.8);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.45)'); og.fillStyle = v; og.fillRect(0, 0, W, H);
    if (flash > 0.05) { og.fillStyle = `rgba(230,240,255,${flash * 0.5})`; og.fillRect(0, 0, W, H); }
  }

  return {
    frame, event, layout, reset, setMode, get mode() { return view.mode; },
    stats: () => ({ bull: soldiers.bull.length, bear: soldiers.bear.length, riders: riders.length, particles: pN, walls: walls.size, quality }),
    show(on) { el.style.display = on ? '' : 'none'; },
    dispose() { overlay.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); overlay.removeEventListener('wheel', onWheel); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); renderer.dispose(); el.remove(); },
  };
}
