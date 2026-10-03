// Bitcoin Market Intelligence — page controller.
// Renders the agent's latest analysis and can regenerate it in the browser
// using the same engine the scheduled agent runs.

import { briefReport } from '../engine/report.js';
import { brief } from '../engine/brief.js';
import { ZONES } from '../engine/cycle.js';
import { explain, EXPLAIN, REMINDER } from '../engine/explain.js';
import { startLivePrice } from './live.js?v=20261003c';
import { drawPriceChart, pcState, wirePriceChart } from './pricechart.js?v=20261003c';
import { dashTab, mountDash, dashLive, refreshDash } from './dash.js?v=20261003c';
import { dcaPageHtml, mountDcaPage, dcaLive, redrawDcaChart } from './dcapage.js?v=20261003c';
import { fmtUsd, fmtUsdSigned, fmtPrice, fmtPct, fmtNum, fmtK, ordinal } from '../engine/util.js';

const state = { a: null, rows: [], runs: [], index: null, snapshot: null, range: 90, pi: null, dash: null, live: null, liveState: 'init' };
const $ = (s, r = document) => r.querySelector(s);

// ---------- safe templating ----------
class Raw { constructor(s) { this.s = s; } }
const raw = (s) => new Raw(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ser = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(ser).join('') : v === null || v === undefined || v === false ? '' : esc(v));
const h = (strings, ...vals) => raw(strings.reduce((acc, s, i) => acc + s + (i < vals.length ? ser(vals[i]) : ''), ''));
const safeUrl = (u) => (u && /^https:\/\//.test(u) ? u : null);

// ---------- formatting ----------
const tzFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
const fmtTime = (t) => { if (!t) return 'n/a'; const d = new Date(t.length === 10 ? t + 'T00:00:00Z' : t); return isNaN(d) ? String(t) : t.length === 10 ? t : tzFmt.format(d); };
const ageH = (t) => (t ? (Date.now() - new Date(t)) / 3600e3 : null);
const cls = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');
function dirClass(d = '') {
  d = d.toLowerCase();
  if (/bullish|stabilising|constructive|falling \(/.test(d)) return 'bull';
  if (/bearish|fragility rising|amplifier/.test(d)) return 'bear';
  return 'neu';
}
const chip = (txt, c) => h`<span class="chip ${c}">${txt}</span>`;
// "i" icon that opens a plain-English explanation (hover, keyboard focus, or tap)
const info = (key, ctx) => h`<button type="button" class="info" data-explain="${key}"${ctx !== undefined ? raw(` data-ctx="${esc(ctx)}"`) : ''} aria-label="What is ${EXPLAIN[key]?.title || 'this'}?">i</button>`;
// evidence strength as a quiet 3-step meter next to its word (weak ●○○ · moderate ●●○ · strong ●●●)
const EV_N = { weak: 1, moderate: 2, strong: 3 };
const evMeter = (conf) => h`<span class="evm" title="evidence strength: ${conf}">${[1, 2, 3].map((i) => h`<i class="${i <= (EV_N[conf] || 0) ? 'on' : ''}"></i>`)}<span>${conf}</span></span>`;
const dirChip = (d) => chip(d, dirClass(d));

function srcLine(ids) {
  const a = state.a;
  const parts = [];
  for (const id of [].concat(ids)) {
    const q = a.quality.find((x) => x.id === id);
    if (!q) continue;
    parts.push(h`${q.name} · ${fmtTime(q.asOf || q.fetchedAt)} · ${q.frequency || ''}${q.status !== 'ok' ? raw(' ' + ser(chip(q.status === 'server-only' ? 'server value' : q.status, q.status === 'error' ? 'err' : 'stale'))) : ''}`);
  }
  return parts.length ? raw(parts.map((p) => p.s).join('<br>')) : h`<span class="dim">source unavailable</span>`;
}
const isStale = (ids) => [].concat(ids).some((id) => { const q = state.a.quality.find((x) => x.id === id); return q && q.status !== 'ok'; });

// ---------- minimal markdown (input is escaped first) ----------
function md(src) {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const lines = String(src || '').split('\n');
  let out = '', i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*$/.test(l)) { i++; continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { const n = Math.min(m[1].length, 3); out += `<h${n}>${inline(m[2])}</h${n}>`; i++; continue; }
    if (/^---+\s*$/.test(l)) { out += '<hr>'; i++; continue; }
    if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r, k) => !(k === 1 && /^\|[\s:|-]+\|?$/.test(r)));
      out += '<table><thead><tr>' + cells(body[0]).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' + body.slice(1).map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
      continue;
    }
    if (/^>\s?/.test(l)) { let b = ''; while (i < lines.length && /^>\s?/.test(lines[i])) { b += lines[i].replace(/^>\s?/, '') + ' '; i++; } out += `<blockquote>${inline(b)}</blockquote>`; continue; }
    if (/^\s*[-*]\s+/.test(l)) { out += '<ul>'; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { out += `<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`; i++; } out += '</ul>'; continue; }
    if (/^\s*\d+\.\s+/.test(l)) { out += '<ol>'; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { out += `<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`; i++; } out += '</ol>'; continue; }
    let p = '';
    while (i < lines.length && lines[i].trim() && !/^(#|\||>|\s*[-*]\s|\s*\d+\.\s|---)/.test(lines[i])) { p += lines[i].replace(/\s+$/, '') + ' '; i++; }
    out += `<p>${inline(p.trim())}</p>`;
  }
  return raw(out);
}

// ---------- charts (inline SVG, single axis, hover layer) ----------
function niceTicks(min, max, n = 4) {
  if (min === max) { const d = Math.abs(min) * 0.05 || 1; min -= d; max += d; }
  const step0 = (max - min) / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= step0);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const t = []; for (let v = lo; v <= hi + step / 2; v += step) t.push(+v.toFixed(10));
  return t;
}
const BIG = { w: 600, h: 200, pad: { l: 56, r: 14, t: 10, b: 24 }, axes: true };
const SPARK = { w: 300, h: 64, pad: { l: 2, r: 6, t: 6, b: 4 }, axes: false };
const xLabel = (d) => (d.length > 10 ? `${d.slice(5, 10)} ${d.slice(11, 16)}` : d.slice(2));
const tipLabel = (d) => (d.length > 10 ? fmtTime(d) : d);
function emptySvg(o, msg) {
  return `<svg viewBox="0 0 ${o.w} ${o.h}" data-w="${o.w}" data-h="${o.h}" role="img"><text class="empty" x="${o.w / 2}" y="${o.h / 2 + 4}" text-anchor="middle">${esc(msg)}</text></svg>`;
}
function lineSvg(pts, fmt, o = BIG, emptyMsg = 'Not enough history yet', fmtTip = fmt) {
  if (!pts || pts.length < 2) return emptySvg(o, pts?.length === 1 ? `1 observation so far (${fmtTip(pts[0][1])}) — ${emptyMsg}` : emptyMsg);
  const { w: W, h: H, pad: PAD } = o;
  const xs = pts.map((p) => new Date(p[0].length > 10 ? p[0] : p[0] + 'T00:00:00Z').getTime()), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const y0 = o.axes ? ticks[0] : Math.min(...ys), y1 = o.axes ? ticks.at(-1) : Math.max(...ys);
  const X = (x) => PAD.l + ((x - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r);
  const Y = (y) => PAD.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - PAD.t - PAD.b);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const area = `${path}L${X(xs.at(-1)).toFixed(1)},${H - PAD.b}L${X(xs[0]).toFixed(1)},${H - PAD.b}Z`;
  const grid = o.axes ? ticks.map((t) => `<line class="gridl" x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="axis" x="${PAD.l - 6}" y="${Y(t) + 3}" text-anchor="end">${esc(fmt(t))}</text>`).join('') : '';
  // optional zone bands (e.g. MVRV zones) behind the series
  const bands = (o.bands || []).map((b) => { const lo = Math.max(y0, b.lo), hi = Math.min(y1, b.hi); return hi > lo ? `<rect class="band b-${b.tone}" x="${PAD.l}" width="${W - PAD.l - PAD.r}" y="${Y(hi).toFixed(1)}" height="${(Y(lo) - Y(hi)).toFixed(1)}"><title>${esc(b.label)}</title></rect>` : ''; }).join('');
  const xl = o.axes ? [0, Math.floor(pts.length / 2), pts.length - 1].map((i) => `<text class="axis" x="${X(xs[i])}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}">${esc(xLabel(pts[i][0]))}</text>`).join('') : '';
  const data = esc(JSON.stringify(pts.map((p, i) => [+X(xs[i]).toFixed(1), +Y(p[1]).toFixed(1), tipLabel(p[0]), fmtTip(p[1])])));
  const end = `<circle class="enddot" cx="${X(xs.at(-1))}" cy="${Y(ys.at(-1))}" r="${o.axes ? 3.5 : 3}"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" data-w="${W}" data-h="${H}" data-line="${data}" role="img" aria-label="line chart">${bands}${grid}${xl}<path class="area" d="${area}"/><path class="ln" d="${path}"/>${end}<line class="xh" y1="${PAD.t}" y2="${H - PAD.b}" style="display:none"/><circle class="dot" r="4" style="display:none"/></svg>`;
}
function barsSvg(pts, fmt, o = BIG, emptyMsg = 'No history yet', fmtTip = fmt) {
  if (!pts || pts.length < 2) return emptySvg(o, emptyMsg);
  const { w: W, h: H, pad: PAD } = o;
  const ys = pts.map((p) => p[1]);
  const ticks = niceTicks(Math.min(0, ...ys), Math.max(0, ...ys));
  const y0 = ticks[0], y1 = ticks.at(-1);
  const Y = (y) => PAD.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - PAD.t - PAD.b);
  const bw = (W - PAD.l - PAD.r) / pts.length;
  const grid = ticks.map((t) => (t === 0 || o.axes ? `<line class="${t === 0 ? 'zero' : 'gridl'}" x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(t)}" y2="${Y(t)}"/>` : '') + (o.axes ? `<text class="axis" x="${PAD.l - 6}" y="${Y(t) + 3}" text-anchor="end">${esc(fmt(t))}</text>` : '')).join('');
  const bars = pts.map(([d, v], i) => {
    const x = PAD.l + i * bw + Math.min(1, bw * 0.15), w = Math.max(1, bw - Math.min(2, bw * 0.3));
    const y = v >= 0 ? Y(v) : Y(0), hh = Math.max(1, Math.abs(Y(v) - Y(0)));
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}" rx="${Math.min(2, w / 2)}" fill="var(${v >= 0 ? '--series-pos' : '--series-neg'})" data-tip="${esc(tipLabel(d) + '|' + fmtTip(v))}"/>`;
  }).join('');
  const xl = o.axes ? [0, pts.length - 1].map((i) => `<text class="axis" x="${PAD.l + i * bw + (i ? bw : 0)}" y="${H - 6}" text-anchor="${i ? 'end' : 'start'}">${esc(xLabel(pts[i][0]))}</text>`).join('') : '';
  return `<svg viewBox="0 0 ${W} ${H}" data-w="${W}" data-h="${H}" role="img" aria-label="bar chart">${grid}${bars}${xl}</svg>`;
}
function wireChart(c) {
  const svg = c.querySelector('svg');
  if (!svg) return;
  const W = +svg.dataset.w, H = +svg.dataset.h;
  let tip = c.querySelector('.tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; tip.style.display = 'none'; c.appendChild(tip); }
  const show = (x, y, d, v) => {
    tip.replaceChildren();
    const b = document.createElement('b'); b.textContent = v; const s = document.createElement('span'); s.textContent = d;
    tip.append(b, s); tip.style.display = 'block';
    const r = svg.getBoundingClientRect(), cr = c.getBoundingClientRect();
    const px = (x / W) * r.width + (r.left - cr.left), py = (y / H) * r.height + (r.top - cr.top);
    tip.style.left = Math.max(4, Math.min(px + 10, cr.width - tip.offsetWidth - 4)) + 'px'; tip.style.top = Math.max(py - 44, -6) + 'px';
  };
  if (svg.dataset.line) {
    const pts = JSON.parse(svg.dataset.line);
    const xh = svg.querySelector('.xh'), dot = svg.querySelector('.dot');
    svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * W;
      let best = pts[0]; for (const p of pts) if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
      xh.setAttribute('x1', best[0]); xh.setAttribute('x2', best[0]); xh.style.display = '';
      dot.setAttribute('cx', best[0]); dot.setAttribute('cy', best[1]); dot.style.display = '';
      show(best[0], best[1], best[2], best[3]);
    });
    svg.addEventListener('pointerleave', () => { xh.style.display = 'none'; dot.style.display = 'none'; tip.style.display = 'none'; });
  } else {
    svg.querySelectorAll('rect[data-tip]').forEach((rc) => {
      rc.addEventListener('pointerenter', () => { const [d, v] = rc.dataset.tip.split('|'); rc.style.opacity = 0.7; show(+rc.getAttribute('x'), +rc.getAttribute('y'), d, v); });
      rc.addEventListener('pointerleave', () => { rc.style.opacity = ''; tip.style.display = 'none'; });
    });
  }
}

