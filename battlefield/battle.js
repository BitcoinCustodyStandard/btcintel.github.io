// BTC Intel — Market Battlefield.
// A visualization of market structure, not a prediction engine.
//   x axis  = price (the front line is the aggregated mid)
//   bulls   = resting bids (buyers), bears = resting asks (sellers)
//   size    = displayed order-book liquidity in each price band
//   strikes = large aggressive trades, explosions = liquidations
import { connectLive, BookSet } from './feeds.js';
import { Sprites } from './sprites.js';
import { Battle, liqTier } from './model.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fmtUsd = (v, d) => { if (v === null || v === undefined || !Number.isFinite(v)) return '—'; const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(d ?? 2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(d ?? 1)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(d ?? 0)}K` : `${s}$${a.toFixed(0)}`; };
const fmtPx = (v) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—');
const fmtPct = (v, d = 2) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%` : '—');
const ago = (t) => { if (!t) return 'never'; const s = Math.max(0, (clock() - t) / 1000); return s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- state
const S = {
  mode: 'connecting', // live | replay | connecting
  rangePct: 0.5, bigTrade: 250000, fxTrade: 100000, speed: 1, paused: false,
  book: null, mid: null, cam: null, prevMids: [],
  trades: [], liqs: [], flowSec: [], tickers: {}, funding: null, oi: null, server: null,
  venues: {}, lastBookAt: 0, sessionStart: null,
  replay: null,
  source: 'agg3', sourceNote: '', view: '2d', gore: 'stylized', xray: false,
};
try { S.gore = localStorage.getItem('bf-gore') || 'stylized'; } catch {}
// Selected source controls the book, the front line and the trades that become charges.
// Aggregated = Binance + Coinbase + Kraken (as on Newhedge); falls back to Coinbase + Kraken + OKX when Binance is blocked.
const SOURCES = { agg3: ['Binance', 'Coinbase', 'Kraken'], all: null, Coinbase: ['Coinbase'], Kraken: ['Kraken'], Binance: ['Binance'], OKX: ['OKX'] };
function sourceSet() {
  const want = SOURCES[S.source];
  if (!want) return null;
  if (S.source === 'agg3' && live) {
    const on = live.books.live();
    if (!on.includes('Binance')) { S.sourceNote = 'Binance unavailable here — aggregate uses Coinbase + Kraken + OKX'; return new Set(['Coinbase', 'Kraken', 'OKX']); }
  }
  S.sourceNote = '';
  return new Set(want);
}
const tradeInSource = (venue) => { const set = sourceSet(); return !set || !venue || set.has(venue.replace(/ perp$/, '')); };
const battle = new Battle({ bigTrade: S.bigTrade });
let s3 = null;
let clockOffset = 0; // replay maps wall time to recorded time
const clock = () => Date.now() + clockOffset;

// ---------------------------------------------------------------- event intake
function onEvent(e) {
  if (e.type === 'status') { S.venues[e.venue] = { state: e.state, note: e.note, at: Date.now() }; renderVenues(); return; }
  if (!S.sessionStart) S.sessionStart = e.t || clock();
  switch (e.type) {
    case 'trade':
      if (!(e.usd > 0)) return;
      if (tradeInSource(e.venue)) battle.trade(e);
      S.flowSec.push({ t: e.t, side: e.side, usd: e.usd });
      if (e.usd >= Math.min(S.bigTrade, S.fxTrade)) {
        S.trades.push(e);
        if (e.usd >= S.fxTrade) fx.strike(e);
        if (e.usd >= S.bigTrade) tape(e);
      }
      break;
    case 'flow': S.flowSec.push({ t: e.t, side: e.side, usd: e.usd }); battle.trade({ t: e.t, px: S.mid, usd: e.usd, side: e.side }); break;
    case 'liq': S.liqs.push(e); battle.liq(e); if (S.view !== '3d') fx.explode(e); tape(e); break;
    case 'ticker': S.tickers[e.venue] = { ...e }; break;
    case 'funding': S.funding = e; break;
    case 'oi': S.oi = e; break;
  }
}

// ---------------------------------------------------------------- sources
let live = null;
function startLive() {
  stopAll();
  S.mode = 'connecting'; clockOffset = 0; resetSession();
  live = connectLive(onEvent);
  const iv = setInterval(() => {
    if (!live) return clearInterval(iv);
    const only = sourceSet();
    const mid = live.books.mid(20000, only);
    if (!mid) return;
    S.book = live.books.aggregate(mid, 2, bucketFor(mid), 30000, only);
    battle.book(clock(), S.book, mid);
    s3?.layout();
    S.lastBookAt = Date.now();
    setMid(mid);
    if (S.mode !== 'live') { S.mode = 'live'; renderMode(); }
  }, 250);
  live.iv = iv;
  // If nothing usable arrives, fall back to the recorded replay.
  setTimeout(() => { if (S.mode === 'connecting') { note('Live exchange feeds could not be reached from this browser — showing the recorded replay instead.'); startReplay(); } }, 9000);
  renderMode();
}
function stopAll() {
  if (live) { clearInterval(live.iv); live.stop(); live = null; }
  if (S.replay) { S.replay.stop = true; S.replay = null; }
}
function resetSession() { battle.reset(); S.trades = []; S.liqs = []; S.flowSec = []; S.tickers = {}; S.funding = null; S.oi = null; S.book = null; S.mid = null; S.cam = null; S.prevMids = []; S.sessionStart = null; tapeEl.replaceChildren(); $('#feed')?.replaceChildren(); fx.clear(); }

async function startReplay() {
  stopAll();
  resetSession();
  S.mode = 'connecting'; renderMode();
  let data;
  for (const u of ['replay.json', 'battlefield/replay.json']) { try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) { data = await r.json(); break; } } catch {} }
  if (!data || !data.frames?.length) { S.mode = 'none'; renderMode(); note('No recorded replay is available yet.'); return; }
  const R = { data, i: 0, j: 0, t0: data.frames[0].t, stop: false };
  S.replay = R;
  S.mode = 'replay'; renderMode();
  R.venueStatus = data.venueStatus || {};
  S.venues = Object.fromEntries(Object.entries(R.venueStatus).map(([k, v]) => [k, { state: v.state === 'live' || v.liveAt ? 'recorded' : 'unavailable', note: v.note }]));
  renderVenues();
  let vt = R.t0, last = performance.now();
  const step = () => {
    if (R.stop) return;
    const now = performance.now();
    const dt = Math.min(250, now - last); last = now;
    if (!S.paused) vt += dt * S.speed;
    clockOffset = vt - Date.now();
    const F = data.frames;
    while (R.i < F.length - 1 && F[R.i + 1].t <= vt) R.i++;
    const f = F[R.i];
    if (f && S.bookT !== f.t) {
      S.bookT = f.t;
      S.book = { mid: f.mid, bucketUsd: data.bucketUsd, venues: Array(f.v).fill(''), bids: f.b, asks: f.a };
      S.lastBookAt = Date.now();
      setMid(f.mid);
      battle.book(vt, S.book, f.mid);
      s3?.layout();
    }
    const E = data.events;
    while (R.j < E.length && E[R.j].t <= vt) onEvent(E[R.j++]);
    if (vt >= F.at(-1).t) { // loop
      R.i = 0; R.j = 0; vt = R.t0; resetSession(); S.replayLoops = (S.replayLoops || 0) + 1;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function bucketFor(mid) { return mid > 50000 ? 10 : mid > 10000 ? 5 : 1; }
function setMid(mid) {
  S.mid = mid;
  if (S.cam === null) S.cam = mid;
  const t = clock();
  if (!S.prevMids.length || t - S.prevMids.at(-1)[0] > 1000) S.prevMids.push([t, mid]);
  S.prevMids = S.prevMids.filter(([x]) => t - x < 3600e3);
}

// ---------------------------------------------------------------- metrics
function prune() {
  const t = clock();
  S.flowSec = S.flowSec.filter((x) => t - x.t < 300e3);
  S.trades = S.trades.filter((x) => t - x.t < 3600e3);
  S.liqs = S.liqs.filter((x) => t - x.t < 24 * 3600e3);
}
function metrics() {
  const t = clock(), B = S.book, mid = S.mid;
  const m = { mid };
  if (B && mid) {
    const within = (arr, pct) => arr.filter(([p]) => Math.abs(p - mid) / mid <= pct / 100).reduce((s, [, u]) => s + u, 0);
    m.bid05 = within(B.bids, 0.5); m.ask05 = within(B.asks, 0.5);
    m.bid1 = within(B.bids, 1); m.ask1 = within(B.asks, 1);
    m.imb05 = (m.bid05 - m.ask05) / ((m.bid05 + m.ask05) || 1);
    m.imb1 = (m.bid1 - m.ask1) / ((m.bid1 + m.ask1) || 1);
    // walls: largest single price band within ±1%, merged to $50 bands so a wall split across ticks still reads as one
    const band = (arr) => { const g = new Map(); for (const [p, u] of arr) { if (Math.abs(p - mid) / mid > 0.01) continue; const k = Math.round(p / WALL_BAND) * WALL_BAND; g.set(k, (g.get(k) || 0) + u); } return [...g.entries()].sort((a, b) => b[1] - a[1])[0] || null; };
    m.buyWall = band(B.bids); m.sellWall = band(B.asks);
    m.venueCount = B.venues?.length || 0;
    // breakthrough: price reached by a market order of BRK_USD walking the displayed aggregated book
    const walk = (arr) => { let c = 0; for (const [p, u] of arr) { c += u; if (c >= BRK_USD) return p; } return null; };
    m.brkSell = walk(B.bids); m.brkBuy = walk(B.asks);
    m.brkSellPct = m.brkSell ? ((m.brkSell - mid) / mid) * 100 : null; m.brkBuyPct = m.brkBuy ? ((m.brkBuy - mid) / mid) * 100 : null;
  }
  const f60 = S.flowSec.filter((x) => t - x.t < 60e3);
  m.buy60 = f60.filter((x) => x.side === 'buy').reduce((s, x) => s + x.usd, 0);
  m.sell60 = f60.filter((x) => x.side === 'sell').reduce((s, x) => s + x.usd, 0);
  m.flowImb = (m.buy60 - m.sell60) / ((m.buy60 + m.sell60) || 1);
  const lw = (side, ms) => S.liqs.filter((x) => x.side === side && t - x.t < ms).reduce((s, x) => s + x.usd, 0);
  m.longLiq1h = lw('long', 3600e3); m.shortLiq1h = lw('short', 3600e3);
  m.longLiqS = lw('long', 1e15); m.shortLiqS = lw('short', 1e15);
  m.longLiq15 = lw('long', 900e3); m.shortLiq15 = lw('short', 900e3);
  const lt = S.trades.filter((x) => x.usd >= S.bigTrade && t - x.t < 900e3);
  m.bigCount = lt.length; m.bigBuy = lt.filter((x) => x.side === 'buy').reduce((s, x) => s + x.usd, 0); m.bigSell = lt.filter((x) => x.side === 'sell').reduce((s, x) => s + x.usd, 0);
  m.largest = lt.slice().sort((a, b) => b.usd - a.usd)[0] || null;
  const tk = S.tickers.Coinbase || S.tickers.Kraken || S.tickers.OKX;
  m.ch24 = tk?.ch24 ?? null; m.ch24Venue = tk?.venue;
  m.vol24 = Object.values(S.tickers).reduce((s, x) => s + (x.vol24Usd || 0), 0); m.volVenues = Object.keys(S.tickers);
  const p5 = S.prevMids.find(([x]) => t - x <= 300e3);
  m.mom5 = p5 && mid ? ((mid - p5[1]) / p5[1]) * 100 : null;
  // MODELED pressure index: weights are a presentation choice, not estimated
  const liqTot = m.longLiq15 + m.shortLiq15;
  const liqImb = liqTot ? (m.shortLiq15 - m.longLiq15) / liqTot : 0;
  m.pressure = Math.round(100 * clamp(0.5 * m.flowImb + 0.3 * (m.imb05 ?? 0) + 0.2 * liqImb, -1, 1));
  const flow = m.buy60 + m.sell60, liqBig = S.liqs.some((x) => x.usd >= 1e5 && t - x.t < 900e3);
  m.state = (m.mom5 !== null && Math.abs(m.mom5) > 0.4) || m.longLiq15 + m.shortLiq15 > 5e6 ? 'Volatile market' : flow > 8e6 || liqBig ? 'Active market' : 'Quiet market';
  metrics.cache = m;
  return m;
}

// ---------------------------------------------------------------- effects
const fx = {
  list: [], parts: [], scorch: [], shake: 0,
  clear() { this.list = []; this.parts = []; this.scorch = []; },
  strike(e) { if (this.list.length > 80) return; this.list.push({ kind: 'strike', e, born: performance.now(), life: 1600, z: zFor(e) }); },
  explode(e) {
    const f = { kind: 'boom', e, born: performance.now(), life: 3400 + Math.min(3200, Math.sqrt(e.usd) * 1.6), z: zFor(e) };
    f.R = clamp(9 + Math.sqrt(e.usd) / 16, 10, 150);
    this.list.push(f);
    this.scorch.push({ price: e.px, z: f.z, R: Math.min(f.R * 0.7, 60), born: performance.now(), long: e.side === 'long' });
    if (this.scorch.length > 60) this.scorch.shift();
    if (!reduced) this.shake = Math.max(this.shake, clamp(e.usd / 200000, 0, 14));
  },
};
const sprites = new Sprites();
const WALL_BAND = 50, WALL_MULT = 4, WALL_MIN_USD = 2e6, BRK_USD = 25e6;
const hash = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
// events land on the near half of the front (the "present"); position is stable per event
function zFor(e) { return Z_NEAR * 0.75 + hash((e.t % 100003) + e.usd) * (-Z_NEAR * 0.75 + 60); }

// ---------------------------------------------------------------- 3D world + camera
// World: X = price axis (0 = camera price), Z = along the front, Y = up.
// The front line is the price trail: z ≤ 0 is "now", far z is up to TRAIL_SEC ago.
const WORLD_HALF = 430, Z_NEAR = -330, Z_FAR = 560, TRAIL_SEC = 180;
const CAM = { yaw: -0.62, pitch: 0.96, dist: 1120, auto: false };
const CAM0 = { ...CAM };
const cv = $('#field'), g = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, F = 1;
const display = new Map();
function resize() {
  const r = cv.getBoundingClientRect();
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = r.width; H = r.height;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  F = (H / 2) / Math.tan((36 * Math.PI) / 360) * (W < 640 ? 0.78 : 1);
  if (W < 640 && CAM.pitch === CAM0.pitch) { CAM.pitch = 1.12; CAM.dist = 1250; }
}
new ResizeObserver(resize).observe(cv);
const kUsd = () => WORLD_HALF / (S.cam * S.rangePct / 100);
const Xp = (price) => (price - S.cam) * kUsd();
function project(X, Y, Z) {
  const cy = Math.cos(CAM.yaw), sy = Math.sin(CAM.yaw);
  const x1 = X * cy - Z * sy, z1 = X * sy + Z * cy;
  const sp = Math.sin(CAM.pitch), cp = Math.cos(CAM.pitch);
  const depth = CAM.dist - Y * sp + z1 * cp;
  if (depth < 40) return null;
  const s = F / depth;
  return [W / 2 + x1 * s, H * 0.58 - (Y * cp + z1 * sp) * s, s, depth];
}
// price at a point along the front (trail)
function priceAtAge(sec) {
  if (sec <= 0 || !S.prevMids.length) return S.mid;
  const t = clock() - sec * 1000;
  const P = S.prevMids;
  if (t <= P[0][0]) return P[0][1];
  for (let i = P.length - 1; i > 0; i--) if (P[i - 1][0] <= t) { const [t0, p0] = P[i - 1], [t1, p1] = P[i]; return p0 + (p1 - p0) * ((t - t0) / ((t1 - t0) || 1)); }
  return S.mid;
}
const ageAt = (z) => (z <= 0 ? 0 : (z / Z_FAR) * TRAIL_SEC);
let frontCache = null;
function frontX(z) {
  // sampled every 10 world units, linear in between
  const i = clamp((z - Z_NEAR) / 10, 0, frontCache.length - 1.001), i0 = Math.floor(i);
  return frontCache[i0] + (frontCache[i0 + 1] - frontCache[i0]) * (i - i0);
}
function buildFront() {
  frontCache = [];
  for (let z = Z_NEAR; z <= Z_FAR + 10; z += 10) frontCache.push(Xp(priceAtAge(ageAt(z))));
}
const ZS = (() => { const a = []; for (let z = Z_NEAR; z <= Z_FAR; z += 30) a.push(z); a.push(Z_FAR); return a; })();
function poly(points, fill, stroke) {
  let first = true;
  g.beginPath();
  for (const p of points) { const q = project(p[0], p[1] || 0, p[2]); if (!q) continue; if (first) { g.moveTo(q[0], q[1]); first = false; } else g.lineTo(q[0], q[1]); }
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.stroke(); }
}

// ---------------------------------------------------------------- interaction
let drag = null, pinch = null;
cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: CAM.yaw, pitch: CAM.pitch }; cv.setPointerCapture(e.pointerId); CAM.auto = false; syncOrbit(); });
cv.addEventListener('pointermove', (e) => { if (!drag || pinch) return; CAM.yaw = drag.yaw + (e.clientX - drag.x) * 0.006; CAM.pitch = clamp(drag.pitch - (e.clientY - drag.y) * 0.004, 0.45, 1.42); });
cv.addEventListener('pointerup', () => { drag = null; });
cv.addEventListener('wheel', (e) => { e.preventDefault(); CAM.dist = clamp(CAM.dist * (1 + e.deltaY * 0.0012), 520, 2200); }, { passive: false });
cv.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), dist: CAM.dist }; }, { passive: true });
cv.addEventListener('touchmove', (e) => { if (pinch && e.touches.length === 2) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); CAM.dist = clamp(pinch.dist * (pinch.d / d), 520, 2200); } }, { passive: true });
cv.addEventListener('touchend', () => { pinch = null; });
cv.addEventListener('dblclick', () => resetView());
function resetView() { Object.assign(CAM, CAM0); if (W < 640) { CAM.pitch = 1.12; CAM.dist = 1250; } syncOrbit(); }
function syncOrbit() { $('#v-orbit')?.setAttribute('aria-pressed', String(CAM.auto)); }

// ---------------------------------------------------------------- frame
let lastFrame = performance.now(), gaitT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(64, now - lastFrame); lastFrame = now;
  if (!W) return;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (S.mid && S.cam !== null) S.cam += (S.mid - S.cam) * (1 - Math.exp(-dt / 2600));
  battle.flush(clock());
  for (const e of battle.drain()) { feedEvent(e); s3?.event(e); }
  if (S.view === '3d' && s3) { s3.frame(); drawDepthChart(); return; }
  if (CAM.auto && !reduced) CAM.yaw += dt * 0.00004;
  let sx = 0, sy = 0;
  if (fx.shake > 0.2) { sx = (Math.random() - 0.5) * fx.shake; sy = (Math.random() - 0.5) * fx.shake * 0.6; fx.shake *= Math.exp(-dt / 180); } else fx.shake = 0;
  drawBackdrop();
  if (!S.mid || S.cam === null) {
    g.fillStyle = 'rgba(200,210,225,.6)'; g.font = '500 13px "IBM Plex Mono", monospace'; g.textAlign = 'center';
    g.fillText(S.mode === 'none' ? 'No data source available' : 'Connecting to exchange order books…', W / 2, H / 2);
    return;
  }
  g.save(); g.translate(sx, sy);
  buildFront();
  const m = metrics();
  gaitT += dt;
  drawTerrain();
  drawScorch(now);
  drawFrontLine(now);
  const items = [];
  collectArmies(dt, m, items);
  collectFx(now, items);
  items.sort((a, b) => b.depth - a.depth);
  for (const it of items) it.draw();
  drawParticles(now);
  drawLabels(m);
  g.restore();
  drawVignette();
  drawDepthChart();
}

function drawBackdrop() {
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#03060d'); bg.addColorStop(0.45, '#081222'); bg.addColorStop(1, '#050a14');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
}
function gridStep() {
  const span = S.cam * S.rangePct / 100 * 2;
  return [5, 10, 25, 50, 100, 250, 500, 1000, 2500].find((s) => span / s <= 12) || 5000;
}
function drawTerrain() {
  const XL = -WORLD_HALF * 2.2, XR = WORLD_HALF * 2.2, Z0 = Z_NEAR - 160, Z1 = Z_FAR + 220;
  // ground slab
  const c = project(0, 0, 0);
  const gr = g.createRadialGradient(c[0], c[1], 0, c[0], c[1], Math.max(W, H) * 0.9);
  gr.addColorStop(0, '#132238'); gr.addColorStop(0.6, '#0b1729'); gr.addColorStop(1, '#060c18');
  poly([[XL, 0, Z0], [XR, 0, Z0], [XR, 0, Z1], [XL, 0, Z1]], gr);
  // territories: bull side left of the trench, bear side right
  const left = ZS.map((z) => [frontX(z), 0, z]);
  poly([[XL, 0, Z_FAR], [XL, 0, Z_NEAR], ...left], 'rgba(40,170,120,0.10)');
  poly([...left, [XR, 0, Z_FAR], [XR, 0, Z_NEAR]].reverse(), 'rgba(210,60,66,0.10)');
  // map grid: constant-price lines (absolute) and along-front lines
  const step = gridStep(), lo = S.cam * (1 - S.rangePct / 100 * 2), hi = S.cam * (1 + S.rangePct / 100 * 2);
  g.lineWidth = 1;
  for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
    const X = Xp(p), a = p % (step * 2) === 0 ? 0.12 : 0.05;
    const q0 = project(X, 0, Z0), q1 = project(X, 0, Z1);
    if (!q0 || !q1) continue;
    g.strokeStyle = `rgba(130,160,210,${a})`; g.beginPath(); g.moveTo(q0[0], q0[1]); g.lineTo(q1[0], q1[1]); g.stroke();
  }
  for (let z = Z_NEAR - 120; z <= Z_FAR + 200; z += 80) {
    const q0 = project(XL, 0, z), q1 = project(XR, 0, z);
    if (!q0 || !q1) continue;
    g.strokeStyle = 'rgba(130,160,210,0.045)'; g.beginPath(); g.moveTo(q0[0], q0[1]); g.lineTo(q1[0], q1[1]); g.stroke();
  }
  // order-book depth shading along the trench (same data as the armies)
  if (!S.book) return;
  const k = kUsd(), b = S.book.bucketUsd, mid = S.mid;
  const strip = (arr, rgb) => {
    const max = Math.max(1, ...arr.map(([, u]) => u));
    for (const [p, u] of arr) {
      const a = Math.min(0.2, 0.24 * Math.sqrt(u / max));
      if (a < 0.015) continue;
      const d0 = (p - mid) * k, d1 = (p + b - mid) * k;
      const zs = [Z_NEAR, Z_NEAR / 2, 0, Z_FAR * 0.35, Z_FAR * 0.7];
      poly([...zs.map((z) => [frontX(z) + d0, 0, z]), ...zs.slice().reverse().map((z) => [frontX(z) + d1, 0, z])], `rgba(${rgb},${a.toFixed(3)})`);
    }
  };
  strip(S.book.bids, '47,191,143'); strip(S.book.asks, '229,72,77');
}
function drawScorch(now) {
  for (let i = fx.scorch.length - 1; i >= 0; i--) {
    const s = fx.scorch[i], age = (now - s.born) / 60000;
    if (age > 1) { fx.scorch.splice(i, 1); continue; }
    const X = Xp(s.price), pts = [];
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) pts.push([X + Math.cos(a) * s.R, 0, s.z + Math.sin(a) * s.R * 0.8]);
    poly(pts, `rgba(4,6,10,${0.32 * (1 - age)})`);
    poly(pts.map(([x, y, z]) => [X + (x - X) * 0.55, y, s.z + (z - s.z) * 0.55]), `rgba(${s.long ? '120,40,30' : '30,90,70'},${0.25 * (1 - age)})`);
  }
}
function drawFrontLine(now) {
  // glowing light-curtain rising from the trench
  const base = ZS.map((z) => [frontX(z), 0, z]);
  const top = ZS.slice().reverse().map((z) => [frontX(z), 22, z]);
  const q = project(frontX(0), 0, 0), qt = project(frontX(0), 22, 0);
  if (q && qt) {
    const gr = g.createLinearGradient(0, q[1], 0, qt[1]);
    gr.addColorStop(0, 'rgba(255,220,160,0.22)'); gr.addColorStop(1, 'rgba(255,220,160,0)');
    poly([...base, ...top], gr);
  }
  g.save();
  g.shadowColor = 'rgba(255,190,110,.95)'; g.shadowBlur = 14; g.lineWidth = 2.2; g.strokeStyle = 'rgba(255,236,200,.95)';
  g.beginPath(); let f = true;
  for (let z = Z_NEAR; z <= Z_FAR; z += 10) { const p = project(frontX(z), 0, z); if (!p) continue; if (f) { g.moveTo(p[0], p[1]); f = false; } else g.lineTo(p[0], p[1]); }
  g.stroke(); g.restore();
  // time ticks along the trail
  g.font = '500 10px "IBM Plex Mono", monospace'; g.textAlign = 'center';
  for (const sec of [0, 60, 120, 180]) {
    const z = sec === 0 ? 0 : (sec / TRAIL_SEC) * Z_FAR;
    const p = project(frontX(z), 0, z); if (!p) continue;
    g.fillStyle = 'rgba(255,236,200,.8)'; g.beginPath(); g.arc(p[0], p[1], 2.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(220,226,236,.55)'; g.fillText(sec === 0 ? 'NOW' : `−${sec / 60}m`, p[0] + 16, p[1] - 6);
  }
  // sparks along the present section, proportional to traded volume
  if (!reduced) {
    const m = metrics.cache || { buy60: 0, sell60: 0 };
    const rate = clamp((m.buy60 + m.sell60) / 5e6, 0.3, 6);
    for (let i = 0; i < rate; i++) if (Math.random() < 0.55) {
      const z = Z_NEAR + Math.random() * -Z_NEAR * 1.1, buy = Math.random() < m.buy60 / ((m.buy60 + m.sell60) || 1);
      fx.parts.push({ X: frontX(z), Y: 2 + Math.random() * 6, Z: z, vx: (buy ? 1 : -1) * (0.6 + Math.random()), vy: 0.8 + Math.random() * 1.2, vz: (Math.random() - 0.5), life: 600 + Math.random() * 600, born: now, c: buy ? '143,245,204' : '255,179,166', r: 1.3 });
    }
  }
}

function collectArmies(dt, m, items) {
  const B = S.book; if (!B) return;
  const k = kUsd(), mid = S.mid;
  const all = [...B.bids, ...B.asks];
  const total = all.reduce((s, [, u]) => s + u, 0);
  const budget = W < 640 ? 260 : W < 1100 ? 460 : 680;
  const unitUsd = Math.max(15000, total / budget);
  const ease = 1 - Math.exp(-dt / 350);
  const momentum = { bull: m.flowImb > 0.15, bear: m.flowImb < -0.15 };
  const seen = new Set();
  const t = performance.now();
  // screen direction of +X decides sprite facing
  const qa = project(0, 0, 0), qb = project(10, 0, 0);
  const plusXRight = qa && qb ? qb[0] > qa[0] : true;
  const zLo = Z_NEAR * 0.92, zHi = Z_FAR * 0.62;
  for (const [arr, species] of [[B.bids, 'bull'], [B.asks, 'bear']]) {
    for (const [p, u] of arr) {
      const key = species + p; seen.add(key);
      const target = Math.min(14, u / unitUsd);
      const n = (display.get(key) || 0) + (target - (display.get(key) || 0)) * ease;
      display.set(key, n);
      const dp = (p + B.bucketUsd / 2 - mid) * k;
      if (Math.abs(dp) > WORLD_HALF * 1.6) continue;
      const count = Math.ceil(n);
      for (let j = 0; j < count; j++) {
        const z = zLo + hash(p * 3.7 + j * 11.1) * (zHi - zLo);
        let X = frontX(z) + dp + (hash(p + j * 5.3) - 0.5) * B.bucketUsd * k * 0.9, Z = z;
        // knock-back from fresh explosions
        for (const f of fx.list) if (f.kind === 'boom') {
          const age = (t - f.born) / f.life; if (age > 0.35) continue;
          const ex = Xp(f.e.px), dx = X - ex, dz = Z - f.z, d = Math.hypot(dx, dz), r = f.R * 2.2;
          if (d < r) { const push = (1 - d / r) * (1 - age / 0.35) * 18; X += (dx / (d || 1)) * push; Z += (dz / (d || 1)) * push; }
        }
        const q = project(X, 0, Z); if (!q) continue;
        const frac = j === count - 1 ? (n - Math.floor(n) || 1) : 1;
        const hW = 15 + 7 * hash(p * 1.3 + j);
        items.push({ depth: q[3], draw: () => unit(species, q, hW, clamp(frac, 0.2, 1), momentum[species], hash(p + j) * 6.28, plusXRight) });
      }
    }
  }
  for (const key of display.keys()) if (!seen.has(key)) { const v = display.get(key) * (1 - ease); if (v < 0.05) display.delete(key); else display.set(key, v); }
  // walls: $50 bands ≥ 4× median band and ≥ $2M → translucent barriers + champion
  const bands = (arr) => { const mm = new Map(); for (const [p, u] of arr) { const kk = Math.round(p / WALL_BAND) * WALL_BAND; mm.set(kk, (mm.get(kk) || 0) + u); } return [...mm.entries()]; };
  const bB = bands(B.bids), bA = bands(B.asks);
  const sorted = [...bB, ...bA].map(([, u]) => u).sort((a, b) => a - b);
  const wallMin = Math.max((sorted[Math.floor(sorted.length / 2)] || 1) * WALL_MULT, WALL_MIN_USD);
  const walls = [];
  for (const [arr, species] of [[bB, 'bull'], [bA, 'bear']]) for (const [p, u] of arr) if (u >= wallMin && Math.abs(p - mid) / mid <= S.rangePct / 100 * 1.3) walls.push({ species, p, u });
  walls.sort((a, b) => b.u - a.u);
  placed.length = 0;
  for (const w of walls.slice(0, W < 640 ? 3 : 5)) {
    const dp = (w.p - mid) * k, hgt = 18 + 22 * Math.log2(w.u / wallMin + 1);
    const zs = [Z_NEAR * 0.78, Z_NEAR * 0.55, Z_NEAR * 0.32, Z_NEAR * 0.1];
    const qn = project(frontX(zs[0]) + dp, 0, zs[0]);
    if (!qn) continue;
    items.push({ depth: qn[3] + 30, draw: () => wallPanel(w, dp, hgt, zs) });
    const qc = project(frontX(Z_NEAR * 0.86) + dp, 0, Z_NEAR * 0.86);
    if (qc) items.push({ depth: qc[3], draw: () => { unit(w.species, qc, 34 + Math.min(18, hgt * 0.6), 1, false, 0, plusXRight, true); wallLabel(w, qc, hgt); } });
  }
}
function unit(species, q, hW, alpha, march, phase, plusXRight, champion = false) {
  const [x, y, s, depth] = q;
  const px = hW * s * 1.05;
  if (px < 2.5) return;
  const fog = clamp(1 - (depth - CAM.dist * 0.85) / (CAM.dist * 1.1), 0.25, 1);
  // ground shadow
  g.fillStyle = `rgba(0,0,0,${0.35 * fog})`;
  g.beginPath(); g.ellipse(x, y, px * 0.75, px * 0.75 * Math.sin(CAM.pitch) * 0.32, 0, 0, Math.PI * 2); g.fill();
  const fr = reduced ? 0 : march ? Math.floor((gaitT / 140 + phase) % 4) : 0;
  const spr = sprites.get(species, fr, px, 1 - fog, champion);
  const w = spr.w * spr.scale, h = spr.h * spr.scale;
  const bob = reduced ? 0 : Math.sin(performance.now() / 700 + phase) * 0.5 * s;
  const faceRight = species === 'bull' ? plusXRight : !plusXRight;
  g.globalAlpha = alpha * (0.5 + 0.5 * fog);
  if (faceRight) g.drawImage(spr.img, x - w * 0.55, y - h + 2 + bob, w, h);
  else { g.save(); g.translate(x + w * 0.55, y - h + 2 + bob); g.scale(-1, 1); g.drawImage(spr.img, 0, 0, w, h); g.restore(); }
  g.globalAlpha = 1;
}
function wallPanel(w, dp, hgt, zs) {
  const base = zs.map((z) => [frontX(z) + dp, 0, z]);
  const top = zs.slice().reverse().map((z) => [frontX(z) + dp, hgt, z]);
  const rgb = w.species === 'bull' ? '63,210,154' : '232,86,91';
  const q0 = project(base[1][0], 0, base[1][2]), q1 = project(base[1][0], hgt, base[1][2]);
  const gr = q0 && q1 ? g.createLinearGradient(0, q0[1], 0, q1[1]) : `rgba(${rgb},0.2)`;
  if (q0 && q1) { gr.addColorStop(0, `rgba(${rgb},0.34)`); gr.addColorStop(1, `rgba(${rgb},0.06)`); }
  poly([...base, ...top], gr);
  // top face gives the barrier thickness
  const th = 6, dir = w.species === 'bull' ? -1 : 1;
  poly([...zs.map((z) => [frontX(z) + dp, hgt, z]), ...zs.slice().reverse().map((z) => [frontX(z) + dp + dir * th, hgt, z])], `rgba(${rgb},0.28)`);
  g.save(); g.lineWidth = 1.6; g.strokeStyle = `rgba(${rgb},0.9)`; g.shadowColor = `rgba(${rgb},0.9)`; g.shadowBlur = 8;
  g.beginPath(); top.forEach((p, i) => { const q = project(p[0], p[1], p[2]); if (q) i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke(); g.restore();
}
const placed = [];
let hudBox = null;
function measureHud() { const st = $('#stage').getBoundingClientRect(), r = $('.hud.tc').getBoundingClientRect(); hudBox = { l: r.left - st.left - 6, r: r.right - st.left + 6, b: r.bottom - st.top + 6 }; }
setInterval(measureHud, 1000);
function wallLabel(w, q, hgt) {
  const txt = `${w.species === 'bull' ? 'BID WALL' : 'ASK WALL'}  ${fmtUsd(w.u)}  @ ${Math.round(w.p).toLocaleString('en-US')}`;
  g.font = '600 10.5px "IBM Plex Mono", monospace';
  const tw = g.measureText(txt).width + 14;
  const lx = clamp(q[0] - tw / 2, 6, W - tw - 6);
  let ly = q[1] - (34 + Math.min(18, hgt * 0.6)) * q[2] * 1.3 - 24;
  for (let i = 0; i < 6 && placed.some((r) => lx < r.x + r.w + 4 && lx + tw + 4 > r.x && ly < r.y + 20 && ly + 20 > r.y); i++) ly += 22;
  if (hudBox && lx < hudBox.r && lx + tw > hudBox.l && ly < hudBox.b) return; // would sit under the price panel
  if (ly > H - 30) return;
  placed.push({ x: lx, y: ly, w: tw });
  const rgb = w.species === 'bull' ? '63,210,154' : '232,86,91';
  g.strokeStyle = `rgba(${rgb},.55)`; g.beginPath(); g.moveTo(q[0], q[1] - 6); g.lineTo(clamp(q[0], lx + 4, lx + tw - 4), ly + 18); g.stroke();
  g.fillStyle = 'rgba(5,10,20,.86)'; g.fillRect(lx, ly, tw, 18);
  g.strokeStyle = `rgba(${rgb},.75)`; g.strokeRect(lx + 0.5, ly + 0.5, tw - 1, 17);
  g.fillStyle = w.species === 'bull' ? '#8ff5cc' : '#ffb3a6'; g.textAlign = 'left'; g.fillText(txt, lx + 7, ly + 12.5);
}

function collectFx(now, items) {
  for (let i = fx.list.length - 1; i >= 0; i--) {
    const f = fx.list[i], age = (now - f.born) / f.life;
    if (age >= 1) { fx.list.splice(i, 1); continue; }
    const X = Xp(f.e.px), q = project(X, 0, f.z); if (!q) continue;
    items.push({ depth: q[3] - 5, draw: () => (f.kind === 'strike' ? drawStrike(f, age) : drawBoom(f, age, now)) });
  }
}
function drawStrike(f, age) {
  const e = f.e, buy = e.side === 'buy';
  const tX = Xp(e.px), z = f.z, sX = tX + (buy ? -1 : 1) * 260, apex = 120;
  const k = clamp(age / 0.4, 0, 1);
  const rgb = buy ? '63,210,154' : '232,86,91';
  const wgt = clamp(Math.log10(e.usd / 5e4), 0.6, 3.6);
  const at = (u) => project(sX + (tX - sX) * u, apex * 4 * u * (1 - u), z);
  if (k < 1) {
    g.save(); g.strokeStyle = `rgba(${rgb},.9)`; g.lineWidth = wgt; g.lineCap = 'round'; g.shadowColor = `rgba(${rgb},1)`; g.shadowBlur = 10;
    g.beginPath(); let st = true;
    for (let u = Math.max(0, k - 0.3); u <= k; u += 0.02) { const p = at(u); if (!p) continue; st ? g.moveTo(p[0], p[1]) : g.lineTo(p[0], p[1]); st = false; }
    g.stroke(); g.restore();
  } else {
    const a2 = (age - 0.4) / 0.6, R = (6 + wgt * 9) * (0.3 + a2 * 1.4), pts = [];
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) pts.push([tX + Math.cos(a) * R, 0, z + Math.sin(a) * R]);
    g.lineWidth = 1.5; poly(pts, null, `rgba(${rgb},${(1 - a2) * 0.9})`); g.lineWidth = 1;
    if (a2 < 0.75) {
      const p = project(tX, 30 + a2 * 20, z);
      if (p) { g.font = '600 10.5px "IBM Plex Mono", monospace'; g.textAlign = 'center'; g.fillStyle = `rgba(${buy ? '143,245,204' : '255,179,166'},${1 - a2 / 0.75})`; g.fillText(`${fmtUsd(e.usd)} ${buy ? 'BUY' : 'SELL'} · ${e.venue}`, p[0], p[1]); }
    }
  }
}
function drawBoom(f, age, now) {
  const e = f.e, long = e.side === 'long';
  const X = Xp(e.px) + (long ? -1 : 1) * 10, Z = f.z, R = f.R;
  if (!f.spawned) {
    f.spawned = true;
    if (!reduced) for (let i = 0; i < clamp(e.usd / 20000, 10, 110); i++) {
      const a = Math.random() * Math.PI * 2, v = (0.5 + Math.random() * 2.4) * (R / 30);
      fx.parts.push({ X, Y: 4, Z, vx: Math.cos(a) * v, vy: 1.5 + Math.random() * 3.5 * (R / 40), vz: Math.sin(a) * v, life: 800 + Math.random() * 1000, born: now, c: Math.random() < 0.55 ? '255,190,110' : long ? '63,210,154' : '232,86,91', r: 1 + Math.random() * 1.8, grav: true });
    }
  }
  // ground shockwave ring (true ground ellipse from projection)
  const rr = R * (0.5 + 3 * age), pts = [];
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) pts.push([X + Math.cos(a) * rr, 0, Z + Math.sin(a) * rr]);
  g.lineWidth = 2.4 * (1 - age) + 0.6;
  poly(pts, null, `rgba(${long ? '232,86,91' : '63,210,154'},${(1 - age) * 0.85})`);
  g.lineWidth = 1;
  // fireball billboard
  const c = project(X, R * 0.55, Z); if (!c) return;
  const fa = clamp(1 - age / 0.5, 0, 1), sr = R * c[2] * (0.5 + 0.6 * Math.min(1, age / 0.1));
  if (fa > 0) {
    g.globalCompositeOperation = 'lighter';
    const pool = project(X, 0, Z);
    if (pool) { const gl = g.createRadialGradient(pool[0], pool[1], 0, pool[0], pool[1], sr * 2.6); gl.addColorStop(0, `rgba(255,160,70,${0.4 * fa})`); gl.addColorStop(1, 'rgba(255,160,70,0)'); g.fillStyle = gl; g.beginPath(); g.ellipse(pool[0], pool[1], sr * 2.6, sr * 2.6 * Math.sin(CAM.pitch) * 0.6, 0, 0, Math.PI * 2); g.fill(); }
    const gr = g.createRadialGradient(c[0], c[1], 0, c[0], c[1], sr);
    gr.addColorStop(0, `rgba(255,250,235,${fa})`); gr.addColorStop(0.3, `rgba(255,196,110,${fa * 0.9})`); gr.addColorStop(0.7, `rgba(225,90,40,${fa * 0.45})`); gr.addColorStop(1, 'rgba(120,30,20,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(c[0], c[1], sr, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';
  }
  // smoke column
  if (age > 0.12) { const sm = project(X, R * (0.8 + age * 2.2), Z); if (sm) { g.fillStyle = `rgba(28,34,46,${0.4 * (1 - age)})`; g.beginPath(); g.arc(sm[0], sm[1], sr * (0.7 + age * 1.4), 0, Math.PI * 2); g.fill(); } }
  if (age < 0.8) {
    const lp = project(X, R * 1.6 + 26, Z);
    if (lp) {
      g.font = `600 ${e.usd >= 1e6 ? 13 : 11}px "IBM Plex Mono", monospace`; g.textAlign = 'center';
      const txt = `${long ? 'LONG' : 'SHORT'} LIQUIDATED  ${fmtUsd(e.usd)}  · ${e.venue}`, tw = g.measureText(txt).width + 14, a = 1 - age / 0.8;
      g.fillStyle = `rgba(5,10,20,${0.82 * a})`; g.fillRect(lp[0] - tw / 2, lp[1] - 13, tw, 18);
      g.fillStyle = `rgba(255,226,190,${a})`; g.fillText(txt, lp[0], lp[1]);
    }
  }
  if (e.usd >= 1e6 && age < 0.25 && !reduced) { g.fillStyle = `rgba(255,170,90,${0.08 * (1 - age / 0.25)})`; g.fillRect(-20, -20, W + 40, H + 40); }
}
function drawParticles(now) {
  g.globalCompositeOperation = 'lighter';
  for (let i = fx.parts.length - 1; i >= 0; i--) {
    const p = fx.parts[i], a = (now - p.born) / p.life;
    if (a >= 1 || p.Y < 0) { fx.parts.splice(i, 1); continue; }
    p.X += p.vx; p.Y += p.vy; p.Z += p.vz; p.vy -= p.grav ? 0.12 : 0.02;
    const q = project(p.X, p.Y, p.Z); if (!q) continue;
    g.fillStyle = `rgba(${p.c},${(1 - a) * 0.9})`;
    g.beginPath(); g.arc(q[0], q[1], Math.max(0.6, p.r * q[2] * 3), 0, Math.PI * 2); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  if (fx.parts.length > 1200) fx.parts.splice(0, fx.parts.length - 1200);
}
function drawLabels(m) {
  // painted price markers at the near edge of the map
  const step = gridStep() * 2;
  const lo = S.cam * (1 - S.rangePct / 100 * 1.5), hi = S.cam * (1 + S.rangePct / 100 * 1.5);
  g.font = '600 11px "IBM Plex Mono", monospace'; g.textAlign = 'center';
  const qm = project(frontX(Z_NEAR), 0, Z_NEAR - 40);
  for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
    const q = project(Xp(p), 0, Z_NEAR - 40); if (!q || q[0] < 30 || q[0] > W - 30 || q[1] > H - (W < 640 ? 80 : 8)) continue;
    if (qm && Math.abs(q[0] - qm[0]) < 60) continue;
    g.fillStyle = 'rgba(170,190,220,.5)'; g.fillText(p.toLocaleString('en-US'), q[0], q[1]);
  }
  // current price tag at the near end of the trench
  const q = project(frontX(Z_NEAR * 0.98), 0, Z_NEAR * 0.98);
  if (q) {
    const t = fmtPx(S.mid); g.font = '600 12px "IBM Plex Mono", monospace';
    const tw = g.measureText(t).width + 16, y = clamp(q[1] + 8, 0, H - 24);
    g.fillStyle = 'rgba(255,236,200,.96)'; g.fillRect(q[0] - tw / 2, y, tw, 19);
    g.fillStyle = '#0a1220'; g.fillText(t, q[0], y + 13.5);
  }
}
function drawVignette() {
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const v = g.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.3, W / 2, H * 0.55, Math.max(W, H) * 0.78);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.6)');
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  // top fog band (distance haze)
  const f = g.createLinearGradient(0, 0, 0, H * 0.35);
  f.addColorStop(0, 'rgba(6,10,20,.85)'); f.addColorStop(1, 'rgba(6,10,20,0)');
  g.fillStyle = f; g.fillRect(0, 0, W, H * 0.35);
}

// cumulative depth chart (bottom-left overlay)
const dc = $('#depth'), dg = dc?.getContext('2d');
function drawDepthChart() {
  if (!dc || !S.book || !S.mid || dc.offsetParent === null) return;
  const r = dc.getBoundingClientRect(), w = r.width, h = r.height;
  if (dc.width !== Math.round(w * DPR)) { dc.width = Math.round(w * DPR); dc.height = Math.round(h * DPR); }
  dg.setTransform(DPR, 0, 0, DPR, 0, 0); dg.clearRect(0, 0, w, h);
  const span = S.mid * S.rangePct / 100;
  const cum = (arr) => { let c = 0; return arr.filter(([p]) => Math.abs(p - S.mid) <= span).map(([p, u]) => [p, (c += u)]); };
  const bids = cum(S.book.bids), asks = cum(S.book.asks);
  const max = Math.max(1, bids.at(-1)?.[1] || 0, asks.at(-1)?.[1] || 0);
  const X = (p) => ((p - (S.mid - span)) / (2 * span)) * w, Y = (v) => h - 14 - (v / max) * (h - 22);
  for (const [arr, rgb] of [[bids, '63,210,154'], [asks, '232,86,91']]) {
    if (!arr.length) continue;
    dg.beginPath(); dg.moveTo(X(S.mid), Y(0));
    for (const [p, v] of arr) dg.lineTo(X(p), Y(v));
    dg.lineTo(X(arr.at(-1)[0]), Y(0)); dg.closePath();
    dg.fillStyle = `rgba(${rgb},.18)`; dg.fill();
    dg.beginPath(); arr.forEach(([p, v], i) => (i ? dg.lineTo(X(p), Y(v)) : dg.moveTo(X(p), Y(v)))); dg.strokeStyle = `rgba(${rgb},.95)`; dg.lineWidth = 1.5; dg.stroke();
  }
  dg.fillStyle = 'rgba(255,236,200,.8)'; dg.fillRect(X(S.mid) - 0.5, 4, 1, h - 18);
  dg.font = '500 9.5px "IBM Plex Mono", monospace'; dg.fillStyle = 'rgba(160,175,200,.8)';
  dg.textAlign = 'left'; dg.fillText(Math.round(S.mid - span).toLocaleString('en-US'), 2, h - 2);
  dg.textAlign = 'right'; dg.fillText(Math.round(S.mid + span).toLocaleString('en-US'), w - 2, h - 2);
  dg.textAlign = 'center'; dg.fillText(fmtUsd(max) + ' cum.', w / 2, 10);
}

// ---------------------------------------------------------------- HUD + data layer
const tapeEl = $('#tape');
function tape(e) {
  const li = document.createElement('li');
  const time = new Date(e.t).toISOString().slice(11, 19);
  if (e.type === 'liq') { li.className = e.side === 'long' ? 'ev bear' : 'ev bull'; li.innerHTML = `<span class="tm">${time}</span><b>${e.side === 'long' ? 'Long' : 'Short'} liquidated</b> <span class="amt">${fmtUsd(e.usd)}</span> <span class="dim">@ ${fmtPx(e.px)} · ${esc(e.venue)}</span>`; }
  else { li.className = e.side === 'buy' ? 'ev bull' : 'ev bear'; li.innerHTML = `<span class="tm">${time}</span><b>Large ${e.side === 'buy' ? 'buy' : 'sell'}</b> <span class="amt">${fmtUsd(e.usd)}</span> <span class="dim">@ ${fmtPx(e.px)} · ${esc(e.venue)}</span>`; }
  tapeEl.prepend(li);
  while (tapeEl.children.length > 60) tapeEl.lastChild.remove();
}
// Market feed: one plain-language, past-tense line per meaningful model event, with its fidelity badge.
const TIER_NAME = ['', 'infantry fall', 'cavalry ride in', 'siege strike', 'trebuchet volley'];
function feedEvent(e) {
  const px = (p) => '$' + Math.round(p).toLocaleString('en-US');
  let text = null, cls = '';
  switch (e.kind) {
    case 'charge': text = `<b>${fmtUsd(e.usd)} market ${e.side === 'bull' ? 'buy' : 'sell'}</b> in 1 s · ${esc(e.venues.join(', ') || 'recorded flow')} — ${e.side === 'bull' ? 'bull' : 'bear'} cavalry charge`; cls = e.side; break;
    case 'liq': if (!e.tier) return; text = `<b>${fmtUsd(e.usd)} ${e.liqSide} liquidation${e.count > 1 ? `s (${e.count})` : ''}</b> · ${esc(e.venues.join(', '))} · ${px(e.px)} — forced ${e.liqSide === 'long' ? 'selling' : 'buying'}; ${e.side === 'bull' ? 'bull' : 'bear'} ${TIER_NAME[e.tier]}`; cls = e.side === 'bull' ? 'bear' : 'bull'; break;
    case 'wall-hit': text = `<b>${fmtUsd(e.usd)} ${e.side === 'bull' ? 'buy' : 'sell'} wall</b> at ${px(e.price)} broken by trades`; cls = e.side === 'bull' ? 'bear' : 'bull'; break;
    case 'wall-pulled': text = `<b>${fmtUsd(e.usd)} ${e.side === 'bull' ? 'buy' : 'sell'} wall</b> at ${px(e.price)} withdrawn (cancelled, not filled)`; break;
    case 'rout': text = `<b>${e.side === 'bull' ? 'Bull' : 'Bear'} lines break</b> — ${e.side === 'bull' ? 'bids' : 'asks'} within 1% fell ${Math.round(e.drop * 100)}% in a minute`; cls = e.side === 'bull' ? 'bear' : 'bull'; break;
    case 'rally': text = `<b>${e.side === 'bull' ? 'Bull' : 'Bear'} lines re-form</b> — depth within 1% recovered`; cls = e.side; break;
    case 'range-won': text = `<b>${e.side === 'bull' ? 'Bulls' : 'Bears'} take ${px(e.marker)}</b> — price held ${e.side === 'bull' ? 'above' : 'below'} it for ${Math.round(e.holdMs / 1000)} s`; cls = e.side; announce(`${e.side === 'bull' ? 'Bulls' : 'Bears'} take ${px(e.marker)}`, `Price held ${e.side === 'bull' ? 'above' : 'below'} it for ${Math.round(e.holdMs / 1000)} s · a recap, not a forecast`); break;
    default: return;
  }
  if (e.kind === 'liq' && e.tier >= 3) announce(`${fmtUsd(e.usd)} ${e.liqSide} liquidation`, `${e.venues.join(', ')} · ${px(e.px)} · forced ${e.liqSide === 'long' ? 'selling' : 'buying'} (sampled feed)`);
  const li = document.createElement('li');
  li.className = 'ev ' + cls;
  li.innerHTML = `<span class="tm">${new Date(e.t).toISOString().slice(11, 19)}</span>${text} <span class="bdg ${e.badge === 'Sampled' ? 'smp' : 'obs'}">${e.badge}</span>`;
  const fe = $('#feed'); if (fe) { fe.prepend(li); while (fe.children.length > 7) fe.lastChild.remove(); }
  if (e.kind !== 'liq' && e.kind !== 'charge') { tapeEl.prepend(li.cloneNode(true)); while (tapeEl.children.length > 60) tapeEl.lastChild.remove(); }
}
let annT = 0;
function announce(title, sub) {
  const a = $('#announce'); if (!a) return;
  a.querySelector('b').textContent = title; a.querySelector('span').textContent = sub;
  a.hidden = false; clearTimeout(annT); annT = setTimeout(() => { a.hidden = true; }, 3400);
}
let noteT = 0;
function note(t) { const n = $('#note'); n.textContent = t; n.hidden = !t; clearTimeout(noteT); if (t) noteT = setTimeout(() => { n.hidden = true; }, 9000); }
function renderMode() {
  const b = $('#mode');
  const rec = S.replay?.data?.recordedAt;
  b.className = 'mode ' + S.mode;
  b.textContent = S.mode === 'live' ? 'LIVE' : S.mode === 'replay' ? 'REPLAY' : S.mode === 'none' ? 'NO DATA' : 'CONNECTING';
  $('#mode-sub').textContent = S.mode === 'replay' && rec ? `Recorded ${new Date(rec).toUTCString().slice(5, 22)} UTC · real exchange data · all venues · ${S.speed}×` : S.mode === 'live' ? `Streaming from exchange WebSockets${S.sourceNote ? ' · ' + S.sourceNote : ''}` : '';
  $('#source').disabled = S.mode === 'replay';
  $('#btn-live').setAttribute('aria-pressed', String(S.mode === 'live' || (S.mode === 'connecting' && !!live)));
  $('#btn-replay').setAttribute('aria-pressed', String(S.mode === 'replay'));
  document.querySelectorAll('[data-speed]').forEach((x) => { x.hidden = S.mode !== 'replay'; x.setAttribute('aria-pressed', String(+x.dataset.speed === S.speed)); });
}
function renderVenues() {
  $('#venues').innerHTML = Object.entries(S.venues).map(([v, s]) => `<span class="vd ${esc(s.state)}" title="${esc(s.note || s.state)}"><i></i>${esc(v)}</span>`).join('');
}
function tile(id, value, sub, src) {
  const el = document.getElementById(id); if (!el) return;
  el.querySelector('.v').textContent = value;
  el.querySelector('.s').textContent = sub;
  el.querySelector('.src').textContent = src;
}
function renderData() {
  prune();
  const m = metrics();
  const live = S.mode === 'live';
  const feedAge = S.lastBookAt ? (Date.now() - S.lastBookAt) / 1000 : null;
  if (live && feedAge > 15) note('Order-book feed has stalled for ' + Math.round(feedAge) + 's — values may be stale.'); else if (live) note('');
  const v = S.book?.venues?.length || 0;
  const srcBook = S.mode === 'replay' ? `Recorded order books · ${v} venues` : `Live order books · ${(S.book?.venues || []).join(', ') || '—'}`;
  // hero HUD
  $('#hud-price').textContent = S.mid ? '$' + fmtPx(S.mid) : '—';
  const ch = $('#hud-ch'); ch.textContent = fmtPct(m.ch24); ch.className = m.ch24 > 0 ? 'up' : m.ch24 < 0 ? 'down' : '';
  $('#brk-sell').textContent = m.brkSell ? `${fmtPx(m.brkSell)} (${fmtPct(m.brkSellPct)})` : 'beyond view';
  $('#brk-buy').textContent = m.brkBuy ? `${fmtPx(m.brkBuy)} (${fmtPct(m.brkBuyPct)})` : 'beyond view';
  $('#brk-size').textContent = fmtUsd(BRK_USD, 0);
  if (m.brkSellPct !== null && m.brkSellPct !== undefined && m.brkBuyPct !== null && m.brkBuyPct !== undefined) {
    const ds = Math.abs(m.brkSellPct), db = Math.abs(m.brkBuyPct), bal = (db - ds) / (db + ds || 1); // >0: asks deeper → bears defending better
    $('#brk-mark').style.left = `${50 + bal * 45}%`;
    $('#brk-mid').textContent = Math.abs(bal) < 0.12 ? 'Balanced depth' : bal > 0 ? 'Asks deeper · bears defend' : 'Bids deeper · bulls defend';
  }
  $('#bidliq').textContent = fmtUsd(m.bid1); $('#askliq').textContent = fmtUsd(m.ask1);
  $('#mstate').textContent = m.state || '—';
  $('#feed-mode').textContent = S.mode === 'replay' ? '· replay' : S.mode === 'live' ? '· live' : '';
  // OBSERVED
  tile('t-price', S.mid ? '$' + fmtPx(S.mid) : '—', `Median of venue mid-prices`, srcBook);
  tile('t-ch', fmtPct(m.ch24), m.ch24Venue ? `${m.ch24Venue} 24h ticker` : 'Waiting for ticker', m.ch24Venue ? `${S.mode === 'replay' ? 'Recorded' : 'Live'} ticker` : '');
  tile('t-bwall', m.buyWall ? fmtUsd(m.buyWall[1]) : '—', m.buyWall ? `Largest $50 bid band within 1% · @ ${m.buyWall[0].toLocaleString('en-US')}` : '—', srcBook);
  tile('t-swall', m.sellWall ? fmtUsd(m.sellWall[1]) : '—', m.sellWall ? `Largest $50 ask band within 1% · @ ${m.sellWall[0].toLocaleString('en-US')}` : '—', srcBook);
  tile('t-imb', m.imb05 !== undefined ? fmtPct(m.imb05 * 100, 1) : '—', m.imb05 !== undefined ? `±0.5%: bids ${fmtUsd(m.bid05)} / asks ${fmtUsd(m.ask05)} · ±1%: ${fmtPct(m.imb1 * 100, 1)}` : '—', srcBook + ' · + = more bids');
  const liqVenues = ['OKX', 'Deribit', 'Binance futures'].filter((v) => ['live', 'recorded'].includes(S.venues[v]?.state)).map((v) => v.replace(' futures', '')).join(', ') || 'none connected';
  const sess = S.sessionStart ? `since ${new Date(S.sessionStart).toISOString().slice(11, 16)} UTC` : '';
  tile('t-lliq', fmtUsd(m.longLiq1h), `Last hour · ${fmtUsd(m.longLiqS)} ${sess} · longs forced to sell`, `Liquidation feeds: ${liqVenues} (not market-wide)`);
  tile('t-sliq', fmtUsd(m.shortLiq1h), `Last hour · ${fmtUsd(m.shortLiqS)} ${sess} · shorts forced to buy`, `Liquidation feeds: ${liqVenues} (not market-wide)`);
  tile('t-big', `${m.bigCount}`, `≥ ${fmtUsd(S.bigTrade)} in 15 min · buys ${fmtUsd(m.bigBuy)} / sells ${fmtUsd(m.bigSell)}${m.largest ? ` · largest ${fmtUsd(m.largest.usd)} ${m.largest.side}` : ''}`, 'Trades: Coinbase, Kraken, OKX, Binance spot + OKX perp');
  const fr = S.funding?.rate8h ?? S.server?.metrics?.derivs?.funding8h ?? null;
  tile('t-fund', fr !== null ? `${(fr * 100).toFixed(4)}%` : '—', fr !== null ? `per 8h · ${(fr * 3 * 365 * 100).toFixed(1)}% annualised` : '—', S.funding ? `OKX BTC-USDT perp · ${S.mode === 'replay' ? 'recorded' : 'live'} ${ago(S.funding.t)}` : S.server ? `OI-weighted, last server run ${String(S.server.dataThrough).slice(0, 16)} UTC` : '—');
  const agg = S.server?.metrics?.derivs;
  tile('t-oi', S.oi ? fmtUsd(S.oi.usd) : agg ? fmtUsd(agg.totalOi) : '—', `${S.oi ? 'OKX BTC-USDT perp (live)' : ''}${S.oi && agg ? ' · ' : ''}${agg ? `5 venues ${fmtUsd(agg.totalOi)} at last server run` : ''}`, S.oi ? `OKX open-interest channel · ${ago(S.oi.t)}` : agg ? `Server run ${String(S.server.dataThrough).slice(0, 16)} UTC` : '—');
  tile('t-vol', m.vol24 ? fmtUsd(m.vol24) : '—', `24h spot volume · ${m.volVenues.join(', ') || '—'} · last 60s ${fmtUsd(m.buy60 + m.sell60)}`, `${S.mode === 'replay' ? 'Recorded' : 'Live'} tickers (venue sum, not market-wide)`);
  // MODELED
  tile('m-press', `${m.pressure > 0 ? '+' : ''}${m.pressure}`, m.pressure > 20 ? 'Buyers applying pressure' : m.pressure < -20 ? 'Sellers applying pressure' : 'Balanced', '0.5×taker-flow imbalance (60s) + 0.3×book imbalance (±0.5%) + 0.2×liquidation imbalance (15m)');
  const bullU = (S.book?.bids || []).reduce((s, [, u]) => s + u, 0), bearU = (S.book?.asks || []).reduce((s, [, u]) => s + u, 0);
  tile('m-army', bullU + bearU ? `${Math.round((bullU / (bullU + bearU)) * 100)} : ${Math.round((bearU / (bullU + bearU)) * 100)}` : '—', `Bull vs bear liquidity within ±2% (${fmtUsd(bullU)} / ${fmtUsd(bearU)})`, 'Unit counts ∝ displayed book liquidity per price band; champions = $50 bands ≥ 4× the median band and ≥ $2M');
  const lv = S.server?.map?.levels || [];
  const below = lv.filter((l) => S.mid && l.level < S.mid && (l.tags || []).some((t) => /long-liquidation/.test(t))).sort((a, b) => b.level - a.level)[0];
  const above = lv.filter((l) => S.mid && l.level > S.mid && (l.tags || []).some((t) => /short-squeeze/.test(t))).sort((a, b) => a.level - b.level)[0];
  tile('m-zones', `${below ? Math.round(below.level / 1000) + 'K' : '—'} / ${above ? Math.round(above.level / 1000) + 'K' : '—'}`, `Nearest modelled long-liq zone below / short-squeeze zone above${below ? ` · ≈${fmtUsd(below.liqLong)} longs` : ''}${above ? ` · ≈${fmtUsd(above.liqShort)} shorts` : ''}`, S.server ? `Model estimate from OI build-up, server run ${String(S.server.dataThrough).slice(0, 16)} UTC` : 'Server analysis unavailable');
  tile('m-mom', fmtPct(m.mom5, 3), m.mom5 === null ? 'Needs 5 minutes of data' : m.mom5 > 0 ? 'Bulls advancing over the last 5 minutes' : m.mom5 < 0 ? 'Bears advancing over the last 5 minutes' : 'Front line holding', 'Mid-price change over 5 minutes');
}

// ---------------------------------------------------------------- controls
document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { S.rangePct = +b.dataset.range; document.querySelectorAll('[data-range]').forEach((x) => x.setAttribute('aria-pressed', String(+x.dataset.range === S.rangePct))); }));
document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => { S.speed = +b.dataset.speed; renderMode(); }));
$('#big').addEventListener('change', (e) => { S.bigTrade = +e.target.value; battle.big = S.bigTrade; });
$('#source').addEventListener('change', (e) => { S.source = e.target.value; battle.reset(); });
$('#gore').value = S.gore;
$('#gore').addEventListener('change', (e) => { S.gore = e.target.value; try { localStorage.setItem('bf-gore', S.gore); } catch {} });
$('#btn-xray').addEventListener('click', () => toggleXray());
function toggleXray() { S.xray = !S.xray; $('#btn-xray').setAttribute('aria-pressed', String(S.xray)); }
$('#cam-mode').addEventListener('change', (e) => s3?.setMode(e.target.value));
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
window.addEventListener('keydown', (e) => { if (/^(input|select|textarea)$/i.test(e.target.tagName)) return; if (e.key === 'x' || e.key === 'X') toggleXray(); });
// 3D on desktops with WebGL2; the 2.5D canvas stays as the mobile and fallback view.
async function setView(v) {
  if (v === '3d' && !s3) {
    try {
      const { createScene3D } = await import('./scene3d.js');
      s3 = createScene3D({ host: $('#stage'), overlay: cv, get: () => ({ mid: S.mid, cam: S.cam, rangePct: S.rangePct, bands: battle.bands, priceAtAge, now: clock(), gore: S.gore, xray: S.xray, reduced }), onFocus: (m) => { $('#cam-mode').value = m; } });
    } catch (err) { console.warn('3D unavailable', err); s3 = null; }
    if (!s3) { note('3D view needs WebGL2, which this browser does not provide — showing the 2.5D battlefield.'); v = '2d'; }
    else s3.layout();
  }
  S.view = v;
  s3?.show(v === '3d');
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  $('#cam-mode').disabled = v !== '3d';
  $('#stage').classList.toggle('is3d', v === '3d');
}
const want3d = (() => { const q = new URLSearchParams(location.search).get('view'); if (q) return q === '3d'; return innerWidth >= 900 && !matchMedia('(pointer: coarse)').matches; })();
$('#btn-live').addEventListener('click', () => { note(''); startLive(); });
$('#btn-replay').addEventListener('click', () => { note(''); startReplay(); });
$('#btn-pause').addEventListener('click', (e) => { S.paused = !S.paused; e.currentTarget.setAttribute('aria-pressed', String(S.paused)); e.currentTarget.textContent = S.paused ? 'Resume' : 'Pause'; });
$('#v-full').addEventListener('click', () => { const st = $('#stage'); (document.fullscreenElement ? document.exitFullscreen() : st.requestFullscreen?.())?.catch?.(() => {}); });
$('#v-reset').addEventListener('click', () => { resetView(); s3?.reset(); });
$('#v-orbit').addEventListener('click', () => { CAM.auto = !CAM.auto; syncOrbit(); });

// ---------------------------------------------------------------- boot
(async () => {
  for (const u of ['../data/latest.json', 'data/latest.json']) { try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) { S.server = await r.json(); break; } } catch {} }
})();
resize();
measureHud();
requestAnimationFrame(frame);
setView(want3d ? '3d' : '2d');
// test hook for automated checks only (?debug); injected events go through the same model path
if (new URLSearchParams(location.search).has('debug')) window.__bf = { S, battle, inject: (e) => onEvent({ t: clock(), ...e }), get s3() { return s3; } };
setInterval(renderData, 500);
if (window.BMI_PREVIEW || new URLSearchParams(location.search).has('replay')) { if (window.BMI_PREVIEW) note('Preview: this page cannot open live exchange connections, so it replays real data recorded from the exchanges. On the site it streams live.'); startReplay(); }
else startLive();
