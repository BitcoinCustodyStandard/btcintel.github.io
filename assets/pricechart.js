// Price chart: price, 50/100/200-day simple moving averages and a ±2σ volatility
// envelope (20-day mean ± 2 standard deviations of daily closes), inline SVG.
//
// Daily views (1M … All) use completed daily closes from data/pi_cycle.json (Coin Metrics);
// averages and bands are computed here from the full history so they are valid at the
// left edge of any range. Intraday views (1H, 1D, 7D) use Coinbase BTC-USD candles
// (Binance BTC-USDT as fallback); on those views today's daily averages and bands are
// drawn as flat reference levels, because they are defined on daily closes.
import { computeDaily, envelopePosition } from '../engine/envelope.js';
import { timeoutSignal } from './network.js?v=20261003p';

export const RANGES = [['1H', 'h1'], ['1D', 'd1'], ['7D', 'd7'], ['1M', 30], ['3M', 91], ['6M', 182], ['YTD', 'ytd'], ['1Y', 365], ['2Y', 730], ['5Y', 1826], ['All', 0]];
const INTRA = {
  h1: { cb: 60, bn: '1m', n: 60, label: '1-minute' },
  d1: { cb: 300, bn: '5m', n: 288, label: '5-minute' },
  d7: { cb: 3600, bn: '1h', n: 168, label: '1-hour' },
};
export const pcState = { range: 365, log: null, ov: { sma50: true, sma100: true, sma200: true, env: true, pi: false }, vol: null, volSource: '' };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v >= 1000 ? '$' + Math.round(v).toLocaleString('en-US') : v >= 1 ? '$' + v.toFixed(2) : '$' + v.toPrecision(3));
const usdK = (v) => (v >= 1e9 ? `$${+(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${+(v / 1e6).toFixed(1)}M` : v >= 1000 ? `$${+(v / 1000).toFixed(v >= 1e4 ? 0 : 1)}K` : v >= 1 ? `$${+v.toFixed(0)}` : `$${+v.toPrecision(2)}`);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dLabel = (d) => `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}, ${d.slice(0, 4)}`;
const tFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dtFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const isIntra = (r) => typeof r === 'string' && r in INTRA;
const pctAway = (a, b) => ((a / b - 1) * 100);

