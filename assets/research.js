// Analysis research pages, all fed by the Market Intelligence Engine (engine/intel.js):
//   #analysis                          landing: the five domains
//   #analysis/<domain>                 domain research page
//   #analysis/<domain>/c-<component>   component page (e.g. Liquidity, Leverage)
//   #analysis/<domain>/<indicator>     indicator deep dive
// Histories are the engine's own indicator definitions evaluated through time, so every page
// shows the same value the dashboard and Intelligence use. Heavy history work is deferred
// until after the page skeleton is on screen.

import { DOMAIN_META, DOMAIN_SLUG, SLUG_DOMAIN, DEF_BY_ID, indicatorsOf, indSlug, compSlug, indicatorHistory, domHistory, compHistory, gradeHistory, regimeTimeline, similarConditions, withArticle, materialForces } from '../engine/intel.js?v=20261004f';
import { ZONES } from '../engine/cycle.js?v=20261004f';
import { DOMAIN_DOCS, COMP_DOCS, IND_DOCS } from '../engine/indicator_docs.js?v=20261004f';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ok = (v) => v !== null && v !== undefined && Number.isFinite(v);
const TONE = { Strong: 'up', Supportive: 'up', Constructive: 'up', Neutral: 'neu', Mixed: 'neu', Context: 'ctx', Cautionary: 'warn', Cautious: 'warn', Deteriorating: 'down', Weak: 'down', Adverse: 'down', 'No data': 'ctx' };
const tone = (label, s) => TONE[label] || (!ok(s) ? 'ctx' : s >= 0.15 ? 'up' : s <= -0.4 ? 'down' : s <= -0.15 ? 'warn' : 'neu');
const pill = (label, s) => `<span class="ipill t-${tone(label, s)}">${esc(label)}</span>`;
const conf = (l) => `<span class="iconf ${{ High: 'c-hi', Moderate: 'c-mid' }[l] || 'c-lo'}">${esc(l)} confidence</span>`;
const sbar = (s) => (!ok(s) ? '<span class="sbar off"></span>' : `<span class="sbar"><i class="${s >= 0 ? 'p' : 'n'}" style="${s >= 0 ? 'left:50%' : `left:${50 + s * 50}%`};width:${Math.abs(s) * 50}%"></i></span>`);
const ord = (n) => { const r = Math.round(n), s = ['th', 'st', 'nd', 'rd'], v = r % 100; return r + (s[(v - 20) % 10] || s[v] || s[0]); };
const HZ = { short: 'Short term (days)', medium: 'Medium term (weeks)', long: 'Long term (months+)' };
const DSL = (k) => `#analysis/${DOMAIN_SLUG[k]}`;
const ILINK = (id) => { const d = DEF_BY_ID[id]; return d ? `${DSL(d.domain)}/${indSlug(id)}` : '#analysis'; };
const CLINK = (k, c) => `${DSL(k)}/${compSlug(c)}`;
const SHORT = { tech: 'Technical Analysis', chain: 'On-Chain Analysis', mkt: 'Market Structure', sent: 'Sentiment', macro: 'Macro & Liquidity' };