// Chart registry: every chart on the page is declared once here and drawn into
// <div data-chart="key"> (full size) or <div data-spark="key"> (tile size).
const cutDate = () => new Date(Date.now() - state.range * 864e5).toISOString().slice(0, 10);
const fromRows = (k) => { const c = cutDate(); return state.rows.filter((r) => r.date >= c && r[k] !== null && r[k] !== undefined).map((r) => [r.date, r[k]]); };
// Only runs measured on the same venue set as the latest are plotted together (no silent methodology mixing).
const fromRuns = (k, setKey) => { const c = cutDate(); const runs = state.runs || []; const latest = setKey ? runs.at(-1)?.[setKey] : null; return runs.filter((r) => r.t.slice(0, 10) >= c && r[k] !== null && r[k] !== undefined && (!setKey || r[setKey] === latest)).map((r) => [r.t, r[k]]); };
const etfPts = () => { const c = cutDate(); const m = new Map(); for (const r of state.rows) if (r.etfDate && r.etfDate >= c && r.etfLast !== null) m.set(r.etfDate, r.etfLast); return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)); };
const RUNS_MSG = 'history builds with every agent run (started Oct 1, 2026)';
const CHARTS = {
  price: { t: 'BTC price', s: 'daily close · CoinGecko', pts: () => fromRows('price'), f: (v) => fmtPrice(v), ft: (v) => fmtK(v) },
  depth: { t: '±1% order-book depth', s: 'per run · aggregate of 5 venues', pts: () => fromRuns('depth1', 'depthVenues'), f: (v) => fmtUsd(v, 1), ft: (v) => fmtUsd(v, 0), empty: RUNS_MSG },
  etf: { t: 'US spot ETF net flows', s: 'daily · Farside', kind: 'bars', pts: etfPts, f: (v) => fmtUsdSigned(v * 1e6), ft: (v) => fmtUsd(v * 1e6, 0), legend: true, empty: 'flow history builds daily (started Sep 2026)' },
  oi: { t: 'Open interest — OKX', s: 'daily · consistent single-venue series', pts: () => fromRows('oiOkx'), f: (v) => fmtUsd(v, 2), ft: (v) => fmtUsd(v, 1) },
  oiAgg: { t: 'Open interest — 5 major venues', s: 'per run · OKX, Binance, Bybit, Deribit, Hyperliquid', pts: () => fromRuns('oiTotal', 'oiCoverage'), f: (v) => fmtUsd(v, 2), ft: (v) => fmtUsd(v, 1), empty: RUNS_MSG },
  funding: { t: 'Perpetual funding (annualised)', s: 'daily avg · OKX BTC-USDT', pts: () => fromRows('fundingAnn'), f: (v) => fmtNum(v, 1) + '%', ft: (v) => fmtNum(v, 0) + '%' },
  premium: { t: 'Coinbase premium vs offshore', s: 'per run · US spot demand proxy', pts: () => fromRuns('cbPremium'), f: (v) => fmtPct(v, 3), ft: (v) => fmtNum(v, 2) + '%', empty: RUNS_MSG },
  dvol: { t: 'Implied volatility (DVOL)', s: 'daily · Deribit 30-day', pts: () => fromRows('dvol'), f: (v) => fmtNum(v, 1), ft: (v) => fmtNum(v, 0) },
  netliq: { t: 'US net liquidity (Fed − TGA − RRP)', s: 'weekly · FRED', pts: () => fromRows('netLiq'), f: (v) => fmtUsd(v * 1e9, 2), ft: (v) => fmtUsd(v * 1e9, 1) },
  real10y: { t: '10-year real yield', s: 'daily · FRED (TIPS)', pts: () => fromRows('real10y'), f: (v) => fmtNum(v, 2) + '%', ft: (v) => fmtNum(v, 1) + '%' },
  dxy: { t: 'US dollar index', s: 'daily · DXY', pts: () => fromRows('dxy'), f: (v) => fmtNum(v, 2), ft: (v) => fmtNum(v, 0) },
  us10y: { t: '10-year Treasury yield', s: 'daily · FRED', pts: () => fromRows('us10y'), f: (v) => fmtNum(v, 2) + '%', ft: (v) => fmtNum(v, 1) + '%' },
  vix: { t: 'VIX', s: 'daily · equity volatility', pts: () => fromRows('vix'), f: (v) => fmtNum(v, 1), ft: (v) => fmtNum(v, 0) },
  corr: { t: 'BTC–Nasdaq 30-day correlation', s: 'daily returns · derived', pts: () => fromRows('corrNdx30'), f: (v) => fmtNum(v, 2), ft: (v) => fmtNum(v, 1) },
  stables: { t: 'Stablecoin supply', s: 'daily · DefiLlama', pts: () => fromRows('stables'), f: (v) => fmtUsd(v, 1), ft: (v) => fmtUsd(v, 0) },
  cyMvrv: { t: 'MVRV since 2011, with zones', s: 'weekly · Coin Metrics', pts: () => state.a.cycle?.charts?.mvrv || [], f: (v) => fmtNum(v, 2), ft: (v) => fmtNum(v, 1), bands: 'mvrv' },
  cyPuell: { t: 'Puell Multiple (derived)', s: 'daily · Coin Metrics issuance × price', pts: () => state.a.cycle?.charts?.puell || [], f: (v) => fmtNum(v, 2), ft: (v) => fmtNum(v, 1), bands: 'puell', empty: 'available after the next server run' },
  cySopr: { t: 'SOPR, 7-day average', s: 'daily · BGeometrics (latest ~7 days withheld on free tier)', pts: () => state.a.cycle?.charts?.sopr || [], f: (v) => fmtNum(v, 3), ft: (v) => fmtNum(v, 2), bands: 'sopr', empty: 'available after the next server run' },
  cyProfit: { t: '% supply in profit', s: 'daily · BGeometrics ÷ Coin Metrics supply', pts: () => state.a.cycle?.charts?.profit || [], f: (v) => fmtNum(v, 1) + '%', ft: (v) => fmtNum(v, 0) + '%', bands: 'profit', empty: 'available after the next server run' },
  mvrv: { t: 'MVRV (price ÷ on-chain cost basis)', s: 'daily · Coin Metrics', pts: () => fromRows('mvrv'), f: (v) => fmtNum(v, 2), ft: (v) => fmtNum(v, 1) },
};
function drawChart(el) {
  const key = el.dataset.chart || el.dataset.spark, spark = !!el.dataset.spark, c = CHARTS[key];
  if (!c) return;
  const pts = c.pts(), base = spark ? SPARK : BIG;
  // draw at the element's real pixel width so text and strokes are never scaled
  const px = Math.round(el.clientWidth - (spark ? 0 : 28));
  const o = { ...base, w: px > 100 ? px : base.w, h: spark ? base.h : (px && px < 500 ? 170 : base.h) };
  if (c.bands && !spark) o.bands = ZONES[c.bands].map((z, i, t) => ({ lo: z.min, hi: i < t.length - 1 ? t[i + 1].min : Infinity, tone: z.tone, label: z.label }));
  const tick = spark ? c.f : c.ft;
  const svg = c.kind === 'bars' ? barsSvg(pts, tick, o, c.empty, c.f) : lineSvg(pts, tick, o, c.empty, c.f);
  el.innerHTML = spark ? svg : `<div class="ct"><b>${esc(c.t)}</b><span>${esc(c.s)}</span></div>${c.legend ? '<p class="legend" style="margin:0 0 4px"><span><i style="background:var(--series-pos)"></i>Net inflow</span><span><i style="background:var(--series-neg)"></i>Net outflow</span></p>' : ''}${svg}`;
  wireChart(el);
}
function drawCharts(root = document) { root.querySelectorAll('[data-chart],[data-spark]').forEach(drawChart); }
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { drawCharts(document); if (tabFromHash() === 'dashboard') drawPriceChart($('#pc-chart'), state.pi, state.live); if (tabFromHash() === 'dca') redrawDcaChart(); }, 200); });
document.addEventListener('toggle', (e) => { if (e.target.matches?.('details') && e.target.open) drawCharts(e.target); }, true);
const chartEl = (key) => h`<div class="chart" data-chart="${key}"></div>`;
const sparkEl = (key) => h`<div class="chart spark" data-spark="${key}"></div>`;
const rangeBar = () => h`<div class="range" role="group" aria-label="Chart range">${[[30, '30D'], [90, '90D'], [180, '6M'], [365, '1Y']].map(([r, l]) => h`<button type="button" data-range="${r}" aria-pressed="${state.range === r}">${l}</button>`)}</div>`;