// ---------- data ----------
let dailyCache = { key: null, rows: null };
export function daily(pi) {
  if (!pi?.rows?.length) return null;
  const key = pi.rows.length + pi.rows.at(-1)[0];
  if (dailyCache.key !== key) dailyCache = { key, rows: computeDaily(pi.rows.map((r) => [r[0], r[1]])) };
  return dailyCache.rows;
}
export function envelopeNow(pi, price) {
  const rows = daily(pi); if (!rows) return null;
  const last = rows.at(-1), pos = envelopePosition(price ?? last[1], last);
  return pos && { ...pos, date: last[0], sma50: last[2], sma100: last[3], sma200: last[4], price: price ?? last[1] };
}
const intraCache = {};
async function intraday(key) {
  const c = intraCache[key];
  if (c && Date.now() - c.at < 60e3) return c;
  const I = INTRA[key];
  const tryFetch = async (url, parse, source) => { const r = await fetch(url, { cache: 'no-store', signal: timeoutSignal(8000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return { rows: parse(await r.json()), source }; };
  let res;
  try {
    // Coinbase: [time, low, high, open, close, volume], newest first, max 300 per request
    res = await tryFetch(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${I.cb}`, (j) => j.slice(0, I.n).reverse().map((k) => [k[0] * 1000, +k[4], +k[5] * +k[4]]), 'Coinbase BTC-USD');
  } catch {
    try { res = await tryFetch(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=${I.bn}&limit=${I.n}`, (j) => j.map((k) => [k[0], +k[4], +k[7]]), 'Binance BTC-USDT (≈USD)'); }
    catch { res = null; }
  }
  if (res?.rows?.length) intraCache[key] = { ...res, at: Date.now() };
  return intraCache[key] || null;
}

// ---------- card ----------
export function priceCardHtml(info) {
  const ov = pcState.ov, chk = (k, label, cls, key) => `<label class="pc-ov ${cls}"><input type="checkbox" data-pcov="${k}"${ov[k] ? ' checked' : ''}><i></i>${label}${key ? info(key) : ''}</label>`;
  return `<section class="picard pcard" id="price-chart" aria-label="Bitcoin price, moving averages and volatility envelope">
    <div class="pi-head">
      <h2>Price, averages &amp; envelope${info('d_chart')}</h2>
      <div class="pc-tools" role="group" aria-label="Chart timeframe">${RANGES.map(([l, v]) => `<button type="button" data-pcrange="${v}" aria-pressed="${pcState.range === v}">${l}</button>`).join('')}<button type="button" id="pc-log" aria-pressed="false" title="Logarithmic price scale">Log</button></div>
    </div>
    <div class="pc-ovs" role="group" aria-label="Chart overlays">${chk('sma50', '50-day avg', 'o50', 'd_sma')}${chk('sma100', '100-day avg', 'o100')}${chk('sma200', '200-day avg', 'o200')}${chk('env', '±2σ envelope (20-day)', 'oenv', 'd_envelope')}${chk('pi', 'Pi Cycle Top', 'opi', 'picycle')}</div>
    <div class="pi-chart" id="pc-chart"></div>
    <p class="pc-status" id="pc-status"></p>
    <p class="pi-src" id="pc-src"></p>
  </section>`;
}

// ---------- drawing ----------
export async function drawPriceChart(host, pi, live) {
  if (!host) return;
  const R = pcState.range, intra = isIntra(R), D = daily(pi);
  let pts, src, volMap = null;
  if (intra) {
    if (!host.dataset.loaded) host.innerHTML = '<p class="pc-empty">Loading intraday prices…</p>';
    const res = await intraday(R);
    if (pcState.range !== R) return; // the user switched range while loading
    if (!res) { host.innerHTML = '<p class="pc-empty">Intraday prices could not be loaded from Coinbase or Binance right now. Daily views are unaffected.</p>'; paintStatus(pi, live, null); return; }
    pts = res.rows.map((r) => ({ t: r[0], p: r[1], v: r[2] }));
    src = `${INTRA[R].label} candles: ${res.source} · fetched ${tFmt.format(res.at)} · averages and bands shown as today’s daily levels`;
  } else {
    if (!D) { host.innerHTML = '<p class="pc-empty">No price history yet.</p>'; return; }
    let rows = D;
    const endT = Date.parse(D.at(-1)[0]);
    if (R === 'ytd') { const y = D.at(-1)[0].slice(0, 4); rows = D.filter((r) => r[0] >= `${y}-01-01`); }
    else if (R) { const cut = new Date(endT - R * 864e5).toISOString().slice(0, 10); rows = D.filter((r) => r[0] >= cut); }
    const W0 = Math.max(280, Math.round(host.clientWidth || 600)), step = Math.max(1, Math.floor(rows.length / W0));
    rows = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
    const showVol = pcState.vol && (R === 'ytd' || (R && R <= 365));
    if (showVol) volMap = new Map(pcState.vol);
    pts = rows.map((r) => ({ t: Date.parse(r[0] + 'T00:00:00Z'), d: r[0], p: r[1], s50: r[2], s100: r[3], s200: r[4], mid: r[5], up: r[6], lo: r[7], v: volMap?.get(r[0]) ?? null }));
    if (pcState.ov.pi && pi?.rows) { const m = new Map(pi.rows.map((r) => [r[0], r])); for (const q of pts) { const r = m.get(q.d); q.p111 = r?.[2] ?? null; q.p350 = r?.[3] ?? null; } }
    src = `Daily closes: ${esc(pi.source || 'Coin Metrics')} · through ${dLabel(pi.asOf || D.at(-1)[0])} · averages and envelope computed by BTC Intel${showVol ? ` · volume: ${esc(pcState.volSource)}` : ''}`;
  }
  host.dataset.loaded = '1';
  const last = D?.at(-1), ref = intra && last ? { s50: last[2], s100: last[3], s200: last[4], mid: last[5], up: last[6], lo: last[7] } : null;
  const W = Math.max(280, Math.round(host.clientWidth || 600)), mobile = (window.innerWidth || W) < 768;
  // the chart is the page's centrepiece: 55% of the window height, capped by its own width
  // (keeps a wide, not tall, shape) and to 320–720px; phones keep a compact 240px
  const H = mobile ? 240 : Math.round(Math.max(320, Math.min(720, (window.innerHeight || 800) * 0.55, W * 0.45))), PAD = { l: mobile ? 52 : 64, r: mobile ? 10 : 16, t: 12, b: 26 };
  const ov = pcState.ov;
  const x0 = pts[0].t, x1 = pts.at(-1).t + (live && !intra ? (pts.at(-1).t - x0) / 60 : 0);
  // y range: price always; overlays only within ±60% of the price range so flat references don't squash the line
  const ps = pts.map((q) => q.p).concat(live?.price ? [live.price] : []);
  let lo = Math.min(...ps), hi = Math.max(...ps);
  const keys = [ov.sma50 && 's50', ov.sma100 && 's100', ov.sma200 && 's200', ov.env && 'up', ov.env && 'lo', ov.pi && 'p111', ov.pi && 'p350'].filter(Boolean);
  if (!intra) { for (const q of pts) for (const k of keys) if (q[k] > 0) { lo = Math.min(lo, q[k]); hi = Math.max(hi, q[k]); } }
  else if (ref) { const span = hi - lo || hi * 0.01; for (const k of keys) if (ref[k] > lo - span * 0.6 && ref[k] < hi + span * 0.6) { lo = Math.min(lo, ref[k]); hi = Math.max(hi, ref[k]); } }
  const autoLog = !intra && (R === 0 || R >= 730), LOG = pcState.log ?? autoLog;
  document.getElementById('pc-log')?.setAttribute('aria-pressed', String(LOG));
  if (LOG) { lo /= 1.06; hi *= 1.06; } else { const pad = (hi - lo) * 0.06 || hi * 0.005; lo -= pad; hi += pad; }
  const fy = LOG ? Math.log10 : (v) => v;
  const X = (t) => PAD.l + ((t - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r);
  const Y = (v) => PAD.t + (1 - (fy(v) - fy(lo)) / (fy(hi) - fy(lo))) * (H - PAD.t - PAD.b);
  const base = H - PAD.b;
  // y ticks
  let ticks = [];
  if (LOG) {
    const cands = (ms) => { const o = []; for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const m of ms) { const v = m * 10 ** e; if (v >= lo && v <= hi) o.push(v); } return o; };
    for (const ms of [[1], [1, 3], [1, 2, 5], [1, 1.5, 2, 3, 5, 7], [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8]]) { ticks = cands(ms); if (ticks.length >= 4) break; }
    if (ticks.length > 8) { const k = Math.ceil(ticks.length / 8); ticks = ticks.filter((_, i) => i % k === 0); }
  } else { const s0 = (hi - lo) / 5, mag = 10 ** Math.floor(Math.log10(s0)), st = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= s0); for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) ticks.push(v); }
  // labels precise enough to tell neighbouring ticks apart (tight intraday ranges need full dollars)
  const tstep = ticks.length > 1 ? Math.min(...ticks.slice(1).map((v, i) => v - ticks[i])) : hi;
  const tl = (v) => (tstep < 1000 && v >= 1000 ? '$' + Math.round(v).toLocaleString('en-US') : tstep < 10000 && v >= 10000 ? `$${(v / 1000).toFixed(1)}K` : usdK(v));
  const grid = ticks.map((v) => `<line class="g" x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${PAD.l - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${tl(v)}</text>`).join('');
  // x labels
  const span = x1 - x0, xl = [];
  if (intra) { const stepMs = R === 'h1' ? 10 * 60e3 : R === 'd1' ? 3 * 3600e3 : 864e5; for (let t = Math.ceil(x0 / stepMs) * stepMs; t <= pts.at(-1).t; t += stepMs) xl.push([t, R === 'd7' ? `${MON[new Date(t).getMonth()]} ${new Date(t).getDate()}` : tFmt.format(t)]); }
  else if (span > 900 * 864e5) { for (let y = new Date(x0).getUTCFullYear() + 1; y <= new Date(pts.at(-1).t).getUTCFullYear(); y++) xl.push([Date.UTC(y, 0, 1), String(y)]); }
  else { const every = span > 400 * 864e5 ? 3 : span > 200 * 864e5 ? 2 : 1, d = new Date(x0); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); if (span < 45 * 864e5) { for (let t = Math.ceil(x0 / (7 * 864e5)) * 7 * 864e5; t <= pts.at(-1).t; t += 7 * 864e5) xl.push([t, `${MON[new Date(t).getUTCMonth()]} ${new Date(t).getUTCDate()}`]); } else while (d.getTime() < pts.at(-1).t) { if (d.getUTCMonth() % every === 0) xl.push([d.getTime(), `${MON[d.getUTCMonth()]}${d.getUTCMonth() === 0 ? ' ' + d.getUTCFullYear() : ''}`]); d.setUTCMonth(d.getUTCMonth() + 1); } }
  const maxL = mobile ? 5 : 10; while (xl.length > maxL) for (let i = xl.length - 2; i > 0; i -= 2) xl.splice(i, 1);
  const xlab = xl.map(([t, l]) => `<text class="ax" x="${X(t).toFixed(1)}" y="${H - 8}" text-anchor="middle">${l}</text>`).join('');
  // series
  const line = (k, cls) => { let s = '', on = false; for (const q of pts) { const v = q[k]; if (!(v > 0)) { on = false; continue; } s += `${on ? 'L' : 'M'}${X(q.t).toFixed(1)},${Y(v).toFixed(1)}`; on = true; } return s ? `<path class="${cls}" d="${s}"/>` : ''; };
  let env = '', ovl = '', refs = '';
  if (!intra) {
    if (ov.env) { const e = pts.filter((q) => q.up > 0); if (e.length > 1) env = `<polygon class="envf" points="${e.map((q) => `${X(q.t).toFixed(1)},${Y(q.up).toFixed(1)}`).join(' ')} ${e.slice().reverse().map((q) => `${X(q.t).toFixed(1)},${Y(q.lo).toFixed(1)}`).join(' ')}"/>${line('up', 'envl')}${line('lo', 'envl')}${line('mid', 'envm')}`; }
    ovl = (ov.pi ? line('p111', 'm111') + line('p350', 'm350') : '') + (ov.sma200 ? line('s200', 's200') : '') + (ov.sma100 ? line('s100', 's100') : '') + (ov.sma50 ? line('s50', 's50') : '');
  } else if (ref) {
    const items = [ov.env && ['up', 'envl', 'upper band'], ov.env && ['mid', 'envm', '20-day avg'], ov.env && ['lo', 'envl', 'lower band'], ov.sma50 && ['s50', 's50', '50-day'], ov.sma100 && ['s100', 's100', '100-day'], ov.sma200 && ['s200', 's200', '200-day']].filter(Boolean);
    const off = [];
    for (const [k, cls, lab] of items) { const v = ref[k]; if (!(v > 0)) continue; if (v < lo || v > hi) { off.push(`${lab} ${usdK(v)} ${v > hi ? '↑' : '↓'}`); continue; } const y = Y(v).toFixed(1); refs += `<line class="${cls} refl" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}"/><text class="refx" x="${W - PAD.r - 2}" y="${(+y - 3).toFixed(1)}" text-anchor="end">${lab} ${usdK(v)}</text>`; }
    if (off.length) refs += `<text class="refx" x="${PAD.l + 4}" y="${PAD.t + 10}">Outside view: ${esc(off.join(' · '))}</text>`;
  }
  // volume
  let vbars = '';
  const vs = pts.map((q) => q.v).filter((v) => v > 0);
  if (vs.length > 2) { const vmax = Math.max(...vs), band = (H - PAD.t - PAD.b) * 0.18, bw = Math.max(1, ((W - PAD.l - PAD.r) / pts.length) * 0.7); vbars = pts.map((q) => (q.v > 0 ? `<rect x="${(X(q.t) - bw / 2).toFixed(1)}" y="${(base - (q.v / vmax) * band).toFixed(1)}" width="${bw.toFixed(1)}" height="${((q.v / vmax) * band).toFixed(1)}"/>` : '')).join(''); }
  // live marker
  let liveMark = '';
  if (live?.price && !intra) { const lx = W - PAD.r - 3, ly = Y(live.price); liveMark = `<line class="livelink" x1="${X(pts.at(-1).t).toFixed(1)}" y1="${Y(pts.at(-1).p).toFixed(1)}" x2="${lx}" y2="${ly.toFixed(1)}"/><circle class="livedot" cx="${lx}" cy="${ly.toFixed(1)}" r="4"/>`; }
  else if (intra) { const q = pts.at(-1); liveMark = `<circle class="livedot" cx="${X(q.t).toFixed(1)}" cy="${Y(q.p).toFixed(1)}" r="3.5"/>`; }
  const data = esc(JSON.stringify(pts.map((q) => [+X(q.t).toFixed(1), q.t, q.p, q.s50 ?? null, q.s100 ?? null, q.s200 ?? null, q.up ?? null, q.mid ?? null, q.lo ?? null, q.v ?? null])));
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Bitcoin price with moving averages and volatility envelope" data-pts="${data}" data-intra="${intra ? 1 : 0}">
    ${grid}${xlab}<g class="vol">${vbars}</g>${env}${ovl}${refs}
    <path class="pline" d="${pts.map((q, i) => `${i ? 'L' : 'M'}${X(q.t).toFixed(1)},${Y(q.p).toFixed(1)}`).join('')}"/>
    ${liveMark}<line class="xh" y1="${PAD.t}" y2="${base}" style="display:none"/>
  </svg><div class="pi-tip" hidden></div>`;
  wireHover(host, W);
  const s = document.getElementById('pc-src'); if (s) s.innerHTML = `${src}. The envelope is the 20-day average ± 2 standard deviations of daily closes: a measure of recent volatility, not a prediction.`;
  paintStatus(pi, live, intra ? pts.at(-1).p : null);
}

function wireHover(host, W) {
  const svg = host.querySelector('svg'), tip = host.querySelector('.pi-tip'), xh = svg.querySelector('.xh');
  const P = JSON.parse(svg.dataset.pts), intra = svg.dataset.intra === '1';
  const show = (clientX) => {
    const r = svg.getBoundingClientRect(), x = ((clientX - r.left) / r.width) * W;
    let b = P[0]; for (const p of P) if (Math.abs(p[0] - x) < Math.abs(b[0] - x)) b = p;
    const [px, t, p, s50, s100, s200, up, mid, lo, v] = b;
    xh.setAttribute('x1', px); xh.setAttribute('x2', px); xh.style.display = '';
    const row = (cls, k, val) => (val ? `<span class="${cls}">${k} <em>${usd(val)}</em></span>` : '');
    tip.innerHTML = `<b>${intra ? dtFmt.format(t) : dLabel(new Date(t).toISOString().slice(0, 10))}</b><span>Price <em>${usd(p)}</em></span>${row('a50', '50-day avg', s50)}${row('a100', '100-day avg', s100)}${row('a200', '200-day avg', s200)}${up ? `<span class="ae">Envelope <em>${usdK(lo)} – ${usdK(up)}</em></span>` : ''}${v ? `<span class="v">Volume <em>${usdK(v)}</em></span>` : ''}`;
    tip.hidden = false;
    const hx = (px / W) * r.width, tw = tip.offsetWidth;
    tip.style.left = Math.max(4, Math.min(hx + 12, r.width - tw - 4)) + 'px'; tip.style.top = '8px';
  };
  const hide = () => { tip.hidden = true; xh.style.display = 'none'; };
  svg.addEventListener('pointermove', (e) => show(e.clientX));
  svg.addEventListener('pointerdown', (e) => show(e.clientX));
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
}

// plain-language position of the current price vs the envelope and averages
function paintStatus(pi, live, intraPrice) {
  const el = document.getElementById('pc-status'); if (!el) return;
  const price = live?.price ?? intraPrice ?? null, E = envelopeNow(pi, price);
  if (!E) { el.textContent = ''; return; }
  const away = (v) => `${pctAway(v, E.price) > 0 ? '+' : ''}${pctAway(v, E.price).toFixed(1)}%`;
  const vsMa = [[50, E.sma50], [100, E.sma100], [200, E.sma200]].filter(([, v]) => v > 0).map(([n, v]) => `${E.price >= v ? 'above' : 'below'} the ${n}-day (${usdK(v)})`);
  el.innerHTML = `<b class="pz ${E.key}">Price ${usd(E.price)} is ${esc(E.label)}</b> — 20-day average ${usdK(E.mid)}, upper band ${usdK(E.up)} (${away(E.up)}), lower band ${usdK(E.lo)} (${away(E.lo)}); the envelope is ${E.widthPct.toFixed(1)}% of price wide. Price is ${vsMa.join(', ')}. <span class="dim">Bands use daily closes through ${dLabel(E.date)}.</span>${pcState.ov.pi && pi?.latest ? ` <span class="dim">Pi Cycle: 111DMA ${usdK(pi.latest.ma111)} vs 350DMA×2 ${usdK(pi.latest.ma350x2)} (${(pi.latest.gap * 100).toFixed(1)}% gap).</span>` : ''}`;
}

export function wirePriceChart(getPi, getLive) {
  const redraw = () => drawPriceChart(document.getElementById('pc-chart'), getPi(), getLive());
  document.querySelectorAll('[data-pcrange]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.pcrange; pcState.range = /^\d+$/.test(v) ? +v : v;
    document.querySelectorAll('[data-pcrange]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    redraw();
  }));
  document.getElementById('pc-log')?.addEventListener('click', (e) => { const autoLog = !isIntra(pcState.range) && (pcState.range === 0 || pcState.range >= 730); pcState.log = !(pcState.log ?? autoLog); redraw(); });
  document.querySelectorAll('[data-pcov]').forEach((c) => c.addEventListener('change', () => { pcState.ov[c.dataset.pcov] = c.checked; redraw(); }));
  // intraday views refresh every minute while visible
  clearInterval(wirePriceChart.t);
  wirePriceChart.t = setInterval(() => { if (!document.hidden && isIntra(pcState.range)) redraw(); }, 60e3);
  return redraw;
}
