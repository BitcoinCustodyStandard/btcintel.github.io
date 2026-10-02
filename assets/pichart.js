// Price & Pi Cycle Top chart (inline SVG, no library).
// Data: data/pi_cycle.json rows [date, close, 111DMA, 350DMA×2] computed by the agent
// from Coin Metrics daily closes. The live price is drawn only as a marker at the right
// edge; the averages are defined on completed daily closes.
import { piZone } from '../engine/picycle.js';

const RANGES = [['1M', 30], ['3M', 91], ['6M', 182], ['1Y', 365], ['All', 0]];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (v) => (v === null || v === undefined ? '—' : v >= 1000 ? '$' + Math.round(v).toLocaleString('en-US') : v >= 1 ? '$' + v.toFixed(2) : '$' + v.toPrecision(3));
const usdK = (v) => (v >= 1e9 ? `$${+(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${+(v / 1e6).toFixed(1)}M` : v >= 1000 ? `$${+(v / 1000).toFixed(v >= 1e4 ? 0 : 1)}K` : v >= 1 ? `$${+v.toFixed(0)}` : `$${+v.toPrecision(2)}`);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dLabel = (d) => `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}, ${d.slice(0, 4)}`;
const ZONE_FILL = { far: 'var(--pi-env)', approaching: 'var(--pi-env-warn)', close: 'var(--pi-env-hot)', crossed: 'var(--pi-env-hot)' };

// vol: optional [[date, usd]] daily spot volume, drawn as bars for ranges up to 1Y
export const piState = { range: 365, log: true, vol: null, volSource: '' };

export function piCardHtml(pi, infoBtn) {
  const L = pi?.latest, z = L ? piZone(L.gap) : null;
  const status = L
    ? `<b class="pz ${z.key}">${esc(z.label)}</b> · 111DMA ${usd(L.ma111)} is ${(Math.abs(L.gap) * 100).toFixed(1)}% ${L.gap > 0 ? 'below' : 'above'} 350DMA×2 ${usd(L.ma350x2)} <span class="dim">(as of ${esc(dLabel(L.date))} close)</span>`
    : 'Price history unavailable — it is built on the next server run.';
  return `<section class="picard" id="price-cycle" aria-label="Price and Pi Cycle Top">
    <div class="pi-head">
      <h2>Price &amp; Pi Cycle Top${infoBtn}</h2>
      <div class="pi-tools" role="group" aria-label="Chart range">
        ${RANGES.map(([l, d]) => `<button type="button" data-pirange="${d}" aria-pressed="${piState.range === d}">${l}</button>`).join('')}
        <button type="button" id="pi-log" aria-pressed="${piState.log}" title="Logarithmic price scale">Log</button>
      </div>
    </div>
    <div class="pi-chart" id="pi-chart"></div>
    <div class="pi-legend"><span><i class="lp"></i>Price (daily close)</span><span><i class="lf"></i>111DMA</span><span><i class="ls"></i>350DMA × 2</span><span><i class="le"></i>Envelope</span>${pi?.crosses?.length ? '<span><i class="lc"></i>Past crosses</span>' : ''}<span><i class="ll"></i>Live price</span><span class="pi-vleg"><i class="lv"></i>Daily volume (≤1Y)</span></div>
    <p class="pi-status">${status}</p>
    <p class="pi-src">Daily closes: ${esc(pi?.source || 'Coin Metrics')}${pi?.asOf ? ` · through ${esc(dLabel(pi.asOf))}` : ''} · averages computed by BTC Intel${piState.volSource ? ` · volume: ${esc(piState.volSource)}` : ''} · envelope shading: grey &gt; 20% gap, amber 5–20%, red &lt; 5% or crossed</p>
  </section>`;
}