// ---------- tabs ----------
// The BTC Dashboard is the landing view; Intelligence (#overview) is the daily 60–90 second
// read, with research depth in the other tabs. Old section anchors (#forces, #scenarios) still resolve.
const TABS = ['dashboard', 'dca', 'overview', 'cycle', 'report', 'liquidity'];
const LEGACY = { forces: 'overview', scenarios: 'overview', liqmap: 'overview', watch: 'overview', top3: 'overview' };
const tabFromHash = () => { const k = location.hash.slice(1); return TABS.includes(k) ? k : LEGACY[k] || (k.startsWith('force-') ? 'overview' : 'dashboard'); };
function showTab(scroll) {
  const t = tabFromHash(), k = location.hash.slice(1);
  document.querySelectorAll('[data-tab]').forEach((s) => { s.hidden = s.dataset.tab !== t; });
  document.querySelectorAll('[data-tab-link]').forEach((x) => x.setAttribute('aria-current', x.dataset.tabLink === t ? 'page' : 'false'));
  drawCharts($(`[data-tab="${t}"]`) || document);
  if (t === 'dashboard') drawPriceChart($('#pc-chart'), state.pi, state.live);
  if (t === 'dca') mountDcaPage({ pi: state.pi, getLive: () => state.live });
  if (k.startsWith('force-')) openForce(k);
  else if (LEGACY[k]) document.getElementById(k)?.scrollIntoView();
  else if (scroll) window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => { if (state.a) showTab(true); });
function openForce(id) {
  const d = document.getElementById(id);
  if (!d) return;
  if (d.classList.contains('extra') && !$('#flist').classList.contains('all')) $('#btn-allforces')?.click();
  d.open = true;
  d.scrollIntoView();
}

// ---------- shared pieces ----------
const stc = (s) => (s === 'met' ? 'met' : s === 'not met' ? 'notmet' : 'unknown');
const stLabel = (s) => (s === 'met' ? 'Met' : s === 'not met' ? 'Not met' : 'Unknown');
const sec = (id, title, aside, body) => h`<section id="${id}" class="block"><div class="bh"><h2>${title}</h2>${aside ? h`<p class="aside">${aside}</p>` : ''}</div>${body}</section>`;

// 1. Executive strip: price, regime, notable (≥1.5σ) moves only, quiet data status.
function execStrip(b) {
  const a = state.a, P = b.price;
  const ch = (v, k) => h`<span class="chg"><span class="${cls(v)}">${fmtPct(v, 1)}</span> ${k}</span>`;
  return h`<section class="exec" aria-label="Summary">
    <div class="exec-row">
      <div class="exec-px"><span class="px num" data-live="px">${fmtPrice(state.live?.price ?? P.spot)}</span><span data-live="ch">${ch(P.ch24h, '24h')}${ch(P.ch7d, '7d')}${ch(P.ch30d, '30d')}</span><span class="livebadge snap" data-live="badge"><i></i><span>Server snapshot · ${fmtTime(a.dataThrough)}</span></span></div>
      <div class="exec-regime"><span class="k">Regime</span><b>${b.regime.label}</b>${info('regime')}<span class="muted"> — ${b.regime.desc}</span>${b.regime.secondary ? h`<span class="muted"> Secondary: ${b.regime.secondary}.</span>` : ''}</div>
      ${b.cycle ? h`<div class="cyrow"><a class="cybadge t-${TONE_CHIP[b.cycle.tone] || 'neu'}" href="#cycle" title="On-chain cycle position — open the full On-chain cycle page"><span class="k">On-chain cycle</span>${b.cycle.phase ? h`<b>${b.cycle.phase}</b> · ` : ''}${b.cycle.zone}${b.cycle.momentum ? h` · momentum ${b.cycle.momentum.toLowerCase()}` : ''}${b.cycle.stretched ? ' · stretched' : ''} <span class="arr">→</span></a>${info('cyclebadge')}</div>` : ''}
    </div>
    <div class="exec-moves"><span class="k">What changed${info('changes')}</span>${b.notable.length ? b.notable.map((n) => h`<span class="move" title="${n.horizon === '7d' ? 'vs the observation a week ago' : 'vs the previous daily observation'}; σ = size vs the typical ${n.horizon === '7d' ? '7-day' : 'daily'} change"><span class="hz">${n.horizon}</span>${n.label} ${n.from} → ${n.to} <span class="z">${fmtNum(n.z, 1)}σ</span></span>`) : h`<span class="dim small">No statistically meaningful moves (≥1.5σ) over 24h or 7d.</span>`}</div>
    <div class="statusbar"><span>Data through ${fmtTime(a.dataThrough)}</span><span>${a.kind === 'browser' ? 'Browser refresh' : a.kind === 'morning' ? '07:00 report' : 'Server refresh'}</span><span>${b.sources.text}</span></div>
  </section>`;
}

// 2. Today's three most important variables.
function top3(b) {
  return sec('top3', 'Today’s three most important variables', null, h`<div class="vars">${b.top.map((t, i) => h`<article class="var ${dirClass(t.direction)}">
    <div class="var-h"><span class="n">${i + 1}</span><b>${t.name}</b>${hasExplain('force:' + t.id) ? info('force:' + t.id) : ''}</div>
    <div>${chip(t.dirNote, dirClass(t.direction))}</div>
    <p>${t.summary}</p>
    <p class="watch"><span class="k">Watch</span>${t.watch}</p>
  </article>`)}</div>`);
}

// 3. Ranked forces: top 5 by default, each row expands to the full existing detail.
const FORCE_CHARTS = { etf: ['etf'], depth: ['depth'], leverage: ['oi', 'oiAgg'], funding: ['funding'], spot: ['premium'], macro: ['netliq', 'real10y'], dollar: ['dxy', 'us10y'], options: ['dvol'], onchain: ['stables', 'mvrv'], riskappetite: ['corr', 'vix'] };
const TOP_N = 5;
function forcesBlock(b) {
  const a = state.a;
  const ev = (e) => h`<tr><td>${e.label}</td><td>${e.value}${e.source || e.derived ? raw(`<span class="srcl">${e.derived ? 'Derived by this system' : ''}${e.derived && e.source ? ' from ' : ''}${e.source ? esc(e.source) : ''}${e.asOf ? ' · ' + esc(fmtTime(e.asOf)) : ''}${e.frequency ? ' · ' + esc(e.frequency) : ''}${e.status && e.status !== 'ok' && e.status !== 'unavailable' ? ' · ' + esc(e.status.toUpperCase()) : ''}</span>`) : ''}</td></tr>`;
  const row = (f, i) => {
    const x = b.forces.find((y) => y.id === f.id) || {};
    return h`<details class="force${i >= TOP_N ? ' extra' : ''}" id="force-${f.id}">
      <summary>
        <span class="rank">${f.unavailable ? '–' : f.rank}</span>
        <span class="fname">${f.name}${hasExplain('force:' + f.id) ? info('force:' + f.id) : ''}${x.moved ? h` <span class="moved" title="${x.moved.label}: ${x.moved.from} → ${x.moved.to}">${fmtNum(x.moved.z, 1)}σ move</span>` : ''}</span>
        <span>${chip(x.dirNote || f.direction, dirClass(f.direction))}</span>
        <span class="ev-col">${evMeter(f.confidence)}</span>
        <span class="fstate">${f.unavailable ? f.state : x.line}</span>
        <span class="caret">›</span>
      </summary>
      ${f.unavailable ? h`<div class="fbody"><p class="full">${f.state}</p></div>` : h`<div class="fbody">
        <div class="full"><h4>Current state <span class="tag">observed</span></h4><p>${f.state}</p></div>
        ${FORCE_CHARTS[f.id] ? h`<div class="full fcharts">${FORCE_CHARTS[f.id].map(chartEl)}</div>` : ''}
        <div class="full"><h4>Evidence</h4><div class="tbl-wrap"><table class="ev"><tbody>${f.evidence.map(ev)}</tbody></table></div></div>
        <div class="full"><h4>Transmission mechanism</h4><p class="mech">${f.mechanism}</p></div>
        <div><h4>Interpretation <span class="tag">analysis</span></h4><p>${f.interpretation}</p></div>
        <div><h4>Direction · evidence strength</h4><p>${dirChip(f.direction)} ${chip(f.confidence, 'ev')}</p></div>
        <div><h4>Change from yesterday</h4><p>${f.d1}</p></div>
        <div><h4>Change from 1 week ago</h4><p>${f.d7}</p></div>
        <div><h4>What would invalidate it</h4><p>${f.invalidation}</p></div>
        <div><h4>What to watch next</h4><p>${f.watch}</p></div>
      </div>`}
    </details>`;
  };
  const more = a.forces.length - TOP_N;
  return sec('forces', 'What is moving BTC', 'Ranked by current importance, not direction.', h`
    <div class="fhead"><span>#</span><span>Force</span><span>Direction</span><span class="ev-col">Evidence${info('evidence')}</span><span class="fstate">Summary</span><span></span></div>
    <div class="flist" id="flist">${a.forces.map(row)}</div>
    <div class="block-foot"><p class="note">Expand any row for full evidence, mechanism, invalidation conditions and charts.</p>${more > 0 ? h`<button type="button" class="btn ghost mini" id="btn-allforces" aria-expanded="false" data-more="${more}">Show all ${a.forces.length} forces</button>` : ''}</div>`);
}