// ---------------------------------------------------------------- number formats per indicator
const PCT = 't_ma200 t_ma50_200 t_slope200 t_ma20_50 t_ma100 t_roc30 t_roc90 t_dd t_range t_rv t_bbw t_atr t_hv c_sth c_profit c_active c_tx c_fees c_hash c_hashprice c_exbal c_whales c_stab30 c_stab7 c_usdt m_oimcap m_basis m_funding m_cbp x_m2 x_g3 x_cpi x_pce x_be x_unrate x_gdp x_reallvl x_spx x_acwi x_ndx x_gold x_dxy x_dxytr s_wikitr m_dom m_breadth m_stabdom'.split(' ');
const BP = ['x_real', 'x_2y', 'x_10y', 'x_ff', 'x_hy'];
function fmtFor(id) {
  const n = (v, dp) => Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: dp });
  const sg = (v) => (v < 0 ? '−' : '');
  if (PCT.includes(id)) return (v) => `${sg(v)}${n(v, Math.abs(v) < 10 ? 2 : 1)}%`;
  if (BP.includes(id)) return (v) => `${sg(v)}${n(v * 100, 0)} bp`;
  if (['c_realized'].includes(id)) return (v) => `$${n(v, 0)}`;
  if (id === 's_fng') return (v) => n(v, 0);
  if (['c_rcap'].includes(id)) return (v) => `$${n(v / 1e9, 0)}B`;
  if (/^m_etf/.test(id) || id === 'm_cftcam') return (v) => `${sg(v)}${n(v, 0)}${/^m_etf/.test(id) ? ' US$m' : ''}`;
  if (['c_exnet'].includes(id)) return (v) => `${sg(v)}${n(v, 0)} BTC`;
  if (['x_netliq4', 'x_netliq13', 'x_fed'].includes(id)) return (v) => `${sg(v)}${n(v, 0)} bn`;
  return (v) => { const a = Math.abs(v); return `${sg(v)}${n(v, a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 3)}`; };
}
const scoreFmt = (v) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(2)}`;

// ---------------------------------------------------------------- charts (one axis, percentile lines)
function niceTicks(lo, hi, n = 5) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const span = hi - lo, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const out = []; for (let v = Math.floor(lo / step) * step; ; v += step) { out.push(+v.toFixed(10)); if (v >= hi - step * 1e-9 || out.length > 40) break; }
  return out;
}
const T = (d) => Date.parse(d + 'T00:00:00Z');
export function histSvg(pts, { bands = null, fmt = (v) => String(v), base = null, w = typeof innerWidth === 'undefined' ? 1000 : innerWidth < 700 ? 560 : Math.min(1500, Math.max(900, innerWidth - 120)), h = 320, refs = true, zero = false, label = 'history', guides = null } = {}) {
  if (!pts || pts.length < 2) return `<div class="hc-empty">Not enough stored history to chart yet${pts?.length ? ` (${pts.length} observation)` : ''}. History accumulates with each daily run.</div>`;
  const P = { l: w < 700 ? 56 : 70, r: w < 700 ? 74 : 96, t: 12, b: 28 };
  const xs = pts.map((p) => T(p[0])), ys = pts.map((p) => p[1]);
  const lines = refs && base?.enough ? [['97.5th', base.p97], ['90th', base.p90], ['Median', base.p50], ['10th', base.p10], ['2.5th', base.p2]] : guides || [];
  let lo = Math.min(...ys, ...lines.map((l) => l[1])), hi = Math.max(...ys, ...lines.map((l) => l[1]));
  if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const ticks = niceTicks(lo, hi, 5), y0 = ticks[0], y1 = ticks.at(-1), x0 = xs[0], x1 = xs.at(-1);
  const X = (x) => P.l + ((x - x0) / (x1 - x0 || 1)) * (w - P.l - P.r), Y = (y) => P.t + (1 - (y - y0) / (y1 - y0 || 1)) * (h - P.t - P.b);
  const grid = ticks.map((t) => `<line class="gridl" x1="${P.l}" x2="${w - P.r}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/><text class="axis" x="${P.l - 8}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end">${esc(fmt(t))}</text>`).join('');
  // x ticks: years (or quarters for short spans)
  const span = (x1 - x0) / 864e5, xt = [];
  const y0d = new Date(x0), y1d = new Date(x1);
  if (span > 600) { for (let y = y0d.getUTCFullYear() + 1; y <= y1d.getUTCFullYear(); y++) xt.push([Date.UTC(y, 0, 1), String(y)]); if (xt.length > 9) for (let i = xt.length - 1; i >= 0; i--) if (i % 2) xt.splice(i, 1); }
  else { const mo = span > 200 ? 3 : 1; const d = new Date(Date.UTC(y0d.getUTCFullYear(), y0d.getUTCMonth() + 1, 1)); while (d.getTime() <= x1) { if (d.getUTCMonth() % mo === 0) xt.push([d.getTime(), d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) + (d.getUTCMonth() === 0 ? ' ' + d.getUTCFullYear() : '')]); d.setUTCMonth(d.getUTCMonth() + 1); } }
  const xl = xt.map(([t, l]) => `<line class="gridl v" x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${P.t}" y2="${h - P.b}"/><text class="axis" x="${X(t).toFixed(1)}" y="${h - 8}" text-anchor="middle">${esc(l)}</text>`).join('');
  const zones = (bands || []).map((b) => { const lo = Math.max(y0, b.lo), hi = Math.min(y1, b.hi); return hi > lo ? `<rect class="hc-zone z-${b.tone}" x="${P.l}" width="${w - P.l - P.r}" y="${Y(hi).toFixed(1)}" height="${(Y(lo) - Y(hi)).toFixed(1)}"><title>${esc(b.label)}</title></rect><text class="hc-zl" x="${P.l + 6}" y="${(Y(hi) + 13).toFixed(1)}">${esc(b.label)}</text>` : ''; }).join('');
  const band = base?.enough && refs ? `<rect class="hc-band" x="${P.l}" width="${w - P.l - P.r}" y="${Y(base.p90).toFixed(1)}" height="${Math.max(0, Y(base.p10) - Y(base.p90)).toFixed(1)}"><title>10th–90th percentile of history (normal range)</title></rect>` : '';
  const ref = lines.map(([n, v]) => `<line class="hc-ref${n === 'Median' ? ' mid' : ''}" x1="${P.l}" x2="${w - P.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="hc-rl" x="${w - P.r + 6}" y="${(Y(v) + 4).toFixed(1)}">${guides && !refs ? n : `${n} ${esc(fmt(v))}`}</text>`).join('');
  const zl = zero && y0 < 0 && y1 > 0 ? `<line class="hc-zero" x1="${P.l}" x2="${w - P.r}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/>` : '';
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const step = Math.max(1, Math.ceil(pts.length / 500));
  const data = esc(JSON.stringify(pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => [+X(T(p[0])).toFixed(1), +Y(p[1]).toFixed(1), p[0], fmt(p[1])])));
  const end = `<circle class="enddot" cx="${X(xs.at(-1)).toFixed(1)}" cy="${Y(ys.at(-1)).toFixed(1)}" r="4"/>`;
  return `<div class="chart hc"><svg viewBox="0 0 ${w} ${h}" data-w="${w}" data-h="${h}" data-line="${data}" role="img" aria-label="${esc(label)}">${zones}${band}${grid}${xl}${zl}${ref}<path class="ln" d="${path}"/>${end}<line class="xh" y1="${P.t}" y2="${h - P.b}" style="display:none"/><circle class="dot" r="4" style="display:none"/></svg></div>`;
}
function sparkSvg(pts, w = 240, h = 46) {
  if (!pts || pts.length < 2) return '<span class="xs dim">no history yet</span>';
  const xs = pts.map((p) => T(p[0])), ys = pts.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys);
  const X = (x) => 2 + ((x - xs[0]) / (xs.at(-1) - xs[0] || 1)) * (w - 6), Y = (y) => 3 + (1 - (y - lo) / (hi - lo || 1)) * (h - 6);
  return `<svg class="rspark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path class="ln" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('')}"/><circle class="enddot" cx="${X(xs.at(-1)).toFixed(1)}" cy="${Y(ys.at(-1)).toFixed(1)}" r="2.5"/></svg>`;
}
const RANGES = [[365, '1Y'], [1095, '3Y'], [0, 'All']];
function rangedChart(key, pts, opts, def = 0) {
  const cut = (days) => (days ? pts.filter((p) => T(p[0]) >= T(pts.at(-1)[0]) - days * 864e5) : pts);
  const avail = RANGES.filter(([d]) => !d || T(pts.at(-1)[0]) - T(pts[0][0]) > d * 864e5 * 1.1);
  if (!avail.some(([d]) => d === def)) def = 0;
  return `<div class="hcw" data-hc="${esc(key)}">${avail.length > 1 ? `<div class="range" role="group" aria-label="Chart range">${avail.map(([d, l]) => `<button type="button" data-hcr="${d}" aria-pressed="${d === def}">${l}</button>`).join('')}</div>` : ''}<div class="hc-body">${histSvg(cut(def), opts)}</div></div>`;
}
const CHART_STORE = new Map();
function wireRanges(root, wireChart) {
  root.querySelectorAll('.hcw').forEach((w) => {
    const st = CHART_STORE.get(w.dataset.hc); if (!st) return;
    w.querySelectorAll('[data-hcr]').forEach((b) => b.addEventListener('click', () => {
      const d = +b.dataset.hcr, pts = d ? st.pts.filter((p) => T(p[0]) >= T(st.pts.at(-1)[0]) - d * 864e5) : st.pts;
      w.querySelector('.hc-body').innerHTML = histSvg(pts, st.opts);
      w.querySelectorAll('[data-hcr]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      w.querySelectorAll('.chart').forEach(wireChart);
    }));
    w.querySelectorAll('.chart').forEach(wireChart);
  });
}
const chartBlock = (key, pts, opts, def) => { CHART_STORE.set(key, { pts, opts }); return rangedChart(key, pts, opts, def); };

// ---------------------------------------------------------------- shared bits
// back bar for component and indicator pages; the app turns it into a real "back" when the
// previous view was this parent, so the scroll position comes back too
const backBar = (href, label, extra = '') => `<div class="rback"><a class="btn-back" href="${href}" data-back>← Back to ${esc(label)}</a>${extra}</div>`;
const crumbs = (items) => `<nav class="crumbs" aria-label="Breadcrumb">${items.map(([href, t], i) => (i < items.length - 1 ? `<a href="${href}">${esc(t)}</a><span>›</span>` : `<b>${esc(t)}</b>`)).join('')}</nav>`;
const statusNote = (I) => `<p class="xs dim rnote">Data as of ${esc(I.asOf)}. Observed values carry their source and date; states, zones and interpretation are BTCIntel’s analysis. Not investment advice and not a forecast.</p>`;
function regimeLine(b, fmt) {
  if (!b?.enough) return `<span class="muted">History too short for a baseline (${b?.n ?? 0} weekly observations).</span>`;
  return `<b>${ord(b.pct)} percentile</b> of ${b.n} weekly observations since ${esc(b.first)} · <b>${esc(b.zone)}</b>${ok(b.z) ? ` · z-score ${b.z >= 0 ? '+' : '−'}${Math.abs(b.z).toFixed(1)}` : ''}`;
}
const dayWord = (n) => (n >= 365 ? `${(n / 365).toFixed(1)} years` : `${n} day${n === 1 ? '' : 's'}`);
function baseTable(b, fmt) {
  if (!b?.enough) return '';
  const row = (k, v) => `<tr><th>${k}</th><td class="num">${v}</td></tr>`;
  return `<table class="btbl"><tbody>${row('Current', esc(fmt(b.now)))}${row('Percentile', ord(b.pct))}${row('Historical zone', esc(b.zone))}${row('Median', esc(fmt(b.p50)))}${row('Normal range (10th–90th)', `${esc(fmt(b.p10))} – ${esc(fmt(b.p90))}`)}${row('Extremes (2.5th / 97.5th)', `${esc(fmt(b.p2))} / ${esc(fmt(b.p97))}`)}${row('Lowest / highest', `${esc(fmt(b.min))} / ${esc(fmt(b.max))}`)}${row('Mean ± 1σ', `${esc(fmt(b.mean))} ± ${esc(fmt(Math.abs(b.sd)).replace('−', ''))}`)}${row('Observations', `${b.n} weekly since ${esc(b.first)}`)}</tbody></table>`;
}
function fwdBlock(b) {
  const F = b?.fwd;
  if (!F) return `<p class="small muted">Not enough history (at least two years with comparable readings) to show what followed similar readings.</p>`;
  const r = (x, l) => (x ? `<tr><th>${l}</th><td class="num">${x.med >= 0 ? '+' : '−'}${Math.abs(x.med).toFixed(0)}%</td><td class="num">${x.p25 >= 0 ? '+' : '−'}${Math.abs(x.p25).toFixed(0)}% to ${x.p75 >= 0 ? '+' : '−'}${Math.abs(x.p75).toFixed(0)}%</td><td class="num">${x.n}</td></tr>` : `<tr><th>${l}</th><td colspan="3" class="muted">fewer than 15 comparable observations</td></tr>`);
  return `<table class="btbl wide"><thead><tr><th>BTC price change afterwards</th><th>Median</th><th>Middle half of outcomes</th><th>Weekly observations</th></tr></thead><tbody>${r(F.d30, '30 days later')}${r(F.d90, '90 days later')}</tbody></table>
    <p class="xs dim">Weeks when this indicator sat between the ${ord(F.band[0])} and ${ord(F.band[1])} percentile, as now. Historical observation only: windows overlap, samples are small and Bitcoin’s past cycles may not repeat. This is not a forecast.</p>`;
}

// ---------------------------------------------------------------- full domain blocks (landing)
function indicatorRow(r) {
  const st = r.state || (r.s === null ? 'Context' : 'Neutral');
  return `<tr class="${r.s === null ? 'ctx' : ''}">
    <td data-k="Indicator"><a href="${ILINK(r.id)}"><b>${esc(r.name)}</b></a><div class="xs dim">${esc(HZ[r.horizon] || '')}${r.fresh === 'delayed' ? ' · delayed' : ''}</div></td>
    <td data-k="Reading" class="num">${esc(r.disp)}</td>
    <td data-k="Read">${read5(r)}${r.s !== null ? sbar(r.s) : ''}</td>
    <td data-k="Why">${esc(r.why)}<div class="xs dim">${esc(r.src)} · as of ${esc(r.asOf)}</div></td>
  </tr>`;
}
function domainBlock(d) {
  return `<details class="idom" id="dom-${d.key}" open>
    <summary>
      <span class="idom-n">${esc(SHORT[d.key])}</span>
      <span class="idom-q">${esc(d.question)}</span>
      <span class="idom-s">${pill(d.state, d.score)}<span class="ia">${d.arrow}</span>${sbar(d.score)}${conf(d.confidence.level)}</span>
    </summary>
    <div class="idom-b">
      <div class="icomps">${d.comps.map((c) => `<a class="icomp" href="${CLINK(d.key, c.name)}"><span class="cn">${esc(c.name)}</span><span class="cw t-${tone(null, c.score)}">${esc(SCALE5(c.score))}</span>${sbar(c.score)}<span class="cc xs dim">${c.n} scored</span></a>`).join('')}</div>
      ${d.notes.length ? `<p class="inote">${d.notes.map(esc).join(' ')}</p>` : ''}
      <p class="xs dim">Confidence ${esc(d.confidence.level.toLowerCase())}: ${Math.round(d.confidence.coverage * 100)}% of the domain’s indicator weight has data, ${Math.round(d.confidence.fresh * 100)}% freshness, ${Math.round(d.confidence.agree * 100)}% agreement with the domain’s direction. <a href="${DSL(d.key)}">Open the ${esc(SHORT[d.key])} research page →</a></p>
      ${d.comps.map((c) => (c.indicators.length ? `<h4 class="ich"><a href="${CLINK(d.key, c.name)}">${esc(c.name)}</a> <span>${esc(SCALE5(c.score))}</span></h4><div class="tbl-wrap"><table class="itbl"><tbody>${c.indicators.map(indicatorRow).join('')}</tbody></table></div>` : '')).join('')}
      ${d.unavailable?.length ? `<p class="iun"><span class="k">Not available from free sources</span>${d.unavailable.map(esc).join(' · ')}</p>` : ''}
    </div>
  </details>`;
}

// ---------------------------------------------------------------- landing
// the one scale used for every verdict on this page (and by the engine)
const STRENGTH = { Strong: 'high strength', Moderate: 'moderate strength', Weak: 'low strength' };
const SCALE5 = (s) => (!ok(s) ? 'No data' : s >= 0.4 ? 'Supportive' : s >= 0.15 ? 'Constructive' : s > -0.15 ? 'Neutral' : s > -0.4 ? 'Cautionary' : 'Adverse');
const RTONE = { Supportive: 'up', Constructive: 'up', Neutral: 'neu', Cautionary: 'warn', Adverse: 'down' };
const rd = (I, id) => I.readings[id];
const val = (r) => (r ? esc(String(r.disp)) : '<span class="muted">unavailable</span>');
// one evidence row: label · reading · engine read · link
// an indicator's read on the page-wide five-step scale ("Context" = shown, not scored)
const read5 = (r) => (r.s === null ? pill('Context', null) : `${pill(SCALE5(r.s), r.s)}${r.state === 'Deteriorating' ? ' <span class="xs dim">worsening</span>' : ''}`);
const evRow = (I, id, label) => { const r = rd(I, id); if (!r) return ''; return `<tr><td data-k="Evidence"><a href="${ILINK(id)}"><b>${esc(label || r.name)}</b></a><div class="xs dim">${esc(r.src)} · ${esc(r.asOf)}</div></td><td data-k="Reading" class="num">${val(r)}</td><td data-k="Read">${read5(r)}</td><td data-k="Meaning" class="small">${esc(r.why)}</td></tr>`; };
const evTable = (I, rows) => `<div class="tbl-wrap"><table class="itbl ev4"><tbody>${rows.map(([id, l]) => evRow(I, id, l)).join('')}</tbody></table></div>`;
// component read on the five-step scale
const compLine = (I, dk, comp, title) => { const d = I.domains.find((x) => x.key === dk), c = d?.comps.find((x) => x.name === comp); if (!c || c.score === null) return ''; const w = SCALE5(c.score); return `<a class="hsum" href="${CLINK(dk, comp)}"><span class="hs-n">${esc(title || comp)}</span><span class="hs-w t-${tone(w, c.score)}">${esc(w)}</span>${sbar(c.score)}</a>`; };
const sectionHead = (id, title, aside, more) => `<div class="bh" id="${id}"><h2>${title}</h2><p class="aside">${aside}${more ? ` · ${more}` : ''}</p></div>`;

function landing(I, ctx) {
  const D = (k) => I.domains.find((x) => x.key === k);
  const tile = (meta) => {
    const d = D(meta.key);
    const key = [...d.comps.flatMap((c) => c.indicators)].filter((r) => r.s !== null && r.value !== undefined).sort((a, b) => b.w - a.w).slice(0, 3);
    return `<a class="atile t-${tone(d.state, d.score)}" href="#analysis" data-jump="ov-${meta.key}">
      <div class="at-h"><h2>${esc(SHORT[meta.key])}</h2>${pill(d.state, d.score)}</div>
      <p class="at-q">“${esc(meta.question)}”${d.mixed ? ' <span class="xs dim">· components disagree</span>' : ''}</p>
      <div class="at-prev" data-domspark="${meta.key}"><span class="xs dim">Loading domain history…</span></div>
      <ul class="at-k">${key.map((r) => `<li><span>${esc(r.name)}</span><b class="num">${esc(String(r.disp).split(' (')[0].split(' ·')[0])}</b></li>`).join('')}</ul>
      <div class="at-f"><span>${d.arrow} ${conf(d.confidence.level)}</span><span class="at-go">Evidence below ↓</span></div>
    </a>`;
  };
  const G = I.regime, C = I.cycle, A = I.assessment, a = ctx?.a;
  const cyM = (id) => a?.cycle?.metrics?.find((x) => x.id === id);
  const zoneTxt = (id) => { const m = cyM(id); return m?.zone ? `${esc(m.zone.label.replace(' / mid-cycle', ''))}${m.move?.length ? `<div class="xs dim">Changes zone ${esc(m.move.join(' · '))}</div>` : ''}` : '—'; };
  const levF = I.forces.find((f) => f.id === 'leverage' && f.active), MF = materialForces(I, 5, 4);
  const thr = (id, unit = '') => ZONES[id].map((z, i, t) => `${i === 0 ? '< ' + t[1].min : i === t.length - 1 ? '≥ ' + z.min : z.min + '–' + t[i + 1].min}${unit} ${z.label}`).join(' · ');
  // structural factors (formerly the "market regime" chips), placed under their own domain
  const factors = (dk) => { const ev = (G?.evidence || []).filter((e) => e.dk === dk); return ev.length ? `<div class="sfac"><span class="k">Structural factors</span>${ev.map((e) => { const w = SCALE5(e.score); return `<a class="hsum" href="${e.comp ? CLINK(e.dk, e.comp) : DSL(e.dk)}"><span class="hs-n">${esc(e.name)}</span><span class="hs-w t-${tone(w, e.score)}">${esc(w)}</span>${sbar(e.score)}</a>`; }).join('')}</div>` : ''; };
  const domHead = (dk, id, aside, extraId = '') => { const d = D(dk); return `${extraId ? `<span id="${extraId}" class="anchor"></span>` : ''}<div class="bh ovd-h" id="${id}"><h2>${esc(SHORT[dk])} ${pill(d.state, d.score)}</h2><p class="aside">${aside} · <a href="${DSL(dk)}">Research page →</a></p></div>`; };
  const dtag = (names) => names.map((n) => `<span class="dtag">${esc(n)}</span>`).join('');
  // drivers/offsets as chart evidence: for each active force, its strongest reading pointing the same
  // way (largest |score| × weight), each indicator used once; the force is a small tag
  const usedEv = new Set();
  const SOLE = { stables: 'c_stab30', spot: 'm_cbp' }; // forces scored on one indicator show that indicator
  const evOf = (f) => { const ev = f.evidence.map((e) => ({ ...e, r: I.readings[e.id] })).filter((e) => e.r && e.r.s !== null && !usedEv.has(e.id)); const sole = ev.find((e) => e.id === SOLE[f.id]); if (sole) { usedEv.add(sole.id); return sole; } const al = ev.filter((e) => Math.sign(e.r.s) === f.dir).sort((a, b) => Math.abs(b.r.s) * b.r.w - Math.abs(a.r.s) * a.r.w); const pick = (al.length ? al : ev)[0]; if (pick) usedEv.add(pick.id); return pick; };
  const fItem = (f, cls) => { const e = evOf(f); return e ? `<li class="evi"><span class="fdot t-${cls}"></span><span class="fn">${dtag([f.domainName])} <a href="${ILINK(e.id)}"><b>${esc(e.name)}</b></a> <span class="num ev-v">${esc(e.disp)}</span></span><span class="fmeta">${esc(e.r.why || '')} <span class="xs dim">${esc(e.src)} · ${esc(e.asOf || '')} · feeds <a href="${'#force-' + f.id}">${esc(f.name)}</a></span></span></li>` : `<li class="evi"><span class="fdot t-${cls}"></span><span class="fn">${dtag([f.domainName])} <span class="muted">No chart reading available this run</span></span><span class="fmeta xs dim">feeds <a href="${'#force-' + f.id}">${esc(f.name)}</a></span></li>`; };
  return `<section class="ihead"><div><h1>Analysis</h1><p class="muted">Five domains and the charts behind them — evidence for the market read.</p><p class="xs dim ihead-fn">Domains = categories. Forces = mechanisms inside those categories. Same posture everywhere; different zoom.</p></div>
      <div class="ihead-r"><span class="muted small">Data as of ${esc(I.asOf)}</span></div></section>

    <span id="assessment" class="anchor"></span><section class="mregime t-${RTONE[I.state] || 'neu'}" id="regime">
      <div class="rg-l"><span class="k">Market posture${ctx?.info ? ctx.info('i_read') : ''}</span><div class="rg-label">${esc(I.state)}</div>
        ${C ? `<p class="rg-c">Structure consistent with ${esc(withArticle(C.phase))}${C.transitional && C.runnerUp ? `, bordering on ${esc(withArticle(C.runnerUp.phase))}` : ''}</p>` : ''}
        <div class="rg-meta">${conf(I.confidence.level)}<span class="small muted">${I.breadth.n} of ${I.breadth.of} domains Constructive or better</span></div></div>
      <div class="rg-r"><p>${esc(A ? A.why : '')}</p>
        <p class="xs dim">The same posture, on the same data, as the Market Read on the BTC Dashboard. Scale: Adverse · Cautionary · Neutral · Constructive · Supportive.</p>
        ${C ? `<details class="rg-more"><summary>What the structure description is based on</summary><div class="icyc"><div><h3>Consistent</h3><ul class="ichk">${C.met.map((m) => `<li class="y">${esc(m)}</li>`).join('') || '<li>—</li>'}</ul></div><div><h3>Not consistent</h3><ul class="ichk">${C.unmet.map((m) => `<li class="n">${esc(m)}</li>`).join('') || '<li class="muted">None</li>'}</ul></div></div><p class="xs dim">${esc(C.desc)} ${G ? esc(G.why) + ' ' : ''}The description uses structural, medium- and long-horizon factors (shown under each domain below); it is context for the posture, not a second verdict, and it never uses time since the halving.</p></details>` : ''}
      </div></section>

    <div class="atiles">${DOMAIN_META.map(tile).join('')}</div>

    <span class="anchor" id="ov-forces"></span><section class="block"><div class="bh"><h2>Key drivers and offsets</h2><p class="aside">Material evidence from the charts below (feeds the force library on <a href="#forces">Intelligence</a>).</p></div>
      <div class="ir-cols ovf"><div><h3>Key drivers</h3><ul class="ir-f">${MF.drivers.map((f) => fItem(f, 'up')).join('') || '<li class="muted">No supportive evidence above threshold.</li>'}</ul></div>
        <div><h3>Key offsets</h3><ul class="ir-f">${MF.offsets.map((f) => fItem(f, 'down')).join('') || '<li class="muted">No offsetting evidence above threshold.</li>'}</ul></div></div></section>

    <section class="block ovd">${domHead('tech', 'ov-tech', 'Trend, momentum, price structure, highs and lows, extension', 'structure')}
      ${factors('tech')}
      <div class="hsums">${compLine(I, 'tech', 'Trend')}${compLine(I, 'tech', 'Momentum')}${compLine(I, 'tech', 'Structure', 'Price structure')}${compLine(I, 'tech', 'Extension')}${compLine(I, 'tech', 'Volatility')}</div>
      ${evTable(I, [['t_ma200'], ['t_ma50_200'], ['t_slope200'], ['t_rsi'], ['t_macd'], ['t_hhhl'], ['t_dd', 'Distance from all-time high'], ['t_mayer'], ['t_levels']])}</section>

    <section class="block ovd">${domHead('chain', 'ov-chain', 'Holder positioning, cost bases, realised value, exchange flows and miners', 'onchain')}
      ${factors('chain')}
      <div class="hsums">${compLine(I, 'chain', 'Valuation', 'Realised valuation')}${compLine(I, 'chain', 'Holder behaviour')}${compLine(I, 'chain', 'Exchange behaviour')}${compLine(I, 'chain', 'Supply dynamics')}${compLine(I, 'chain', 'Network activity', 'Network & miners')}</div>
      <div class="tbl-wrap"><table class="itbl ev4"><thead><tr><th>Evidence</th><th>Reading</th><th>Historical zone</th><th>Engine read</th></tr></thead><tbody>
        ${[['c_mvrv', 'mvrv'], ['c_mvrvz'], ['c_mvrvtr'], ['c_realized'], ['c_rcap'], ['c_nupl', 'nupl'], ['c_sopr', 'sopr'], ['c_profit', 'profit'], ['c_sth'], ['c_lth'], ['c_exnet'], ['c_exbal'], ['c_puell', 'puell'], ['c_ribbons'], ['c_hashprice']].map(([id, z]) => { const r = rd(I, id); if (!r) return ''; return `<tr><td data-k="Evidence"><a href="${ILINK(id)}"><b>${esc(r.name)}</b></a><div class="xs dim">${esc(r.src)} · ${esc(r.asOf)}</div></td><td data-k="Reading" class="num">${val(r)}</td><td data-k="Historical zone" class="small">${z ? zoneTxt(z) : '<span class="xs dim">see deep dive</span>'}</td><td data-k="Engine read">${read5(r)}</td></tr>`; }).join('')}
      </tbody></table></div>
      ${I.valuation ? `<p class="small"><b>Valuation conclusion: ${esc(I.valuation.state)}.</b> ${esc(I.valuation.context)} <a href="#overview">Valuation evidence on Intelligence →</a></p>` : ''}
      <details class="about"><summary>On-chain zones, formulas and sources</summary>
        <ul class="clean small">
          <li><b>MVRV</b> = market cap ÷ realised cap (Coin Metrics). Zones: ${thr('mvrv')}.</li>
          <li><b>NUPL</b> = 1 − 1/MVRV (context, not scored twice): ${thr('nupl')}.</li>
          <li><b>MVRV Z-Score</b> = (market cap − realised cap) ÷ σ(market cap over all history), from Coin Metrics supply, price and MVRV.</li>
          <li><b>Mayer Multiple</b> = price ÷ 200-day average: ${thr('mayer')}.</li>
          <li><b>Puell Multiple</b> = daily issuance × price ÷ its 365-day average: ${thr('puell')}.</li>
          <li><b>SOPR</b> (7-day, BGeometrics): ${thr('sopr')}. <b>Supply in profit</b>: ${thr('profit', '%')}.</li>
          <li><b>Hash Ribbons</b> = 30-day ÷ 60-day average hash rate; recovery = the 30-day back above the 60-day after ≥10 days below.</li>
        </ul>
        <p class="small muted">Zones are set from where these metrics sat at past cycle lows and highs (2011–2025); recent peaks have been lower than early ones, so the upper zones sit below early extremes. They describe history, not what happens next. The engine’s valuation conclusion weights MVRV, the Mayer Multiple, the 200-week average, Puell, supply in profit and the holder cost bases instead of averaging zone scores. Sources: Coin Metrics Community (daily, ~1 day behind), BGeometrics free tier (refreshed at most every 20 hours; the latest ~7 days are sometimes withheld). No paid on-chain data is used.</p></details></section>

    <section class="block ovd">${domHead('mkt', 'ov-mkt', 'ETF flows, spot demand, leverage, derivatives and positioning')}
      ${factors('mkt')}
      <div class="hsums">${compLine(I, 'mkt', 'Institutional demand')}${compLine(I, 'mkt', 'Spot demand')}${compLine(I, 'mkt', 'Leverage')}${compLine(I, 'mkt', 'Derivatives', 'Futures & options')}${compLine(I, 'mkt', 'Market positioning')}${compLine(I, 'mkt', 'Crypto market structure', 'Breadth & dominance')}</div>
      <h3 class="rh3">Flows, spot demand and breadth</h3>
      ${evTable(I, [['m_etf5'], ['m_etf20'], ['m_cbp'], ['m_taker'], ['m_depth', 'Order-book depth within ±1%'], ['m_dom'], ['m_breadth']])}
      <h3 class="rh3" id="derivatives">Derivatives and positioning</h3>
      ${evTable(I, [['m_funding'], ['m_oigrowth'], ['m_oimcap'], ['m_basis'], ['m_skew'], ['m_dvol'], ['m_pcr'], ['m_ls'], ['m_cftcam'], ['m_liq']])}
      ${levF ? `<p class="small"><a href="#force-${levF.id}"><b>${esc(levF.name)}</b></a> — ${esc(levF.label.toLowerCase())} (${esc(STRENGTH[levF.strengthWord] || levF.strengthWord)}, ${esc(levF.horizon)} term): ${esc(levF.text)}</p>` : '<p class="small muted">The leverage &amp; derivatives force is inactive (below its threshold).</p>'}
      <p class="small">Order-book depth by venue, order impact, options expiries and the $5K band map: <a href="#analysis/liquidity">Liquidity Detail →</a></p></section>

    <section class="block ovd">${domHead('sent', 'ov-sent', 'Fear & greed, news tone and public attention')}
      <div class="hsums">${compLine(I, 'sent', 'Fear & Greed')}${compLine(I, 'sent', 'News')}${compLine(I, 'sent', 'Retail attention')}${compLine(I, 'sent', 'Narrative')}</div>
      ${evTable(I, [['s_fng'], ['s_fngchg'], ['s_news'], ['s_newsvol'], ['s_wiki'], ['s_wikitr']])}</section>

    <section class="block ovd">${domHead('macro', 'ov-macro', 'Net liquidity, central banks, yields, the dollar, financial conditions and risk appetite', 'liquidity-summary')}
      ${factors('macro')}
      <div class="hsums">${compLine(I, 'macro', 'Liquidity', 'Central-bank & dollar liquidity')}${compLine(I, 'macro', 'Rates & policy')}${compLine(I, 'macro', 'Dollar')}${compLine(I, 'macro', 'Financial conditions')}${compLine(I, 'macro', 'Risk appetite')}${compLine(I, 'chain', 'On-chain liquidity', 'Stablecoin liquidity')}</div>
      ${evTable(I, [['x_netliq4'], ['x_g3'], ['x_m2'], ['c_stab30'], ['x_real'], ['x_2y'], ['x_dxy'], ['x_nfci'], ['x_hy'], ['x_vix']])}
      <p class="small">Stablecoin supply is scored in On-chain (on-chain liquidity) and shown here as part of the liquidity backdrop. In-market depth is on <a href="#analysis/liquidity">Liquidity Detail</a>.</p></section>

    <section class="block">${sectionHead('history', 'Historical context', 'Prior Bitcoin regimes and comparable conditions — context, not prediction')}
      <div class="hist-grid">
        <div><h3 class="rh3">MVRV since 2011, with historical zones</h3><div data-mvrvzones><p class="small muted">Loading…</p></div></div>
        <div><h3 class="rh3">Where today sits in history</h3><div data-histpos><p class="small muted">Computing…</p></div></div>
      </div>
      <h3 class="rh3">Long-run regimes</h3><div data-timeline><p class="small muted">Computing…</p></div>
      <h3 class="rh3">Similar conditions in the past</h3><div data-similar><p class="small muted">Computing…</p></div>
      <p class="xs dim">Bitcoin has gone through several bull and bear regimes; their depth and length have varied widely. These comparisons show where current readings sit relative to that history. Small samples, overlapping windows and a changing market structure (ETFs, derivatives, institutional ownership) mean past outcomes do not predict future ones.</p></section>

    <section class="block"><div class="bh"><h2>Methodology and full indicator list</h2><p class="aside">${Object.values(I.readings).length} indicators, ${Object.values(I.readings).filter((r) => r.s !== null).length} scored · expand a domain</p></div>
      ${I.domains.map((d) => domainBlock(d).replace('<details class="idom" id="dom-' + d.key + '" open>', '<details class="idom" id="dom-' + d.key + '">')).join('')}
      <details class="about imethod"><summary>How the posture and domain statuses are decided</summary>
        <p><b>One scale.</b> The posture, every domain and every structural factor use the same five steps — Adverse, Cautionary, Neutral, Constructive, Supportive — set from a −1…+1 score (Supportive ≥ +0.4, Constructive ≥ +0.15, Neutral between, Cautionary ≤ −0.15, Adverse ≤ −0.4).</p>
        <p><b>Indicators.</b> Each is interpreted on its own −1…+1 scale against fixed thresholds and its own history: supportive (+0.2 or more), neutral, cautionary (−0.2 or less) or deteriorating. Context indicators are shown but not scored; delayed readings are down-weighted.</p>
        <p><b>Domains.</b> Indicators combine only inside a component; components combine into a domain by fixed weights with explicit override rules. A domain whose components point strongly in opposite directions reads Neutral and is marked “components disagree”.</p>
        <p><b>Posture.</b> The five domain scores are weighted (technical 25%, on-chain 20%, market structure 25%, sentiment 10%, macro & liquidity 20%) and checked for breadth: Supportive needs at least four domains Constructive or better; Adverse at least four Cautionary or worse. The Fair Grade is a 0–100 configuration score built from the same domains (breakdown on Intelligence). Valuation weighs several on-chain and price measures and is shown under On-chain.</p>
      </details></section>
    ${statusNote(I)}`;
}

// Liquidity Detail: the in-market liquidity research (order books, impact, expiries, band map)
function liquidityPage(I, ctx) {
  return `<section class="rhead dd"><div><h1>Liquidity Detail</h1><p class="rq">“Where is liquidity in the Bitcoin market, and how much flow can it absorb?”</p><p>Resting order-book liquidity, the estimated impact of large orders, depth by venue, options expiries and a map of where forced or hedging flows could sit around the price. The high-level liquidity conclusions are on <a href="#analysis">Analysis</a>; the external liquidity backdrop (central banks, M2, net liquidity, stablecoins) is on <a href="${DSL('macro')}">Macro &amp; Liquidity</a>.</p></div></section>
    <div class="hsums">${compLine(I, 'mkt', 'Spot demand')}${compLine(I, 'mkt', 'Leverage')}${compLine(I, 'macro', 'Liquidity', 'External liquidity')}</div>
    ${ctx.extras?.marketLiquidity?.() || ''}
    ${statusNote(I)}`;
}

// ---------------------------------------------------------------- domain page
function domainPage(I, dk, ctx) {
  const d = I.domains.find((x) => x.key === dk), doc = DOMAIN_DOCS[dk];
  const inds = d.comps.flatMap((c) => c.indicators);
  const scored = inds.filter((r) => r.s !== null);
  const key = [...scored].sort((a, b) => b.w - a.w).slice(0, 8);
  const charts = [...scored].sort((a, b) => b.w - a.w).slice(0, 4);
  const hz = ['short', 'medium', 'long'].map((h) => { const r = scored.filter((x) => x.horizon === h); const m = r.length ? r.reduce((a, x) => a + x.s, 0) / r.length : null; return { h, m, n: r.length }; });
  const others = I.domains.filter((x) => x.key !== dk);
  const div = I.confirmation.diverge.filter((x) => (x.a === d.name || x.b === d.name));
  const extra = dk === 'mkt' ? `<section class="block"><div class="bh"><h2>Market liquidity</h2></div><p>Order-book depth, the impact of large orders, depth by venue, options expiries and the $5K band map are on <a href="#analysis/liquidity">Liquidity Detail →</a></p></section>` : '';
  return `<section class="rhead"><div><h1>${esc(SHORT[dk])}</h1><p class="rq">“${esc(d.question)}”</p><p>${esc(doc.overview)}</p><p class="small muted">${esc(doc.role)}</p></div>
      <div class="rstate"><span class="k">Current read</span><div class="ir-state t-${tone(d.state, d.score)}">${esc(d.state)}</div><div>${d.arrow} ${sbar(d.score)} ${conf(d.confidence.level)}</div><p class="xs dim">${d.n} scored indicators · ${Math.round(d.confidence.coverage * 100)}% coverage · ${Math.round(d.confidence.agree * 100)}% agreement${d.notes.length ? `<br>${d.notes.map(esc).join(' ')}` : ''}</p></div></section>

    <section class="block"><div class="bh"><h2>Current state</h2><p class="aside">Components of the domain read · click any for its page</p></div>
      <div class="rcomps">${d.comps.map((c) => `<a class="rcomp" href="${CLINK(dk, c.name)}"><span class="cn">${esc(c.name)}</span><span class="cw t-${tone(null, c.score)}">${esc(c.word)}</span>${sbar(c.score)}<span class="xs dim">${c.n} scored · ${c.indicators.length} total</span></a>`).join('')}</div>
      <div class="rhz">${hz.map((x) => `<div><span class="k">${HZ[x.h]}</span>${x.m === null ? '<span class="muted small">no signals</span>' : `<b class="t-${tone(null, x.m)}">${x.m >= 0.15 ? 'Supportive' : x.m <= -0.15 ? 'Cautionary' : 'Neutral'}</b>${sbar(x.m)}<span class="xs dim">${x.n} signals</span>`}</div>`).join('')}</div>
      <p class="xs dim">Signals on different horizons can disagree without contradicting each other: short-term momentum can be stretched while the long-term trend is intact.</p></section>

    <section class="block"><div class="bh"><h2>Domain read over time</h2><p class="aside">The domain score (−1 to +1) recomputed from stored history</p></div>
      <div data-domchart="${dk}"><p class="small muted">Computing the domain’s history…</p></div>
      <p class="xs dim">Uses the indicators that have stored history on each date; inputs that exist only as a live snapshot (order books, some options data, news) are left out of past dates. Reference lines are the engine’s thresholds: ±0.15 constructive/cautionary, ±0.4 supportive/adverse.</p></section>

    <section class="block"><div class="bh"><h2>Key indicators</h2><p class="aside">Highest-weighted inputs · percentile against each indicator’s own history</p></div>
      <div class="rkeys">${key.map((r) => `<a class="rkey" href="${ILINK(r.id)}" data-keyind="${r.id}"><div class="rk-h"><span>${esc(r.name)}</span>${pill(r.state || 'Neutral', r.s)}</div><b class="num">${esc(String(r.disp).split(' (')[0].split(' ·')[0])}</b><div class="rk-s" data-kspark="${r.id}"></div><span class="xs dim" data-kpct="${r.id}">${esc(HZ[r.horizon])}</span></a>`).join('')}</div></section>

    <section class="block"><div class="bh"><h2>Historical charts</h2><p class="aside">Full available history · shaded band = 10th–90th percentile (normal range)</p></div>
      <div class="rcharts">${charts.map((r) => `<div class="rchart"><h3><a href="${ILINK(r.id)}">${esc(r.name)} →</a></h3><div data-indchart="${r.id}"><p class="small muted">Computing history…</p></div></div>`).join('')}</div></section>

    <section class="block"><div class="bh"><h2>Historical context and interpretation</h2></div>
      <div class="rinterp" data-interp="${dk}"><p class="small muted">Computing…</p></div>
      <h3 class="rh3">How the other domains read</h3>
      <div class="imatrix sm">${others.map((o) => `<a href="${DSL(o.key)}" class="imx t-${tone(o.state, o.score)}"><span class="n">${esc(o.name)}</span><b>${o.arrow} ${esc(o.state)}</b></a>`).join('')}</div>
      ${div.length ? `<ul class="idiv">${div.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>` : `<p class="small muted">No divergence between ${esc(d.name.toLowerCase())} and another domain right now.</p>`}</section>

    <section class="block"><div class="bh"><h2>All indicators</h2><p class="aside">Every input with its reading, engine interpretation, source and date · click a name for the deep dive</p></div>
      ${d.comps.map((c) => (c.indicators.length ? `<h4 class="ich"><a href="${CLINK(dk, c.name)}">${esc(c.name)}</a> <span>${esc(c.word)}</span></h4><div class="tbl-wrap"><table class="itbl"><tbody>${c.indicators.map((r) => `<tr class="${r.s === null ? 'ctx' : ''}"><td data-k="Indicator"><a href="${ILINK(r.id)}"><b>${esc(r.name)}</b></a><div class="xs dim">${esc(HZ[r.horizon])}${r.fresh === 'delayed' ? ' · delayed' : ''}</div></td><td data-k="Reading" class="num">${esc(r.disp)}</td><td data-k="Read">${pill(r.state || (r.s === null ? 'Context' : 'Neutral'), r.s)}${r.s !== null ? sbar(r.s) : ''}</td><td data-k="Why">${esc(r.why)}<div class="xs dim">${esc(r.src)} · as of ${esc(r.asOf)}</div></td></tr>`).join('')}</tbody></table></div>` : '')).join('')}
      ${d.unavailable?.length ? `<p class="iun"><span class="k">Not shown: no reliable free source</span>${d.unavailable.map(esc).join(' · ')}</p>` : ''}</section>
    ${dk === 'chain' ? `<section class="block"><div class="bh"><h2>Regime context</h2></div><p>On-chain positioning is one strand of evidence for the market regime. The regime, on-chain zone thresholds and historical context are on <a href="#analysis/regime">Analysis</a>.</p></section>` : ''}
    ${dk === 'macro' ? `<section class="block"><div class="bh"><h2>Where the liquidity research lives</h2></div><p class="small">External liquidity (central banks, M2, net liquidity, stablecoins as dollar liquidity) is on this page. In-market liquidity — order-book depth, order impact, options expiries and the liquidation map — describes the Bitcoin market itself and is on <a href="#analysis/liquidity">Liquidity Detail</a>.</p></section>` : ''}
    ${extra}
    ${statusNote(I)}`;
}

// ---------------------------------------------------------------- component page
function compPage(I, dk, comp) {
  const d = I.domains.find((x) => x.key === dk), c = d.comps.find((x) => x.name === comp);
  const charts = c.indicators.filter((r) => r.s !== null);
  return `${backBar(DSL(dk), SHORT[dk])}
    <section class="rhead"><div><h1>${esc(comp)}</h1><p class="rq">${c.indicators.length} indicators · ${c.n} scored · click any indicator to open its chart</p><p>${esc(COMP_DOCS[comp] || '')}</p></div>
      <div class="rstate"><span class="k">Current read</span><div class="ir-state t-${tone(null, c.score)}">${esc(c.word)}</div><div>${sbar(c.score)} <span class="small muted">${ok(c.score) ? scoreFmt(c.score) : '—'} on −1…+1</span></div><p class="xs dim">${c.n} scored of ${c.indicators.length} indicators · weight ${c.W} in the domain</p></div></section>
    <section class="block"><div class="bh"><h2>Component read over time</h2><p class="aside">Weighted reading of its indicators with stored history</p></div><div data-compchart="${dk}|${esc(comp)}"><p class="small muted">Computing…</p></div></section>
    <section class="block"><div class="bh"><h2>Indicators</h2></div>
      <div class="tbl-wrap"><table class="itbl"><tbody>${c.indicators.map((r) => `<tr class="${r.s === null ? 'ctx' : ''}"><td data-k="Indicator"><a href="${ILINK(r.id)}"><b>${esc(r.name)}</b></a><div class="xs dim">${esc(HZ[r.horizon])} · weight ${r.w}</div></td><td data-k="Reading" class="num">${esc(r.disp)}</td><td data-k="Read">${pill(r.state || (r.s === null ? 'Context' : 'Neutral'), r.s)}${r.s !== null ? sbar(r.s) : ''}</td><td data-k="Why">${esc(r.why)}<div class="xs dim">${esc(r.src)} · as of ${esc(r.asOf)}</div></td></tr>`).join('')}</tbody></table></div>
      <p class="xs dim">Indicators combine only inside their component, weighted and down-weighted when delayed; context indicators are shown but not scored.</p></section>
    ${charts.length ? `<section class="block"><div class="bh"><h2>All charts</h2><p class="aside">Full history of every scored indicator in ${esc(comp.toLowerCase())} · shaded band = 10th–90th percentile</p></div>
      <div class="rcharts">${charts.map((r) => `<div class="rchart"><h3><a href="${ILINK(r.id)}">${esc(r.name)} →</a></h3><div data-indchart="${r.id}"><p class="small muted">Computing history…</p></div></div>`).join('')}</div></section>` : ''}
    ${statusNote(I)}`;
}

// ---------------------------------------------------------------- indicator deep dive
function indPage(I, id, panel = false) {
  const def = DEF_BY_ID[id], doc = IND_DOCS[id] || {}, r = I.readings[id], dk = def.domain;
  const dom = I.domains.find((x) => x.key === dk);
  const siblings = indicatorsOf(dk).filter((x) => x.comp === def.comp && x.id !== id).map((x) => x.id);
  const related = [...new Set([...(doc.related || []), ...siblings])].slice(0, 10);
  return `${panel ? '' : backBar(DSL(dk), SHORT[dk], `<span class="rb-sub">in <a href="${CLINK(dk, def.comp)}">${esc(def.comp)}</a></span>`)}
    <section class="rhead dd"><div><h1>${esc(def.name)}</h1><p class="rq">${panel ? `${esc(SHORT[dk])} · ` : ''}<a href="${CLINK(dk, def.comp)}">${esc(def.comp)}</a> · ${esc(HZ[def.horizon])}</p></div></section>
    <div class="dd-grid">
      <section class="dd-main">
        <div class="dd-cur"><span class="k">Current</span>${r ? `<div class="dd-v num">${esc(String(r.disp))}</div><div>${pill(r.state || (r.s === null ? 'Context' : 'Neutral'), r.s)}${r.s !== null ? sbar(r.s) : ''}<span class="xs dim"> ${esc(def.src)} · as of ${esc(r.asOf)} · ${esc(r.fresh)}</span></div>` : `<div class="dd-v muted">Unavailable</div><p class="xs dim">No current reading from the free sources (source: ${esc(def.src)}). Nothing is filled in.</p>`}</div>
        <div class="dd-pos" data-ddpos="${id}"><span class="k">Historical position</span><span class="muted small">Computing…</span></div>
        <div data-ddchart="${id}"><p class="small muted">Computing the full history from the engine…</p></div>
        <h2 class="dd-h">Historical context</h2>
        <div data-ddctx="${id}"></div>
        <h2 class="dd-h">Current interpretation</h2>
        <div data-ddint="${id}"><p class="small muted">Computing…</p></div>
        <h2 class="dd-h">What followed similar readings</h2>
        <div data-ddfwd="${id}"></div>
      </section>
      <aside class="dd-side">
        <h3>What it measures</h3><p>${esc(doc.what || '')}</p>
        <h3>Why it matters</h3><p>${esc(doc.why || '')}</p>
        <h3>How the engine reads it</h3><p>${esc(doc.reading || (def.w > 0 ? 'Mapped to a −1…+1 scale against fixed thresholds: supportive at +0.2 or more, cautionary at −0.2 or less, deteriorating when cautionary and worse than a week ago.' : 'Context only: shown, not scored.'))}</p>
        <p class="xs dim">Weight ${def.w} in ${esc(def.comp)} · ${esc(HZ[def.horizon])}. Historical zones (low / normal / high / extreme) come from this indicator’s own percentiles, not from fixed colours.</p>
        <h3>Important caveat</h3><p>${esc(doc.caveat || '')}</p>
        <h3>Data & method</h3><ul class="dd-meta"><li><span>Source</span>${esc(def.src)}</li><li><span>Expected update</span>${def.freq <= 1 ? 'daily' : def.freq <= 3 ? `every ${def.freq} days (markets closed at weekends)` : def.freq <= 9 ? 'weekly' : def.freq <= 40 ? 'monthly, published with a lag' : 'quarterly'}</li><li><span>Last observation</span>${r ? esc(r.asOf) : 'unavailable'}</li><li><span>Freshness</span>${r ? esc(r.fresh === 'fresh' ? 'within its normal update interval' : 'delayed: down-weighted in the domain') : '—'}</li><li><span>History</span><span data-ddhist="${id}">…</span></li></ul>
        <h3>Related indicators</h3><ul class="dd-rel">${related.map((x) => `<li><a href="${ILINK(x)}">${esc(DEF_BY_ID[x]?.name || x)}</a></li>`).join('')}<li><a href="${CLINK(dk, def.comp)}">${esc(def.comp)} (component)</a></li><li><a href="${DSL(dk)}">${esc(SHORT[dk])}</a></li></ul>
      </aside>
    </div>
    ${panel ? '' : statusNote(I)}`;
}

// ---------------------------------------------------------------- side panel + ribbon menus
// "#analysis/<domain>/<indicator>" → indicator id (null for domains, components, other routes)
export function idFromHref(href) {
  const m = /^#analysis\/([^/]+)\/([^/#?]+)$/.exec(href || ''); if (!m) return null;
  const dk = SLUG_DOMAIN[m[1]]; if (!dk || m[2].startsWith('c-')) return null;
  return indicatorsOf(dk).find((x) => indSlug(x.id) === m[2])?.id || null;
}
export function indicatorPanel(I, id, ctx) {
  const def = DEF_BY_ID[id];
  return { html: `<div class="ip-head"><a class="ip-full" href="${ILINK(id)}" data-full>Open full page ↗</a><button type="button" class="ip-x" data-panel-close aria-label="Close">✕</button></div>${indPage(I, id, true)}`, title: def.name, after: (root) => fill(root, I, ctx) };
}
// mega-menu for a domain in the Analysis ribbon: its sub-sections and their indicators
export function ribbonMenu(dslug) {
  const dk = SLUG_DOMAIN[dslug]; if (!dk) return '';
  const meta = DOMAIN_META.find((x) => x.key === dk), inds = indicatorsOf(dk);
  return `<div class="snm-h"><a href="${DSL(dk)}"><b>${esc(SHORT[dk])}</b> — overview of all sub-sections →</a><button type="button" class="snm-x" data-menu-close aria-label="Close menu">✕</button></div>
    <div class="snm-cols">${Object.keys(meta.comps).map((c) => `<div class="snm-col"><a class="snm-c" href="${CLINK(dk, c)}">${esc(c)}</a><ul>${inds.filter((x) => x.comp === c).map((x) => `<li><a href="${ILINK(x.id)}"${x.w ? '' : ' class="ctx"'}>${esc(x.name)}</a></li>`).join('')}</ul></div>`).join('')}</div>`;
}

// ---------------------------------------------------------------- deferred fills
// Dashboard → Market Read (Fair Grade detail): the Fair Grade through time (same synthesis as today's grade).
// Computed lazily (about half a second) once the Intelligence view is open.
export function fillGradeChart(root, I, wireChart) {
  const el = root?.querySelector('[data-gradechart]'); if (!el || !I?.inputs || el.dataset.done) return;
  el.dataset.done = '1';
  setTimeout(() => {
    try {
      const pts = gradeHistory(I.inputs).map((p) => [p[0], p[1]]);
      if (pts.length) pts[pts.length - 1] = [pts.at(-1)[0], I.grade.value];
      el.innerHTML = chartBlock('fairgrade', pts, { fmt: (v) => String(Math.round(v)), refs: false, zero: false, label: 'Fair Grade history', base: null, w: 560, h: 210, guides: [['Strong', 70], ['Constructive', 58], ['Balanced', 45], ['Fragile', 33]] }, 365)
        + '<p class="xs dim">Same calculation as of each past date, on the indicators available then (thinner coverage further back). Last point = today.</p>';
      wireRanges(el, wireChart);
    } catch (e) { console.error('grade history', e); el.innerHTML = '<p class="small muted">Grade history unavailable.</p>'; }
  }, 30);
}
const defer = (fn) => new Promise((res) => setTimeout(() => { try { fn(); } catch (e) { console.error(e); } res(); }, 0));
async function fill(root, I, ctx) {
  const X = I.inputs, wc = ctx.wireChart;
  for (const el of root.querySelectorAll('[data-domspark]')) await defer(() => { const h = domHistory(X, el.dataset.domspark); el.innerHTML = `${sparkSvg(h.pts.slice(-365))}<span class="xs dim">domain read, past year</span>`; });
  for (const el of root.querySelectorAll('[data-mvrvzones]')) await defer(() => {
    const pts = indicatorHistory(X, 'c_mvrv').pts.map((p) => [p[0], p[1]]), Z = ZONES.mvrv, tones = { bull: 'up', neu: 'neu', warn: 'warn', bear: 'down' };
    const bands = Z.map((z, i) => ({ lo: i ? z.min : -10, hi: i < Z.length - 1 ? Z[i + 1].min : 100, label: z.label, tone: tones[z.tone] }));
    el.innerHTML = chartBlock('mvrv-zones', pts, { fmt: (v) => v.toFixed(2), bands, refs: false, label: 'MVRV with zones', h: 340 }, 0) + `<p class="xs dim">Coin Metrics MVRV, weekly before the last year. Bands are the historical zones listed under On-chain positioning.</p>`;
    wireRanges(el, wc);
  });
  for (const el of root.querySelectorAll('[data-histpos]')) await defer(() => {
    const rows = [['c_mvrv', 'MVRV'], ['t_mayer', 'Mayer Multiple'], ['t_ma200', 'Price vs 200-day average'], ['t_dd', 'Drawdown from all-time high'], ['c_puell', 'Puell Multiple'], ['s_fng', 'Fear & Greed']].map(([id, l]) => { const h = indicatorHistory(X, id), b = h.base, f = fmtFor(id); return b.enough ? `<tr><td><a href="${ILINK(id)}">${esc(l)}</a></td><td class="num">${esc(f(b.now))}</td><td class="num">${ord(b.pct)}</td><td>${esc(b.zone)}</td><td class="xs dim">since ${esc(b.first.slice(0, 4))}</td></tr>` : ''; }).join('');
    el.innerHTML = `<div class="tbl-wrap"><table class="btbl wide"><thead><tr><th>Measure</th><th>Now</th><th>Percentile</th><th>Historical zone</th><th>History</th></tr></thead><tbody>${rows}</tbody></table></div><p class="xs dim">Percentiles against each measure’s full available history (weekly samples).</p>`;
  });
  for (const el of root.querySelectorAll('[data-timeline]')) await defer(() => {
    const T = regimeTimeline(X); if (!T.weeks.length) { el.innerHTML = '<p class="small muted">Not enough price history.</p>'; return; }
    const t0 = Date.parse(T.weeks[0][0]), t1 = Date.parse(T.weeks.at(-1)[0]), x = (d) => ((Date.parse(d) - t0) / (t1 - t0 || 1)) * 100;
    const strip = T.episodes.map((e) => `<i class="tl-${RTONE[e.label]}" style="left:${x(e.start).toFixed(2)}%;width:${Math.max(0.3, x(e.end) - x(e.start) + 0.25).toFixed(2)}%" title="${esc(`${e.label}: ${e.start} → ${e.end} (${e.weeks} weeks)`)}"></i>`).join('');
    const yrs = []; for (let y = new Date(t0).getUTCFullYear() + 1; y <= new Date(t1).getUTCFullYear(); y++) yrs.push(`<span style="left:${x(`${y}-01-01`).toFixed(2)}%">${y}</span>`);
    const recent = T.episodes.filter((e) => e.weeks >= 4).slice(-10).reverse();
    el.innerHTML = `<div class="tl"><div class="tl-strip">${strip}</div><div class="tl-years">${yrs.join('')}</div></div>
      <div class="tl-key"><span><i class="tl-up"></i>Constructive: above a rising 200-day average</span><span><i class="tl-neu"></i>Neutral / transition</span><span><i class="tl-warn"></i>Cautionary: below a falling 200-day average</span></div>
      <div class="tbl-wrap"><table class="btbl wide"><thead><tr><th>Regime</th><th>From</th><th>To</th><th>Length</th><th>BTC over the period</th></tr></thead><tbody>${recent.map((e) => `<tr><td>${pill(e.label, e.label === 'Constructive' ? 1 : e.label === 'Cautionary' ? -0.5 : 0)}</td><td class="num">${esc(e.start)}</td><td class="num">${e === T.episodes.at(-1) ? 'now' : esc(e.end)}</td><td class="num">${e.weeks} weeks</td><td class="num">${ok(e.change) ? `${e.change >= 0 ? '+' : '−'}${Math.abs(e.change).toFixed(0)}%` : '—'}</td></tr>`).join('')}</tbody></table></div>
      <p class="xs dim">The long-run classification uses only inputs with history since 2011 (price versus its 200-day average and that average’s slope), so it is simpler than today’s full regime read above. Runs shorter than four weeks are folded into their neighbours.</p>`;
  });
  for (const el of root.querySelectorAll('[data-similar]')) await defer(() => {
    const S = similarConditions(X, I);
    if (!S || !S.episodes.length) { el.innerHTML = `<p class="small muted">No earlier periods matched today’s combination of readings${S ? ` (${esc(S.criteria)})` : ''}.</p>`; return; }
    const pf = (v) => (ok(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}%` : '—');
    el.innerHTML = `<p class="small">Weeks when ${esc(S.criteria)}: ${S.weeks} weeks in ${S.episodes.length} separate period${S.episodes.length === 1 ? '' : 's'}.</p>
      <div class="tbl-wrap"><table class="btbl wide"><thead><tr><th>Period</th><th>Weeks</th><th>MVRV then</th><th>BTC 90 days later</th><th>BTC 180 days later</th></tr></thead><tbody>${S.episodes.map((e) => `<tr><td class="num">${esc(e.start)}${e.end !== e.start ? ` → ${esc(e.end)}` : ''}</td><td class="num">${e.n}</td><td class="num">${ok(e.mvrv) ? e.mvrv.toFixed(2) : '—'}</td><td class="num">${pf(e.f90)}</td><td class="num">${pf(e.f180)}</td></tr>`).join('')}</tbody></table></div>
      <p class="xs dim">Context only: a handful of past periods in different market structures. What followed then is not a forecast of what follows now.</p>`;
  });
  for (const el of root.querySelectorAll('[data-domchart]')) await defer(() => {
    const h = domHistory(X, el.dataset.domchart);
    el.innerHTML = chartBlock('dom-' + el.dataset.domchart, h.pts, { fmt: scoreFmt, refs: false, zero: true, label: 'domain score history', base: null, guides: [['Supportive', 0.4], ['Constructive', 0.15], ['Cautionary', -0.15], ['Adverse', -0.4]] }, 1095);
    wireRanges(el, wc);
  });
  for (const el of root.querySelectorAll('[data-compchart]')) await defer(() => {
    const [dk, comp] = el.dataset.compchart.split('|'), h = compHistory(X, dk, comp);
    el.innerHTML = chartBlock('comp-' + dk + comp, h.pts, { fmt: scoreFmt, base: h.base, zero: true, label: comp + ' history' }, 1095);
    wireRanges(el, wc);
  });
  for (const el of root.querySelectorAll('[data-kspark]')) await defer(() => {
    const id = el.dataset.kspark, h = indicatorHistory(X, id);
    el.innerHTML = sparkSvg(h.pts.slice(-365));
    const p = root.querySelector(`[data-kpct="${id}"]`); if (p && h.base.enough) p.textContent = `${ord(h.base.pct)} pct · ${h.base.zone}${h.base.dir ? ' · ' + h.base.dir : ''}`;
  });
  for (const el of root.querySelectorAll('[data-indchart]')) await defer(() => {
    const id = el.dataset.indchart, h = indicatorHistory(X, id), fmt = fmtFor(id);
    const half = innerWidth >= 960 ? { w: Math.max(620, Math.round((Math.min(innerWidth, 2560) - 140) / 2)), h: 300 } : {};
    el.innerHTML = `${chartBlock('ind-' + id, h.pts.map((p) => [p[0], p[1]]), { fmt, base: h.base, label: DEF_BY_ID[id].name, ...half }, 0)}<p class="xs dim">${regimeLine(h.base, fmt)}</p>`;
    wireRanges(el, wc);
  });
  for (const el of root.querySelectorAll('[data-interp]')) await defer(() => {
    const dk = el.dataset.interp, d = I.domains.find((x) => x.key === dk), sc = d.comps.flatMap((c) => c.indicators).filter((r) => r.s !== null);
    const hs = sc.map((r) => ({ r, b: indicatorHistory(X, r.id).base })).filter((x) => x.b.enough);
    const hi = hs.filter((x) => x.b.pct >= 90), lo = hs.filter((x) => x.b.pct <= 10);
    const sup = sc.filter((r) => r.s >= 0.2).sort((a, b) => b.s * b.w - a.s * a.w), cau = sc.filter((r) => r.s <= -0.2).sort((a, b) => a.s * a.w - b.s * b.w);
    const dh = domHistory(X, dk).base;
    const L = (xs) => xs.map((x) => `<a href="${ILINK(x.r?.id || x.id)}">${esc((x.r || x).name)}</a>${x.b ? ` (${ord(x.b.pct)} pct)` : ''}`).join(', ');
    el.innerHTML = `<p>${esc(SHORT[dk])} reads <b>${esc(d.state.toLowerCase())}</b>: ${sup.length} of ${sc.length} scored indicators are supportive and ${cau.length} cautionary.${sup[0] ? ` The strongest support comes from <a href="${ILINK(sup[0].id)}">${esc(sup[0].name.toLowerCase())}</a> (${esc(String(sup[0].disp).split(' (')[0])}).` : ''}${cau[0] ? ` The main offset is <a href="${ILINK(cau[0].id)}">${esc(cau[0].name.toLowerCase())}</a> (${esc(String(cau[0].disp).split(' (')[0])}).` : ''}</p>
      ${dh.enough ? `<p>Against its own stored history the domain read sits at the <b>${ord(dh.pct)} percentile</b> (${esc(dh.zone.toLowerCase())}) and has been in that zone for ${dayWord(dh.persist <= 1 ? 1 : Math.round((Date.parse(dh.last) - Date.parse(dh.since)) / 864e5) + 1)}${dh.dir ? `; over the past month it has been ${dh.dir}` : ''}.</p>` : ''}
      ${hi.length || lo.length ? `<p>At historical extremes of their own history: ${hi.length ? `high — ${L(hi)}` : ''}${hi.length && lo.length ? '; ' : ''}${lo.length ? `low — ${L(lo)}` : ''}. Extremes are where an indicator is most informative and also where it most often mean-reverts.</p>` : '<p>None of the scored indicators is at a historical extreme of its own history.</p>'}`;
  });
  for (const el of root.querySelectorAll('[data-ddchart]')) await defer(() => {
    const id = el.dataset.ddchart, def = DEF_BY_ID[id], h = indicatorHistory(X, id), b = h.base, fmt = fmtFor(id), r = I.readings[id];
    const inPanel = !!el.closest('.ip-box'), pw = inPanel ? { w: Math.max(560, Math.min(1000, el.clientWidth || 900)), h: 330 } : {};
    el.innerHTML = chartBlock('dd-' + id, h.pts.map((p) => [p[0], p[1]]), { fmt, base: b, h: 360, label: def.name, ...pw }, 0) + `<p class="xs dim">Every point is the engine’s own calculation for that date (daily for the last year, weekly before). Shaded band: 10th–90th percentile of the full history; dashed lines: 2.5th, 10th, median, 90th and 97.5th percentiles.</p>`;
    wireRanges(el, wc);
    const pos = root.querySelector(`[data-ddpos="${id}"]`);
    if (pos) pos.innerHTML = `<div><span class="k">Historical position</span>${b.enough ? `<b>${ord(b.pct)}</b> percentile` : '<span class="muted">not enough history</span>'}</div><div><span class="k">Historical zone</span>${b.enough ? `<b>${esc(b.zone)}</b>` : '—'}</div><div><span class="k">Engine reading</span>${r ? pill(r.state || (r.s === null ? 'Context' : 'Neutral'), r.s) : '—'}</div><div><span class="k">30-day direction</span>${b.dir ? esc(b.dir) : '—'}</div><div><span class="k">Time in zone</span>${b.enough ? esc(dayWord(Math.max(1, Math.round((Date.parse(b.last) - Date.parse(b.since)) / 864e5) + 1))) : '—'}</div><div><span class="k">Horizon</span>${esc(HZ[def.horizon])}</div>`;
    const ctxEl = root.querySelector(`[data-ddctx="${id}"]`);
    if (ctxEl) ctxEl.innerHTML = b.enough ? `${baseTable(b, fmt)}<p class="small">${esc(def.name)} is at the ${ord(b.pct)} percentile of its history since ${esc(b.first)}${ok(b.z) ? `, ${Math.abs(b.z).toFixed(1)} standard deviations ${b.z >= 0 ? 'above' : 'below'} its mean` : ''}. Readings this ${b.pct >= 50 ? 'high' : 'low'} or more extreme occurred in about ${Math.round(b.pct >= 50 ? 100 - b.pct : b.pct)}% of weeks.</p>` : `<p class="small muted">${h.pts.length ? `Only ${h.pts.length} stored observation${h.pts.length === 1 ? '' : 's'} so far (since ${esc(h.pts[0][0])}).` : 'No stored history yet.'} This indicator comes from a live snapshot whose history accumulates with each daily run; percentiles appear once there are at least eight weeks of observations.</p>`;
    const hist = root.querySelector(`[data-ddhist="${id}"]`); if (hist) hist.textContent = h.pts.length ? `${h.pts.length} points since ${h.pts[0][0]}` : 'none stored yet';
    const fw = root.querySelector(`[data-ddfwd="${id}"]`); if (fw) fw.innerHTML = fwdBlock(b);
    const it = root.querySelector(`[data-ddint="${id}"]`);
    if (it) {
      const dom = I.domains.find((x) => x.key === def.domain), others = I.domains.filter((x) => x.key !== def.domain && x.score !== null);
      const sgn = r?.s ? Math.sign(r.s) : 0, agree = sgn ? others.filter((o) => Math.sign(o.score) === sgn && Math.abs(o.score) >= 0.15) : [], against = sgn ? others.filter((o) => Math.sign(o.score) === -sgn && Math.abs(o.score) >= 0.15) : [];
      it.innerHTML = r ? `<p><b>${esc(String(r.disp))}.</b> ${esc(r.why)}${b.enough ? ` Historically this is ${esc(b.zone.toLowerCase())} (${ord(b.pct)} percentile)${b.dir ? ` and the reading is ${esc(b.dir)} over the past month` : ''}.` : ''}</p>
        <p>The engine reads it as <b>${esc((r.state || 'context').toLowerCase())}</b> on a ${esc(HZ[def.horizon].toLowerCase())} horizon. Its domain, ${esc(dom.name)}, reads ${esc(dom.state.toLowerCase())} overall.${sgn ? ` ${agree.length ? `${esc(agree.map((o) => o.name).join(', '))} ${agree.length > 1 ? 'point' : 'points'} the same way` : 'No other domain points the same way'}${against.length ? `, while ${esc(against.map((o) => o.name).join(', '))} ${against.length > 1 ? 'point' : 'points'} the other way` : ''}.` : ''}</p>
        ${b.enough && (b.pct >= 90 || b.pct <= 10) ? '<p class="small">At historical extremes an indicator carries the most information, but it can stay extreme for a long time in a trending market; check it against the other domains before drawing conclusions.</p>' : ''}` : '<p class="muted">No current reading.</p>';
    }
  });
}

// ---------------------------------------------------------------- router entry
export function analysisRoute(parts, I, ctx) {
  if (!I) return { html: '<div class="empty-state"><p>The analysis needs the published data files; it will appear once they load.</p></div>', after: () => {} };
  const [, dslug, sub] = parts, dk = SLUG_DOMAIN[dslug];
  let html, scrollTo = null;
  const ANCHORS = { drivers: 'ov-forces', regime: 'regime', history: 'history', assessment: 'regime', onchain: 'ov-chain', derivatives: 'derivatives', structure: 'ov-tech', technical: 'ov-tech', sentiment: 'ov-sent', macro: 'ov-macro', market: 'ov-mkt' };
  if (dslug === 'liquidity') html = liquidityPage(I, ctx);
  else if (!dk) { html = landing(I, ctx); scrollTo = ANCHORS[dslug] || null; }
  else if (!sub) html = domainPage(I, dk, ctx);
  else if (sub.startsWith('c-')) { const comp = DOMAIN_META.find((x) => x.key === dk) && Object.keys(DOMAIN_META.find((x) => x.key === dk).comps).find((c) => compSlug(c) === sub); html = comp ? compPage(I, dk, comp) : domainPage(I, dk, ctx); }
  else { const id = indicatorsOf(dk).find((x) => indSlug(x.id) === sub)?.id; html = id ? indPage(I, id) : domainPage(I, dk, ctx); }
  return { html, scrollTo, after: (root) => fill(root, I, ctx) };
}
export const ANALYSIS_TITLE = (parts) => { const dk = SLUG_DOMAIN[parts[1]]; return dk ? SHORT[dk] : 'Analysis'; };