export function drawPiChart(host, pi, live) {
  if (!host) return;
  if (!pi?.rows?.length) { host.innerHTML = '<p class="muted small" style="padding:40px 0;text-align:center">No price history yet.</p>'; return; }
  const W = Math.max(280, Math.round(host.clientWidth || 600)), mobile = W < 640;
  const H = mobile ? 220 : 320, PAD = { l: mobile ? 46 : 58, r: mobile ? 10 : 16, t: 12, b: 26 };
  let rows = pi.rows;
  if (piState.range) { const cut = new Date(Date.parse(rows.at(-1)[0]) - piState.range * 864e5).toISOString().slice(0, 10); rows = rows.filter((r) => r[0] >= cut); }
  // ~1 point per pixel keeps the path light; always keep the last point
  const step = Math.max(1, Math.floor(rows.length / (W - PAD.l - PAD.r)));
  const pts = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
  const t = (d) => Date.parse(d + 'T00:00:00Z');
  const x0 = t(pts[0][0]), x1 = t(pts.at(-1)[0]) + (live ? 864e5 * Math.max(1, (piState.range || 3000) / 120) : 0);
  const vals = [];
  for (const r of pts) for (const v of [r[1], r[2], r[3]]) if (v > 0) vals.push(v);
  if (live?.price) vals.push(live.price);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const LOG = piState.log;
  const fy = LOG ? Math.log10 : (v) => v;
  if (!LOG) { const pad = (hi - lo) * 0.06; lo = Math.max(0, lo - pad); hi += pad; } else { lo /= 1.12; hi *= 1.12; }
  const X = (d) => PAD.l + ((t(d) - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const Y = (v) => PAD.t + (1 - (fy(v) - fy(lo)) / (fy(hi) - fy(lo))) * (H - PAD.t - PAD.b);
  // ticks
  let ticks = [];
  if (LOG) {
    const cands = (ms) => { const o = []; for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const m of ms) { const v = m * 10 ** e; if (v >= lo && v <= hi) o.push(v); } return o; };
    for (const ms of [[1], [1, 3], [1, 2, 5], [1, 1.5, 2, 3, 5, 7], [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8]]) { ticks = cands(ms); if (ticks.length >= 4) break; }
    if (ticks.length > 8) { const k = Math.ceil(ticks.length / 8); ticks = ticks.filter((_, i) => i % k === 0); }
  }
  else { const span = hi - lo, s0 = span / 5, mag = 10 ** Math.floor(Math.log10(s0)), st = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= s0); for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) ticks.push(v); }
  const grid = ticks.map((v) => `<line class="g" x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${PAD.l - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${usdK(v)}</text>`).join('');
  // x labels: years for long ranges, months otherwise
  const spanDays = (x1 - x0) / 864e5, xl = [];
  if (spanDays > 900) { for (let y = +pts[0][0].slice(0, 4) + 1; y <= +pts.at(-1)[0].slice(0, 4); y++) xl.push([`${y}-01-01`, String(y)]); if (xl.length > (mobile ? 6 : 12)) { const k = Math.ceil(xl.length / (mobile ? 6 : 12)); for (let i = xl.length - 1; i >= 0; i--) if (i % k) xl.splice(i, 1); } }
  else { const every = spanDays > 400 ? 3 : spanDays > 200 ? 2 : 1; const d = new Date(x0); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); while (d.getTime() < t(pts.at(-1)[0])) { if (d.getUTCMonth() % every === 0) xl.push([d.toISOString().slice(0, 10), `${MON[d.getUTCMonth()]}${d.getUTCMonth() === 0 ? ' ' + d.getUTCFullYear() : ''}`]); d.setUTCMonth(d.getUTCMonth() + 1); } if (mobile && xl.length > 5) for (let i = xl.length - 1; i >= 0; i--) if (i % 2) xl.splice(i, 1); }
  const xlab = xl.map(([d, l]) => `<text class="ax" x="${X(d).toFixed(1)}" y="${H - 8}" text-anchor="middle">${l}</text>`).join('');
  // envelope: one polygon per run of the same zone, between the two averages
  const env = []; let run = null;
  const flush = () => { if (run && run.p.length > 1) env.push(`<polygon fill="${ZONE_FILL[run.z]}" points="${run.p.map(([x, y]) => `${x},${y}`).join(' ')} ${run.q.reverse().map(([x, y]) => `${x},${y}`).join(' ')}"/>`); };
  for (const r of pts) {
    if (!(r[2] > 0 && r[3] > 0)) { flush(); run = null; continue; }
    const z = piZone((r[3] - r[2]) / r[3]).key, x = X(r[0]).toFixed(1), a = [x, Y(r[2]).toFixed(1)], b = [x, Y(r[3]).toFixed(1)];
    if (!run || run.z !== z) { if (run) { run.p.push(a); run.q.push(b); } flush(); run = { z, p: [], q: [] }; }
    run.p.push(a); run.q.push(b);
  }
  flush();
  const line = (k) => { let s = '', on = false; for (const r of pts) { const v = r[k]; if (!(v > 0)) { on = false; continue; } s += `${on ? 'L' : 'M'}${X(r[0]).toFixed(1)},${Y(v).toFixed(1)}`; on = true; } return s; };
  const pricePath = line(1), base = H - PAD.b;
  const crosses = (pi.crosses || []).filter((c) => t(c.date) >= x0).map((c) => `<g class="cross"><circle cx="${X(c.date).toFixed(1)}" cy="${Y(c.ma111).toFixed(1)}" r="4.5"/><text x="${X(c.date).toFixed(1)}" y="${(Y(c.ma111) - 9).toFixed(1)}" text-anchor="middle">${esc(dLabel(c.date).replace(/^(\w+) \d+, /, '$1 '))}</text></g>`).join('');
  let liveMark = '';
  if (live?.price) {
    const lx = W - PAD.r - 4, ly = Y(live.price), lastX = X(pts.at(-1)[0]), lastY = Y(pts.at(-1)[1]);
    liveMark = `<line class="livelink" x1="${lastX.toFixed(1)}" y1="${lastY.toFixed(1)}" x2="${lx}" y2="${ly.toFixed(1)}"/><circle class="livedot" cx="${lx}" cy="${ly.toFixed(1)}" r="4"/>`;
  }
  // volume: bars in the bottom fifth of the plot, own scale (no axis; values in the tooltip)
  const volMap = piState.vol && piState.range && piState.range <= 365 ? new Map(piState.vol) : null;
  let vbars = '';
  if (volMap) {
    const vs = rows.map((r) => volMap.get(r[0])).filter((v) => v > 0), vmax = Math.max(...vs, 1), band = (H - PAD.t - PAD.b) * 0.2;
    const bw = Math.max(1, ((W - PAD.l - PAD.r) / rows.length) * 0.7);
    vbars = rows.map((r) => { const v = volMap.get(r[0]); if (!(v > 0)) return ''; const hh = (v / vmax) * band; return `<rect x="${(X(r[0]) - bw / 2).toFixed(1)}" y="${(base - hh).toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}"/>`; }).join('');
  }
  host.closest('.picard')?.classList.toggle('novol', !vbars);
  const data = esc(JSON.stringify(pts.map((r) => [+X(r[0]).toFixed(1), r[0], r[1], r[2], r[3], volMap?.get(r[0]) ?? null])));
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Bitcoin daily close with the 111-day average and twice the 350-day average" data-pts="${data}">
    ${grid}${xlab}<g class="vol">${vbars}</g><g class="env">${env.join('')}</g>
    <path class="pline" d="${pricePath}"/>
    <path class="m111" d="${line(2)}"/><path class="m350" d="${line(3)}"/>
    ${crosses}${liveMark}
    <line class="xh" y1="${PAD.t}" y2="${base}" style="display:none"/>
  </svg><div class="pi-tip" hidden></div>`;
  wireHover(host, W, Y);
}

function wireHover(host, W, Y) {
  const svg = host.querySelector('svg'), tip = host.querySelector('.pi-tip'), xh = svg.querySelector('.xh');
  const P = JSON.parse(svg.dataset.pts);
  const show = (clientX) => {
    const r = svg.getBoundingClientRect(), x = ((clientX - r.left) / r.width) * W;
    let best = P[0]; for (const p of P) if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
    const [px, d, c, a, b, v] = best;
    xh.setAttribute('x1', px); xh.setAttribute('x2', px); xh.style.display = '';
    const gap = a > 0 && b > 0 ? (b - a) / b : null;
    tip.innerHTML = `<b>${esc(dLabel(d))}</b><span>Price <em>${usd(c)}</em></span><span class="f">111DMA <em>${usd(a)}</em></span><span class="s">350DMA×2 <em>${usd(b)}</em></span>${gap !== null ? `<span>Gap <em>${(gap * 100).toFixed(1)}% · ${usd(Math.abs(b - a))}</em></span>` : '<span class="dim">Averages need 350 days of history</span>'}${v ? `<span class="v">Volume <em>${usdK(v)}</em></span>` : ''}`;
    tip.hidden = false;
    const hx = (px / W) * r.width, tw = tip.offsetWidth;
    tip.style.left = Math.max(4, Math.min(hx + 12, r.width - tw - 4)) + 'px';
    tip.style.top = '8px';
  };
  const hide = () => { tip.hidden = true; xh.style.display = 'none'; };
  svg.addEventListener('pointermove', (e) => show(e.clientX));
  svg.addEventListener('pointerdown', (e) => show(e.clientX));
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
}