// 4. Liquidity ladder (key levels), full band table on expand.
function lmapTable() {
  const map = state.a.map;
  const mx = (k) => Math.max(1, ...map.levels.map((l) => l[k]));
  const mLL = mx('liqLong'), mLS = mx('liqShort'), mO = Math.max(1, ...map.levels.map((l) => l.callOi + l.putOi));
  const bar = (v, max, c, label) => h`<div class="mbar"><i class="${c}" style="width:${Math.round((v / max) * 70)}px"></i>${label}</div>`;
  const acc = (t) => (/squeeze|liquidation|vacuum|acceleration/.test(t) ? 'acc' : /congestion|support|pin|current/.test(t) ? 'dec' : '');
  const rows = map.levels.map((l) => h`<tr class="${l.isSpot ? 'spot' : ''}">
    <td data-k="Level"><span class="lvl">${fmtK(l.level)}</span><div class="xs dim">${l.isSpot ? `spot ${fmtPrice(map.spot)}` : fmtPct(l.distPct, 1)}</div></td>
    <td data-k="What matters there"><div class="tags">${l.tags.map((t) => h`<span class="tagc ${acc(t)}">${t}</span>`)}</div><div class="small muted">${l.why.join('; ')}${l.markers.filter((x) => x !== 'SPOT').length ? raw(`<div class="xs" style="color:var(--orange-ink)">${esc(l.markers.filter((x) => x !== 'SPOT').join(' · '))}</div>`) : ''}</div></td>
    <td data-k="Visible liquidity" class="n">${l.bookCovered || l.isSpot ? fmtUsd(l.book) : raw('<span class="dim">beyond visible book</span>')}</td>
    <td data-k="Leverage (model)">${l.above || l.isSpot ? bar(l.liqShort, mLS, 's', 'S ' + fmtUsd(l.liqShort)) : ''}${!l.above || l.isSpot ? bar(l.liqLong, mLL, 'l', 'L ' + fmtUsd(l.liqLong)) : ''}</td>
    <td data-k="Options (Deribit)">${bar(l.callOi + l.putOi, mO, 'o', `${fmtNum(l.callOi, 0)}C / ${fmtNum(l.putOi, 0)}P BTC`)}<div class="xs dim">γ ${fmtUsd(l.gamma)}/1%</div></td>
    <td data-k="ETF context" class="small">${l.etfContext}</td>
    <td data-k="If crossed" class="small">${l.crossing}</td>
  </tr>`);
  return h`<p class="legend"><span><i style="background:var(--series-neg)"></i>Modelled long liquidations (below spot)</span><span><i style="background:var(--series-pos)"></i>Modelled short liquidations (above spot)</span><span><i style="background:var(--orange)"></i>Deribit option OI at strikes in band</span></p>
    <div class="tbl-wrap"><table class="lmap"><thead><tr><th>Level</th><th>What matters there</th><th class="n">Visible liquidity</th><th>Leverage (model)</th><th>Options</th><th>ETF context</th><th>If crossed</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="xs dim" style="margin-top:8px"><b>Liquidation figures are a model estimate, not observed data:</b> leverage added on days OKX open interest rose (scaled to aggregate OI) is placed at that day’s close, split long/short by OKX’s account ratio, across a 5×/10×/25×/50× leverage mix; positions whose liquidation price has already been crossed are removed. Visible liquidity = displayed order-book depth (only observable within ~±3% of spot). Option OI is Deribit only; gamma sign (dealer long/short) is not observable.</p>`;
}
function ladderBlock(b) {
  if (!state.a.map) return sec('liqmap', 'Liquidity map', null, h`<p class="muted">Price unavailable.</p>`);
  const spot = state.a.map.spot;
  return sec('liqmap', 'Liquidity map', 'Key levels where forced or hedging flows sit. A map, not a prediction.', h`
    <ol class="ladder">${b.ladder.map((l) => h`<li class="lad ${l.kind}">
      <div class="lv"><b class="num">${l.label}${info('level', l.level)}</b><span class="num">${l.isSpot ? 'spot ' + fmtPrice(spot) : fmtPct(l.distPct, 1)}</span></div>
      <div class="lw">${l.what}${l.detail.length ? h`<div class="small muted">${cap1(l.detail.join(' · '))}</div>` : ''}</div>
      <div class="le">${l.effect}</div>
    </li>`)}</ol>
    <p class="legend"><span><i class="k-acc"></i>Likely to accelerate</span><span><i class="k-two"></i>Two-sided</span><span><i class="k-dec"></i>Likely to slow</span><span class="dim">Liquidation figures are modelled estimates.</span></p>
    <details class="more"><summary>Full band table</summary><div class="more-body">${lmapTable()}</div></details>
    <p class="note"><a href="#liquidity">Liquidity detail: depth by venue, order impact, options expiries →</a></p>`);
}
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// 5. Acceleration conditions: three short cards; full indicator lists on expand.
function accelBlock(b) {
  const a = state.a;
  const title = { up: 'Upside', base: 'Base case range', down: 'Downside' };
  return sec('scenarios', 'Acceleration conditions', 'Conditional, not forecasts. No probabilities are assigned.', h`<div class="acc3">${b.scenarios.map((s, i) => { const full = a.scenarios[i]; return h`<article class="acard s-${s.kind}">
    <header><b>${title[s.kind]}${info('scen:' + s.kind)}</b><span class="metc">${s.met} of ${s.total} met</span></header>
    <ul class="conds">${s.conds.map((c) => h`<li><span class="st ${stc(c.status)}">${stLabel(c.status)}</span><span>${c.text}<span class="val">now ${c.value}</span></span></li>`)}</ul>
    <p class="cm"><span class="k">Mechanism</span>${s.mech}</p>
    ${s.kind !== 'base' ? h`<p class="cm"><span class="k">Fails if</span>${s.fail}</p>` : ''}
    <details class="more"><summary>Full conditions</summary><dl class="more-body">
      <dt>What has to happen first</dt><dd>${full.first.map((c) => `${c.text} — ${c.status} (now ${c.value})`).join('; ')}</dd>
      <dt>Confirming indicators</dt><dd>${full.confirm.join('; ')}</dd>
      <dt>Contradicting indicators</dt><dd>${full.contradict.join('; ')}</dd>
      <dt>Potential acceleration points</dt><dd>${full.levels.length ? full.levels.map((l) => `${fmtK(l.level)} (${l.tags.join(', ')})`).join('; ') : 'None identified on current data'}</dd>
      <dt>Liquidity mechanism</dt><dd>${full.mechanism}</dd>
      <dt>What would cause it to fail</dt><dd>${full.failure}</dd>
    </dl></details>
  </article>`; })}</div>`);
}

// 6. Three things to watch.
const watchBlock = (b) => sec('watch', 'Three things to watch', 'Next 24 hours: dated events first, then on-chain and liquidity.', h`<ol class="watch24">${b.watch.map((w) => h`<li><b>${w.link ? h`<a href="${w.link}">${w.what}</a>` : w.what}${w.key ? info(w.key) : ''}</b><span>${w.why}</span></li>`)}</ol>`);

// Collapsed market dashboard: price chart, KPI tiles, move attribution, all changes.
function dashboard() {
  const a = state.a, m = a.metrics, P = m.price;
  const dep = m.depth, E = m.etf, D = m.derivs, O = m.options, M = m.macro, L = m.liq, C = m.corr;
  const tile = (label, ids, v, s, d, sk, xk) => h`<div class="tile${isStale(ids) ? ' stale' : ''}"><div class="label">${label}${xk ? info(xk) : ''}${d ? raw(' ' + ser(dirChip(d))) : ''}</div><div class="v">${v}</div>${sk ? sparkEl(sk) : ''}<div class="s">${s}</div><div class="src">${srcLine(ids)}</div></div>`;
  const force = (id) => a.forces.find((f) => f.id === id);
  const sell100 = dep?.impact?.sell?.find((x) => x.sizeUsd === 100e6);
  return h`<details class="more dash" id="dashboard"><summary>Market dashboard <span class="dim">— price chart, key metrics, move attribution and every change since the last observation</span></summary><div class="more-body">
    <div class="dash-top">
      <div class="small muted">${P.drawdownPct !== null ? `${fmtPct(P.drawdownPct)} from ATH${P.ath ? ` (${fmtPrice(P.ath)}, ${P.athDate})` : ''}` : ''}${P.ma200 ? ` · 200-day avg ${fmtPrice(P.ma200)}` : ''}${P.rv30 !== null ? ` · 30d realised vol ${fmtNum(P.rv30, 0)}%` : ''}<div class="xs dim">${srcLine(['coingecko'])}</div></div>
      <div class="attr"><div class="label">How price is moving${info('attribution')}</div>${[a.attribution.d1, a.attribution.d7].map((x) => h`<div class="row"><div class="h">${x.horizon === '1d' ? 'Last 24 hours' : 'Last 7 days'} · ${x.confidence}</div><b>${x.label}</b><div class="small muted">${x.explanation}</div></div>`)}</div>
    </div>
    <div class="kpis">
      ${tile('Spot liquidity (±1% depth)', dep ? dep.venues.map((v) => 'book_' + v.venue.toLowerCase()) : ['book_binance'], dep ? fmtUsd(dep.d1) : 'n/a', dep ? h`${dep.ch7d !== null ? raw(`<span class="${cls(dep.ch7d)}">${esc(fmtPct(dep.ch7d))}</span> vs 7d · `) : 'no 7d history yet · '}top-2 venues ${Math.round(dep.top2Share * 100)}% · $100M sell ≈ ${sell100 ? (sell100.exhausted ? 'beyond captured depth' : fmtPct(-sell100.slippagePct, 2)) : 'n/a'}` : 'Order books unavailable', force('depth')?.direction, 'depth', 'force:depth')}
      ${tile('ETF flow trend', ['farside'], E ? fmtUsdSigned(E.s5 * 1e6) + ' 5d' : 'n/a', E ? h`20d ${fmtUsdSigned(E.s20 * 1e6)} · last day (${E.lastDate}) ${fmtUsdSigned(E.last * 1e6)} · ${E.streak > 0 ? `${E.streak}-day inflow streak` : E.streak < 0 ? `${-E.streak}-day outflow streak` : 'no streak'} · ${E.accel > 0 ? 'accelerating' : 'decelerating'}` : 'ETF flow data unavailable', force('etf')?.direction, 'etf', 'force:etf')}
      ${tile('Futures open interest', ['okx_deriv', 'deribit_fut', 'hyperliquid', 'bitmex', 'binance_deriv', 'bybit_deriv'].filter((id) => a.quality.some((q) => q.id === id && q.status !== 'error')), D ? fmtUsd(D.totalOi) : 'n/a', D ? h`${fmtNum(D.oiPctMcap)}% of mcap · 1d ${fmtPct(D.oiCh1d)} · 7d ${fmtPct(D.oiCh7d)} · 30d ${fmtPct(D.oiCh30d)} (${D.oiChBasis}) · venues: ${D.coverage.replace(/,/g, ', ')}${D.cot ? ` · CME ≈${fmtNum(D.cot.oiBtc / 1000, 0)}K BTC (CFTC ${D.cot.date})` : ''}` : 'unavailable', force('leverage')?.direction, 'oi', 'force:leverage')}
      ${tile('Funding & basis', ['okx_deriv', 'deribit_fut'], D?.fundingAnn !== null && D?.fundingAnn !== undefined ? fmtNum(D.fundingAnn, 1) + '% ann.' : 'n/a', D ? h`OI-weighted perps · dispersion ${fmtNum(D.fundingDispersionBps, 2)} bp/8h${D.basis ? ` · ${Math.round(D.basis.days)}d basis ${fmtNum(D.basis.annPct, 1)}%` : ''}${D.okxFunding7dAnn !== undefined ? ` · OKX 7d avg ${fmtNum(D.okxFunding7dAnn, 1)}%` : ''}` : 'unavailable', force('funding')?.direction, 'funding', 'force:funding')}
      ${tile('Liquidations', ['okx_deriv'], L ? `${fmtUsd(L.longUsd)} L / ${fmtUsd(L.shortUsd)} S` : 'n/a', L ? h`OKX BTC-USDT perp, ${L.count} most recent forced orders (${fmtTime(L.from)} → ${fmtTime(L.to)}). Market-wide liquidation totals require CoinGlass/Kaiko (not available).` : 'Market-wide liquidation data is not available from free sources.', null, null, null, 'liquidations')}
      ${tile('Options', ['deribit_opt', 'deribit_dvol'], O ? `IV ${fmtNum(O.atmIv30 ?? O.dvol, 1)}%` : 'n/a', O ? h`skew ${fmtNum(O.skew25, 1)} vp · P/C ${fmtNum(O.pcRatio)} · IV−RV ${fmtNum(O.ivRvSpread, 1)} · ${O.nextBigExpiry ? `${O.nextBigExpiry.expiry}: ${fmtUsd(O.nextBigExpiry.notionalUsd)} expiring, max pain ${fmtK(O.nextBigExpiry.maxPain)}` : ''}` : 'Deribit options unavailable', force('options')?.direction, 'dvol', 'force:options')}
      ${tile('Macro liquidity', ['fred', 'yahoo'], M?.netLiq ? fmtUsd(M.netLiq[1] * 1e9) : 'n/a', M ? h`net liquidity ${M.netLiq4w !== null ? fmtUsdSigned(M.netLiq4w * 1e9) : 'n/a'} 4w · real 10y ${M.real10y ? fmtNum(M.real10y[1], 2) + '%' : 'n/a'} · ${M.dollarLabel} ${fmtPct(M.dollar20d)} 4w · VIX ${M.vix ? fmtNum(M.vix[1], 1) : 'n/a'} · HY ${M.hy ? fmtNum(M.hy[1], 2) + '%' : 'n/a'}` : 'unavailable', force('macro')?.direction, 'netliq', 'force:macro')}
      ${tile('BTC trading behaviour', ['yahoo', 'coingecko_hist'], C?.behaviour?.label ? C.behaviour.label : 'n/a', C ? h`30d corr: Nasdaq ${fmtNum(C.NDX?.c30)} · gold ${fmtNum(C.GOLD?.c30)} · dollar ${fmtNum(C.DXY?.c30)} · VIX ${fmtNum(C.VIX?.c30)} · dominance ${fmtNum(m.structure?.dominance, 1)}%` : 'unavailable', null, 'corr', 'force:riskappetite')}
    </div>
    <div class="panel" style="margin-top:12px"><h3>Every change since the previous observation${m.prevDates?.d1 ? ` (${m.prevDates.d1})` : ''}</h3>
      <ul class="clean">${a.changes.slice(0, 12).map((c) => h`<li>${c.z !== null && c.z !== undefined ? raw(`<span class="z${Math.abs(c.z) >= 1.5 ? ' hot' : ''}">${esc(fmtNum(c.z, 1))}σ</span>`) : ''}${c.text.replace(/ \([^)]*σ[^)]*\)$/, '')}</li>`)}</ul>
      <p class="xs dim" style="margin-top:8px">σ = size of the change relative to the typical daily change in the stored history. Only moves of 1.5σ or more are called out on the overview.</p>
    </div>
  </div></details>`;
}

function overviewTab(b) {
  return h`${execStrip(b)}<p class="pi-moved small">The live price chart (moving averages, volatility envelope and an optional Pi Cycle Top overlay) is on the <a href="#dashboard">BTC Dashboard</a>.</p>${top3(b)}${forcesBlock(b)}${ladderBlock(b)}${accelBlock(b)}${watchBlock(b)}${dashboard()}<p class="foot-note">${b.footer}</p>`;
}

// ---------- On-chain cycle tab ----------
// Summary → composite → metric cards → history → methodology. Every card carries its source,
// as-of date and a data state (live / delayed / carried forward / unavailable).
const TONE_CHIP = { bull: 'bull', neu: 'neu', warn: 'caut', bear: 'bear' };
const zchip = (z) => (z ? chip(z.label, TONE_CHIP[z.tone] || 'neu') : chip('n/a', 'neu'));
const DATA_STATE = {
  live: null,
  delayed: (x) => `Data delayed — last good value as of ${x.asOf}${x.delayNote ? '. ' + x.delayNote : ''}`,
  carried: (x) => `Source unavailable this run — last good value as of ${x.asOf}, carried forward`,
};
const scoreTxt = (v) => (v === null || v === undefined ? '—' : v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');
function cycleCard(x) {
  if (x.status === 'unavailable') return h`<article class="mcard off"><header><b>${x.name}${hasExplain(x.id) ? info(x.id) : ''}</b>${chip('unavailable', 'neu')}</header><p class="small muted">${x.unavailableWhy || 'Not available from the free sources this run.'}</p><footer>${x.source}</footer></article>`;
  const note = DATA_STATE[x.status]?.(x);
  return h`<article class="mcard${x.status !== 'live' ? ' delayed' : ''}">
    <header><b>${x.name}${hasExplain(x.id) ? info(x.id) : ''}</b>${x.scored ? h`<span class="sc" title="score in the composite">${scoreTxt(x.zone?.score)}</span>` : h`<span class="sc dim" title="shown for context, not scored">ctx</span>`}</header>
    <div class="mv"><span class="num">${x.display}</span>${zchip(x.zone)}</div>
    ${note ? h`<div class="dstate">${note}</div>` : ''}
    <p>${x.meaning}</p>
    ${x.move.length ? h`<div class="mmove"><span class="k">Changes zone if</span>${x.move.join(' · ')}</div>` : ''}
    ${x.context ? h`<p class="xs dim">${x.context}</p>` : ''}
    <footer>${x.derived ? 'Derived · ' : ''}${x.source} · as of ${x.asOf || 'n/a'}</footer>
  </article>`;
}
function gauge(score) {
  const segs = ZONES.composite.map((z, i, t) => ({ ...z, lo: i ? z.min : -2, hi: i < t.length - 1 ? t[i + 1].min : 2 }));
  const pos = (v) => ((Math.max(-2, Math.min(2, v)) + 2) / 4) * 100;
  return h`<div class="gauge" role="img" aria-label="Composite valuation score ${score === null ? 'unavailable' : scoreTxt(+score.toFixed(2))} on a −2 to +2 scale">
    <div class="gbar">${segs.map((s) => h`<i class="g-${TONE_CHIP[s.tone]}" style="left:${pos(s.lo)}%;width:${pos(s.hi) - pos(s.lo)}%" title="${s.label}"></i>`)}${score !== null ? h`<b class="gmark" style="left:${pos(score)}%"></b>` : ''}</div>
    <div class="glabels">${segs.slice().reverse().map((s) => h`<span style="left:${(pos(s.lo) + pos(s.hi)) / 2}%">${s.label}</span>`)}</div>
    <div class="gscale"><span>−2 · stretched</span><span>0</span><span>+2 · deep value</span></div>
  </div>`;
}
function cycleTab() {
  const c = state.a.cycle;
  if (!c || c.error) return sec('cycle-sec', 'On-chain cycle & momentum', null, h`<p class="muted">On-chain cycle data is unavailable in this analysis${c?.error ? ` (${c.error})` : ''}. It is computed on the next server run.</p>`);
  const V = c.valuation, M = c.momentum;
  const val = c.metrics.filter((x) => x.group === 'valuation');
  const ctx = c.metrics.filter((x) => x.group !== 'valuation');
  const threshold = (id, unit = '') => ZONES[id].map((z, i, t) => `${i === 0 ? '< ' + t[1].min : i === t.length - 1 ? '≥ ' + z.min : z.min + '–' + t[i + 1].min}${unit} ${z.label}${z.score !== null ? ` (${scoreTxt(z.score)})` : ''}`).join(' · ');
  return h`<section id="cycle-sec" class="block">
    <div class="bh"><h2>On-chain cycle &amp; momentum</h2><p class="aside">Where BTC sits in the historical on-chain valuation cycle. Positioning research, not a trading signal.</p></div>
    <div class="cy-exec">
      <div class="cy-head">
        <div><span class="k">Cycle position${info('phase')}</span><div class="cy-phase">${c.phase ? c.phase.label : 'n/a'}${c.phase ? h`<span class="muted"> · NUPL ${fmtNum(c.phase.nupl, 2)}</span>` : ''}</div></div>
        <div><span class="k">Valuation${info('composite')}</span><div>${V.zone ? zchip(V.zone) : chip('inputs incomplete', 'neu')} <span class="num small muted">${V.score !== null ? scoreTxt(+V.score.toFixed(2)) : ''}</span></div></div>
        <div><span class="k">Momentum${info('momentum')}</span><div>${M.label ? chip(M.label, M.tone) : chip('n/a', 'neu')} <span class="num small muted">${M.score !== null ? scoreTxt(M.score) + ' of ±' + M.n : ''}</span></div></div>
        ${c.stretched ? h`<div><span class="k">Flag${info('stretched')}</span><div>${chip('Stretched', 'caut')}</div></div>` : ''}
      </div>
      <p class="cy-lean">${V.leaning ? h`<b>Historical leaning:</b> ${V.leaning}.` : h`<b>Composite needs at least 3 valuation inputs</b> — ${V.n} available this run.`}${c.stretched ? ' Valuation is elevated while momentum is still constructive — the profile of late-cycle extensions.' : ''}</p>
      <ul class="cy-why">${c.bullets.map((x) => h`<li>${x}</li>`)}</ul>
      <p class="xs dim">Historical regimes only — these zones describe where past cycles sat, not what happens next. No price targets, no probabilities.</p>
    </div>

    <h3 class="cy-h">Composite valuation index ${info('composite')}</h3>
    <div class="twocol cy-comp">
      <div class="panel">${gauge(V.score)}
        <table class="cy-tbl"><thead><tr><th>Input</th><th>Zone</th><th class="n">Score</th></tr></thead><tbody>
          ${val.map((x) => h`<tr class="${x.status === 'unavailable' ? 'dim' : ''}"><td>${x.name}${x.status === 'delayed' ? h` <span class="xs" style="color:var(--warn)">delayed</span>` : ''}</td><td>${x.status === 'unavailable' ? 'unavailable — excluded' : x.zone?.label}</td><td class="n num">${x.status === 'unavailable' ? '—' : scoreTxt(x.zone?.score)}</td></tr>`)}
          <tr class="tot"><td><b>Composite</b> = average of ${V.n} available inputs</td><td><b>${V.zone?.label || 'n/a'}</b></td><td class="n num"><b>${V.score !== null ? scoreTxt(+V.score.toFixed(2)) : '—'}</b></td></tr>
        </tbody></table>
      </div>
      <div class="panel"><h3>Momentum${info('momentum')}</h3>
        <table class="cy-tbl"><thead><tr><th>Component</th><th>Now</th><th class="n">Score</th></tr></thead><tbody>
          ${M.components.map((x) => h`<tr><td>${x.name}${info('mom:' + x.id)}<div class="xs dim">${x.rule}</div></td><td class="num small">${x.value}</td><td class="n num">${scoreTxt(x.score)}</td></tr>`)}
          <tr class="tot"><td><b>Momentum</b> (sum; ≥ +2 constructive, ≤ −2 weakening)</td><td><b>${M.label || 'n/a'}</b></td><td class="n num"><b>${scoreTxt(M.score)}</b></td></tr>
        </tbody></table>
        <p class="xs dim">Hash Ribbons are scored only on a recovery cross and are shown with the miner metrics below.</p>
      </div>
    </div>

    <h3 class="cy-h">Valuation metrics</h3>
    <div class="mcards">${val.map(cycleCard)}</div>
    <h3 class="cy-h">Context, miners &amp; liquidity</h3>
    <div class="mcards">${ctx.map(cycleCard)}</div>

    <div class="panel" style="margin-top:14px">${chartEl('cyMvrv')}<p class="xs dim">Shaded bands are the MVRV zones used above. Weekly samples from Coin Metrics since 2011.</p></div>
    <details class="more"><summary>More history: Puell Multiple, SOPR, % supply in profit</summary><div class="more-body fcharts">${chartEl('cyPuell')}${chartEl('cySopr')}${chartEl('cyProfit')}</div></details>

    <details class="more"><summary>Coming soon / requires additional source</summary><div class="more-body"><ul class="clean small">${c.comingSoon.map((x) => h`<li><b>${x.name}.</b> <span class="muted">${x.why}</span></li>`)}</ul></div></details>

    <details class="more"><summary>Methodology — formulas, zone thresholds, sources and delays</summary><div class="more-body cy-method">
      <h4>Formulas</h4>
      <ul class="clean small">
        <li><b>MVRV</b> = market cap ÷ realised cap (Coin Metrics CapMVRVCur). Realised price = price ÷ MVRV on the same date.</li>
        <li><b>NUPL</b> = 1 − 1/MVRV (derived; identical to (market cap − realised cap) ÷ market cap). Not scored separately.</li>
        <li><b>Distance to realised price</b> = spot ÷ realised price − 1. Not scored separately (= MVRV − 1).</li>
        <li><b>Mayer Multiple</b> = spot ÷ 200-day simple average of daily closes.</li>
        <li><b>Puell Multiple</b> = (daily issuance BTC × price) ÷ its trailing 365-day average (Coin Metrics IssTotNtv, PriceUSD).</li>
        <li><b>SOPR</b> = 7-day average of daily spent-output profit ratio (BGeometrics).</li>
        <li><b>% supply in profit</b> = BTC in profit (BGeometrics) ÷ circulating supply on the same date (Coin Metrics SplyCur).</li>
        <li><b>Hash Ribbons</b> = 30-day vs 60-day average hash rate (Coin Metrics HashRate). Recovery = 30d crosses back above 60d within 20 days after ≥10 days below.</li>
        <li><b>Composite valuation</b> = plain average of the scored valuation inputs available this run (minimum 3); each input scores −2…+2 by zone. <b>Momentum</b> = sum of four −1/0/+1 components.</li>
      </ul>
      <h4>Zone thresholds (score)</h4>
      <ul class="clean small">
        <li><b>MVRV:</b> ${threshold('mvrv')}</li>
        <li><b>NUPL (context):</b> ${threshold('nupl')}</li>
        <li><b>Mayer Multiple:</b> ${threshold('mayer')}</li>
        <li><b>Puell Multiple:</b> ${threshold('puell')}</li>
        <li><b>SOPR (7d):</b> ${threshold('sopr')}</li>
        <li><b>% supply in profit:</b> ${threshold('profit', '%')}</li>
        <li><b>Composite:</b> ≥ +1.25 Deep value · +0.5 to +1.25 Value · −0.5 to +0.5 Neutral / mid-cycle · −1.25 to −0.5 Elevated · ≤ −1.25 Euphoria / stretched. “Stretched” flag = composite ≤ −0.5 while momentum is constructive.</li>
      </ul>
      <p class="small muted">Thresholds are set from where these metrics sat at past cycle lows and highs (2011–2025). Recent cycle peaks have been lower than early ones (MVRV peaked near 3.9 in 2021 versus higher in 2013 and 2017), so the upper zones are deliberately below the early-cycle extremes. Thresholds are fixed in code and changed only with a dated methodology note.</p>
      <h4>Sources and known delays</h4>
      <ul class="clean small">
        <li><b>Coin Metrics Community API</b> — MVRV (full history since 2011), price, issuance, hash rate, supply. Daily, typically one day behind.</li>
        <li><b>BGeometrics free API</b> (bitcoin-data.com) — SOPR and BTC supply in profit. Free tier: 15 requests/day; fetched at most every 20 hours and carried forward between runs. Some metrics are returned with the latest ~7 days withheld (flagged by the provider); those cards show “Data delayed — last good value as of …”.</li>
        <li><b>CoinGecko</b> — spot and daily closes (200-day average). <b>DefiLlama</b> — stablecoin supply. <b>mempool.space</b> — current hash rate and next difficulty adjustment (shown on the main page).</li>
        <li>No paid Glassnode / CryptoQuant data is used. A metric that cannot be sourced is shown as unavailable and excluded from the composite rather than estimated.</li>
      </ul>
      <p class="small"><b>This is market-structure research, not investment advice.</b> It assigns no price targets and no probabilities, and nothing on this page is a recommendation to buy or sell.</p>
    </div></details>
  </section>`;
}

// ---------- Liquidity detail tab ----------
function liquidityTab() {
  const a = state.a, map = a.map, dep = a.metrics.depth, O = a.metrics.options;
  if (!map) return sec('liq-detail', 'Liquidity detail', null, h`<p class="muted">Price unavailable.</p>`);
  const imp = dep?.impact;
  return sec('liq-detail', 'Liquidity detail', 'Why could BTC accelerate if it crosses a level? $5K bands around spot — a map of where forced or hedging flows could sit, not a prediction.', h`
    ${lmapTable()}
    <div class="twocol" style="margin-top:16px">
      <div class="panel"><h3>Order-book depth by venue${info('depthVenues')}</h3>
        ${dep ? h`<div class="tbl-wrap" style="border:0"><table><thead><tr><th>Venue</th><th class="n">±0.5%</th><th class="n">±1%</th><th class="n">±2%</th><th class="n">Share ±1%</th><th class="n">Spread</th></tr></thead><tbody>
          ${dep.venues.map((v) => h`<tr><td>${v.venue} <span class="xs dim">${v.pair}</span></td><td class="n">${fmtUsd(v.d05)}</td><td class="n">${fmtUsd(v.d1)}${v.truncated1 ? '*' : ''}</td><td class="n">${fmtUsd(v.d2)}${v.truncated2 ? '*' : ''}</td><td class="n">${Math.round((v.d1 / dep.d1) * 100)}%</td><td class="n">${fmtNum(v.spreadBps, 2)}bp</td></tr>`)}
          <tr><td><b>Aggregate</b></td><td class="n">${fmtUsd(dep.d05)}</td><td class="n"><b>${fmtUsd(dep.d1)}</b></td><td class="n">${fmtUsd(dep.d2)}</td><td class="n">HHI ${Math.round(dep.hhi)}</td><td></td></tr>
        </tbody></table></div>
        <p class="xs dim">Bid/ask imbalance at ±1%: ${fmtPct(dep.imbalance1 * 100, 1)} (positive = more bids). Change vs 1d / 7d / 30d: ${fmtPct(dep.ch1d)} / ${fmtPct(dep.ch7d)} / ${fmtPct(dep.ch30d)} (like-for-like venue set only). * venue book did not extend to the full band. USDT books treated at $1.</p>` : h`<p class="muted">Unavailable.</p>`}
      </div>
      <div class="panel"><h3>Can the market absorb aggressive flow?${info('impact')}</h3>
        ${imp ? h`<div class="tbl-wrap" style="border:0"><table><thead><tr><th>Order</th><th class="n">Sell impact</th><th class="n">Worst fill</th><th class="n">Buy impact</th></tr></thead><tbody>
          ${imp.sell.map((s, i) => { const bb = imp.buy[i]; return h`<tr><td class="num">${fmtUsd(s.sizeUsd)}</td><td class="n">${s.exhausted ? raw('<span class="down">beyond captured depth</span>') : fmtPct(-s.slippagePct, 2)}</td><td class="n">${s.exhausted ? `filled ${fmtUsd(s.filledUsd)}` : fmtPrice(s.worstPrice)}</td><td class="n">${bb.exhausted ? raw('<span class="up">beyond captured depth</span>') : fmtPct(bb.slippagePct, 2)}</td></tr>`; })}
        </tbody></table></div>
        <p class="xs dim">Idealised: walks the combined displayed books of ${imp.venues.join(', ')} with perfect routing. <b>Displayed ≠ executed liquidity</b> — during stress makers cancel quotes, so real impact is typically larger. “Beyond captured depth” means the order is larger than all the liquidity this snapshot captured — not that the market cannot absorb it.${dep.venues.some((v) => v.truncated2) ? ` Several venue APIs return a limited number of price levels, so their books are captured only partway: ${dep.venues.filter((v) => v.truncated2).map((v) => v.venue).join(', ')} (marked * in the depth table). Large-order impact is therefore a lower bound on available liquidity.` : ''}</p>` : h`<p class="muted">Unavailable.</p>`}
      </div>
    </div>
    ${O ? h`<div class="panel" style="margin-top:12px"><h3>Options expiries (Deribit)${info('expiries')}</h3><div class="tbl-wrap" style="border:0"><table><thead><tr><th>Expiry</th><th class="n">Days</th><th class="n">Notional</th><th class="n">P/C OI</th><th class="n">Max pain</th><th class="n">ATM IV</th><th class="n">25Δ skew</th><th>Largest strikes</th></tr></thead><tbody>
      ${O.expiries.slice(0, 8).map((e) => h`<tr><td class="num">${e.expiry}</td><td class="n">${fmtNum(e.days, 1)}</td><td class="n">${fmtUsd(e.notionalUsd)}</td><td class="n">${fmtNum(e.callOi ? e.putOi / e.callOi : null)}</td><td class="n">${fmtK(e.maxPain)}</td><td class="n">${fmtNum(e.atmIv, 1)}%</td><td class="n">${fmtNum(e.skew25, 1)}</td><td class="small">${e.topStrikes.map((s) => fmtK(s.strike)).join(', ')}</td></tr>`)}
    </tbody></table></div><p class="xs dim">Max pain = strike minimising option holders’ intrinsic value at expiry — a pinning reference only for large near-dated expiries. Skew = 25Δ call IV − 25Δ put IV (negative = puts richer).</p></div>` : ''}`);
}

// ---------- Morning report tab (condensed; full report on expand) ----------
const briefOf = (a) => { if (a.briefMd) return a.briefMd; try { return briefReport(a); } catch { return null; } };
function reportBodies(a) {
  const short = briefOf(a);
  const full = h`${md(a.reportMd)}${a.narrative?.text ? h`<hr><h1>Analyst narrative</h1><div class="narr">${md(a.narrative.text)}</div><p class="xs dim">Written by ${a.narrative.model || 'Claude'} from the computed data above; it may not introduce data that is not shown.</p>` : ''}`;
  if (!short) return h`<div class="report">${full}</div>`;
  return h`<div class="report">${md(short)}</div>
    <details class="more"><summary>Full research report — all sections, evidence and sources${a.narrative?.text ? ' + analyst narrative' : ''}</summary><div class="report more-body">${full}</div></details>`;
}
const reportText = (a) => [briefOf(a), a.reportMd, a.narrative?.text ? '# Analyst narrative\n\n' + a.narrative.text : null].filter(Boolean).join('\n\n---\n\n');
function reportTab() {
  const a = state.a;
  return sec('report', 'Morning report', `Same structure as the overview. Generated daily at 07:00 ${state.index?.timezone || ''}; the full research report is one click below and archived permanently.`, h`
    <div class="report-bar"><span class="small muted">${a.kind === 'browser' ? 'Browser refresh' : a.kind === 'morning' ? '07:00 report' : 'Server refresh'} · ${fmtTime(a.generatedAt)}</span><a class="btn ghost" id="rep-dl" href="#" download="btc-market-intelligence.md">Download .md</a></div>
    ${reportBodies(a)}`);
}


// ---------- explanations (single floating tooltip) ----------
const hasExplain = (key) => !!state.a && !!explain(key, state.a, null);
function explainFor(btn) {
  const key = btn.dataset.explain;
  const ctx = key === 'level' ? state.b?.ladder.find((l) => String(l.level) === btn.dataset.ctx) : undefined;
  return explain(key, state.a, ctx);
}
let tipBtn = null;
function showExplain(btn) {
  const e = explainFor(btn);
  if (!e) return;
  let t = $('#xtip');
  if (!t) { t = document.createElement('div'); t.id = 'xtip'; t.setAttribute('role', 'tooltip'); document.body.appendChild(t); }
  t.innerHTML = h`<b>${e.title}</b>${e.parts.map((p, i) => h`<p class="${p[0] === REMINDER ? 'rem' : i === 1 ? 'now' : ''}">${p.join(' ')}</p>`)}`.s;
  t.hidden = false;
  tipBtn?.setAttribute('aria-expanded', 'false');
  tipBtn = btn; btn.setAttribute('aria-expanded', 'true'); btn.setAttribute('aria-describedby', 'xtip');
  const r = btn.getBoundingClientRect(), W = innerWidth, H = innerHeight;
  const w = Math.min(340, W - 24); t.style.width = w + 'px';
  const left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, W - w - 12));
  const below = r.bottom + 8, th = t.offsetHeight;
  t.style.left = left + 'px';
  t.style.top = (below + th > H - 8 && r.top - th - 8 > 8 ? r.top - th - 8 : below) + 'px';
}
function hideExplain() { const t = $('#xtip'); if (t) t.hidden = true; tipBtn?.setAttribute('aria-expanded', 'false'); tipBtn = null; }
document.addEventListener('pointerover', (e) => { const b = e.target.closest?.('[data-explain]'); if (b && e.pointerType === 'mouse') showExplain(b); });
document.addEventListener('pointerout', (e) => { const b = e.target.closest?.('[data-explain]'); if (b && e.pointerType === 'mouse' && !b.contains(e.relatedTarget)) hideExplain(); });
// keyboard focus opens it; focus that comes from a click/tap is handled by the click handler
let pointerDown = null;
document.addEventListener('pointerdown', (e) => { pointerDown = e.pointerType; }, true);
document.addEventListener('focusin', (e) => { const b = e.target.closest?.('[data-explain]'); if (b && !pointerDown) showExplain(b); });
document.addEventListener('focusout', (e) => { if (e.target.closest?.('[data-explain]')) hideExplain(); });
// tap / click: toggle; never toggles the <details> row the icon sits in
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-explain]');
  const via = pointerDown; pointerDown = null;
  if (b) {
    e.preventDefault(); e.stopPropagation();
    if (via !== 'mouse' && tipBtn === b && !$('#xtip')?.hidden) hideExplain(); else showExplain(b);
    return;
  }
  if (!e.target.closest?.('#xtip')) hideExplain();
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideExplain(); });
// keep an open explanation attached to its icon while scrolling; close once the icon leaves the screen
let tipRaf = 0;
window.addEventListener('scroll', () => {
  if (!tipBtn || tipRaf) return;
  tipRaf = requestAnimationFrame(() => {
    tipRaf = 0;
    if (!tipBtn) return;
    const r = tipBtn.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) hideExplain(); else showExplain(tipBtn);
  });
}, { passive: true });

// ---------- render ----------
function render() {
  const a = state.a;
  const b = brief(a);
  state.b = b;
  const old = ageH(a.dataThrough);
  const banners = [];
  if (old !== null && old > 30) banners.push(h`<div class="banner warn">The latest analysis is ${Math.round(old)} hours old. The scheduled server update may be delayed; press <b>Refresh</b> to check for newer data.</div>`);
  const liveN = a.quality.filter((q) => q.status === 'ok').length;
  if (a.kind === 'browser' && liveN < 5) banners.push(h`<div class="banner warn">Browser refresh could reach only ${liveN} of ${a.quality.length} sources from this network. All other values are the last server values, marked stale with their original timestamps. Values from the last server update are shown with their original timestamps.</div>`);
  else if (a.kind === 'browser') banners.push(h`<div class="banner">Browser refresh: ${liveN} sources retrieved live. ETF flows, FRED, Yahoo and CFTC data cannot be fetched from a browser and show their last server values. Not saved to the archive.</div>`);
  $('#app').innerHTML = h`${banners}
    <div data-tab="dashboard" hidden>${raw(dashTab({ a, pi: state.pi, dash: state.dash, info }))}</div>
    <div data-tab="dca" hidden>${raw(dcaPageHtml({ pi: state.pi, info }))}</div>
    <div data-tab="overview" hidden>${overviewTab(b)}</div>
    <div data-tab="cycle" hidden>${cycleTab()}</div>
    <div data-tab="report" hidden>${reportTab()}</div>
    <div data-tab="liquidity" hidden>${liquidityTab()}</div>
`.s;
  wireSections();
  mountDash({ dash: state.dash, getLive: () => state.live });
  showTab(false);
  const np = $('#nav-price');
  if (np) np.innerHTML = h`${fmtPrice(a.metrics.price.spot)} <span class="${cls(a.metrics.price.ch24h)}">${fmtPct(a.metrics.price.ch24h)}</span>`.s;
  wirePriceChart(() => state.pi, () => state.live);
  if (state.live) paintLive(); else if (!liveFeed) liveFeed = startLivePrice({ onPrice: (v) => { state.live = v; paintLive(); }, onState: (s) => { state.liveState = s; paintLive(); } });
}

// ---------- live price (header) ----------
// The large price and its changes follow the live ticker; 7d and 30d compare it with the
// stored daily close 7 and 30 days earlier. If tickers fail, the last good value stays,
// marked stale; before the first tick the server snapshot is shown and labelled.
let liveFeed = null, lastPiDraw = 0;
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function closeDaysAgo(n) {
  const target = new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const src = state.pi?.rows?.length ? state.pi.rows.map((r) => [r[0], r[1]]) : state.rows.filter((r) => r.price).map((r) => [r.date, r.price]);
  let best = null; for (const [d, c] of src) { if (d <= target) best = c; else break; }
  return best;
}
function paintLive() {
  const L = state.live, pxs = document.querySelectorAll('[data-live="px"]'), badges = document.querySelectorAll('[data-live="badge"]'), chs = document.querySelectorAll('[data-live="ch"]');
  if (!pxs.length) return;
  const setBadge = (c, t, title) => badges.forEach((bd) => { bd.className = 'livebadge ' + c; bd.querySelector('span').textContent = t; if (title) bd.title = title; });
  if (L) {
    pxs.forEach((e) => { e.textContent = fmtPrice(L.price); });
    const c7 = closeDaysAgo(7), c30 = closeDaysAgo(30), ch24 = L.ch24 ?? state.a.metrics.price.ch24h;
    const piece = (v, k) => `<span class="chg"><span class="${cls(v)}">${esc(fmtPct(v, 1))}</span> ${k}</span>`;
    const html = piece(ch24, '24h') + piece(c7 ? (L.price / c7 - 1) * 100 : state.a.metrics.price.ch7d, '7d') + piece(c30 ? (L.price / c30 - 1) * 100 : state.a.metrics.price.ch30d, '30d');
    chs.forEach((e) => { e.innerHTML = html; });
    const stale = state.liveState === 'stale';
    setBadge(stale ? 'stale' : 'live', stale ? `Stale · last update ${timeFmt.format(L.at)}` : `Live · ${L.source} · ${timeFmt.format(L.at)}`, `${L.source}${L.note ? ' · ' + L.note : ''} · polled every 10–30 s`);
    const np = $('#nav-price'); if (np) np.innerHTML = h`${fmtPrice(L.price)} <span class="${cls(ch24)}">${fmtPct(ch24)}</span>`.s;
    if (Date.now() - lastPiDraw > 60e3 && tabFromHash() === 'dashboard') { lastPiDraw = Date.now(); drawPriceChart($('#pc-chart'), state.pi, L); }
    dashLive(L);
    dcaLive();
  } else if (state.liveState === 'stale') {
    setBadge('stale', `Live price unavailable · server snapshot ${fmtTime(state.a.dataThrough)}`);
  }
}

function wireSections() {
  document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    state.range = +b.dataset.range;
    document.querySelectorAll('[data-range]').forEach((x) => x.setAttribute('aria-pressed', String(+x.dataset.range === state.range)));
    drawCharts($('#app'));
  }));
  const all = $('#btn-allforces');
  all?.addEventListener('click', () => {
    const on = $('#flist').classList.toggle('all');
    all.setAttribute('aria-expanded', String(on));
    all.textContent = on ? `Show top ${TOP_N} only` : `Show all ${state.a.forces.length} forces`;
  });
  // deep links to a force open it (and reveal it if it is outside the top 5)
  const setDl = (el, text) => { el.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' })); };
  setDl($('#rep-dl'), reportText(state.a));
}

// ---------- data ----------
async function getJSON(u) { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); }

async function load() {
  const [latest, ts, idx, runs, pi, dash] = await Promise.allSettled([getJSON('data/latest.json'), getJSON('data/timeseries.json'), getJSON('data/index.json'), getJSON('data/runs.json'), getJSON('data/pi_cycle.json'), getJSON('data/dash.json')]);
  state.pi = pi.status === 'fulfilled' ? pi.value : null;
  state.dash = dash.status === 'fulfilled' ? dash.value : null;
  if (state.dash?.volume?.rows?.length) { pcState.vol = state.dash.volume.rows; pcState.volSource = 'CoinGecko aggregate spot, daily'; }
  state.runs = runs.status === 'fulfilled' ? runs.value.runs || [] : [];
  state.rows = ts.status === 'fulfilled' ? ts.value.rows || [] : [];
  state.index = idx.status === 'fulfilled' ? idx.value : null;
  if (latest.status === 'fulfilled' && latest.value?.metrics) { state.a = latest.value; render(); return; }
  $('#app').innerHTML = h`<div class="empty-state"><p><b>No stored analysis yet.</b></p><p>The scheduled server job has not published its first analysis yet. Press <b>Refresh</b> in a few minutes.</p></div>`.s;
}

const progress = (t) => { $('#progress').textContent = t || ''; };

// ---------- the single Refresh button ----------
// Polls the live price now, re-fetches the dashboard's live sources (mempool.space, CoinGecko),
// and reloads the published data files; the page re-renders only if the server analysis changed.
let refreshing = false;
async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  const btn = $('#btn-refresh'), label = btn.querySelector('span');
  btn.disabled = true; btn.classList.add('busy'); label.textContent = 'Refreshing…';
  progress('Refreshing live price, network data and published analysis…');
  const t0 = Date.now(), before = state.a?.generatedAt;
  try {
    const [live, files] = await Promise.all([
      liveFeed ? liveFeed.now() : null,
      Promise.allSettled([getJSON('data/latest.json'), getJSON('data/timeseries.json'), getJSON('data/pi_cycle.json'), getJSON('data/index.json'), getJSON('data/runs.json')]),
      refreshDash(),
    ]);
    await new Promise((r) => setTimeout(r, Math.max(0, 600 - (Date.now() - t0)))); // keep the busy state visible briefly
    const [latest, ts, pi, idx, runs] = files.map((r) => (r.status === 'fulfilled' ? r.value : null));
    if (ts?.rows) state.rows = ts.rows;
    if (idx) state.index = idx;
    if (runs?.runs) state.runs = runs.runs;
    const piChanged = pi?.rows && pi.asOf !== state.pi?.asOf;
    if (pi?.rows) state.pi = pi;
    const changed = latest?.metrics && latest.generatedAt !== before;
    if (changed) { state.a = latest; render(); } else if (piChanged && tabFromHash() === 'dashboard') drawPriceChart($('#pc-chart'), state.pi, state.live);
    if (live) { state.live = live; paintLive(); }
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    progress(`Updated ${t} in ${((Date.now() - t0) / 1000).toFixed(1)}s — live price ${live ? `${live.source} ${fmtPrice(live.price)}` : 'unavailable'} · analysis data through ${fmtTime(state.a?.dataThrough)}${changed ? ' (new analysis loaded)' : ''}.`);
    label.textContent = `Updated ${t}`;
    setTimeout(() => { if (!refreshing) label.textContent = 'Refresh'; }, 4000);
    setTimeout(() => progress(''), 10000);
  } catch (e) {
    progress('Refresh failed: ' + e.message);
    label.textContent = 'Refresh';
  } finally { refreshing = false; btn.disabled = false; btn.classList.remove('busy'); }
}

$('#btn-refresh').addEventListener('click', refreshAll);
$('#btn-theme').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = cur;
  try { localStorage.setItem('bmi-theme', cur); } catch {}
});
load();
