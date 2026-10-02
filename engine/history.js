// Historical queries over the persisted daily timeseries. Shared by the
// webpage (History explorer) and the CLI (agent/query.mjs).

import { pct, fmtUsd, fmtUsdSigned, fmtPrice, fmtPct, fmtNum, mean, sum } from './util.js';

const FIELDS = [
  ['price', 'BTC price', fmtPrice],
  ['depth1', '±1% depth', fmtUsd],
  ['etf5d', 'ETF 5d net', (v) => fmtUsd(v * 1e6)],
  ['etf20d', 'ETF 20d net', (v) => fmtUsd(v * 1e6)],
  ['oiTotal', 'Aggregate OI', fmtUsd],
  ['oiOkx', 'OKX OI', fmtUsd],
  ['oiPctMcap', 'OI % mcap', (v) => fmtNum(v, 2) + '%'],
  ['fundingAnn', 'Funding (ann.)', (v) => fmtNum(v, 1) + '%'],
  ['basisAnn', 'Basis (ann.)', (v) => fmtNum(v, 1) + '%'],
  ['dvol', 'DVOL', (v) => fmtNum(v, 1)],
  ['skew', '25Δ skew', (v) => fmtNum(v, 1)],
  ['rv30', '30d realised vol', (v) => fmtNum(v, 1) + '%'],
  ['corrNdx30', 'BTC–Nasdaq 30d corr', (v) => fmtNum(v, 2)],
  ['netLiq', 'Net liquidity', (v) => fmtUsd(v * 1e9)],
  ['dxy', 'Dollar', (v) => fmtNum(v, 2)],
  ['real10y', '10y real yield', (v) => fmtNum(v, 2) + '%'],
  ['hy', 'HY spread', (v) => fmtNum(v, 2) + '%'],
  ['vix', 'VIX', (v) => fmtNum(v, 1)],
  ['mvrv', 'MVRV', (v) => fmtNum(v, 2)],
  ['stables', 'Stablecoins', fmtUsd],
];

const nearest = (rows, date, dir = -1) => {
  if (dir < 0) { let b = null; for (const r of rows) if (r.date <= date) b = r; return b; }
  return rows.find((r) => r.date >= date) || null;
};

export function compareDates(rows, a, b) {
  const ra = nearest(rows, a, 1) || nearest(rows, a), rb = nearest(rows, b);
  if (!ra || !rb) return { title: `Between ${a} and ${b}`, findings: ['No stored observations cover these dates.'], table: [] };
  const table = FIELDS.map(([k, label, f]) => {
    const x = ra[k], y = rb[k];
    if ((x === null || x === undefined) && (y === null || y === undefined)) return null;
    const flow = k === 'etf5d' || k === 'etf20d';
    const ch = flow ? (x !== null && y !== null && x !== undefined && y !== undefined ? fmtUsdSigned((y - x) * 1e6) : 'n/a') : k === 'fundingAnn' || k === 'corrNdx30' || k === 'real10y' || k === 'hy' || k === 'skew' || k === 'basisAnn' ? (x !== null && y !== null && x !== undefined && y !== undefined ? `${y - x >= 0 ? '+' : ''}${fmtNum(y - x, 2)}` : 'n/a') : fmtPct(pct(y, x));
    return { metric: label, from: x === null || x === undefined ? 'n/a' : f(x), to: y === null || y === undefined ? 'n/a' : f(y), change: ch };
  }).filter(Boolean);
  const span = rows.filter((r) => r.date >= ra.date && r.date <= rb.date);
  const findings = [];
  const etfDays = new Map();
  for (const r of span) if (r.etfDate) etfDays.set(r.etfDate, r.etfLast);
  if (etfDays.size) findings.push(`ETF net flows over the window (reported days captured): ${fmtUsd(sum([...etfDays.values()]) * 1e6)} across ${etfDays.size} sessions.`);
  const moves = span.filter((r) => r.ch1d !== null && r.ch1d !== undefined).sort((x, y) => Math.abs(y.ch1d) - Math.abs(x.ch1d)).slice(0, 3);
  if (moves.length) findings.push(`Largest daily moves: ${moves.map((r) => `${r.date} ${fmtPct(r.ch1d)}`).join(', ')}.`);
  const regimes = [...new Set(span.map((r) => r.regime).filter(Boolean))];
  if (regimes.length) findings.push(`Regimes observed: ${regimes.join(' → ')}.`);
  if (span.some((r) => r.backfilled)) findings.push('Some dates are reconstructed from historical series (depth, venue OI and options are only available from the system start date).');
  return { title: `What changed between ${ra.date} and ${rb.date}`, findings, table };
}

export function findSelloffs(rows, thresholdPct = 15, windowDays = 14) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const peak = rows[i];
    if (!peak.price) continue;
    const win = rows.slice(i + 1, i + 1 + windowDays);
    const trough = win.reduce((m, r) => (r.price && (!m || r.price < m.price) ? r : m), null);
    if (!trough) continue;
    const dd = pct(trough.price, peak.price);
    if (dd <= -thresholdPct && !out.some((o) => o.trough.date === trough.date)) out.push({ peak, trough, dd });
  }
  // keep the deepest per trough cluster
  const dedup = [];
  for (const o of out.sort((a, b) => a.dd - b.dd)) if (!dedup.some((d) => Math.abs(new Date(d.trough.date) - new Date(o.trough.date)) < 20 * 864e5)) dedup.push(o);
  return dedup.sort((a, b) => (a.peak.date < b.peak.date ? 1 : -1));
}

export function precededSelloff(rows, thresholdPct = 15) {
  const s = findSelloffs(rows, thresholdPct)[0];
  if (!s) return { title: `No ≥${thresholdPct}% selloff (within 14 days) in stored history`, findings: [], table: [] };
  const pre = rows.filter((r) => r.date < s.peak.date).slice(-14);
  const first = pre[0], last = s.peak;
  const findings = [`Peak ${s.peak.date} ${fmtPrice(s.peak.price)} → trough ${s.trough.date} ${fmtPrice(s.trough.price)} (${fmtPct(s.dd)}).`];
  const tr = (k, label, f) => { const a = first?.[k], b = last?.[k]; if (a === null || a === undefined || b === null || b === undefined) return; findings.push(`${label} in the 14 days before the peak: ${f(a)} → ${f(b)}.`); };
  tr('etf5d', 'ETF 5-day net', (v) => fmtUsd(v * 1e6));
  tr('fundingAnn', 'Funding', (v) => fmtNum(v, 1) + '%');
  tr('oiOkx', 'OKX OI', fmtUsd);
  tr('oiTotal', 'Aggregate OI', fmtUsd);
  tr('depth1', '±1% depth', fmtUsd);
  tr('dvol', 'DVOL', (v) => fmtNum(v, 1));
  tr('corrNdx30', 'BTC–Nasdaq correlation', (v) => fmtNum(v, 2));
  tr('real10y', '10y real yield', (v) => fmtNum(v, 2) + '%');
  const during = rows.filter((r) => r.date > s.peak.date && r.date <= s.trough.date);
  const etf = new Map(); during.forEach((r) => r.etfDate && etf.set(r.etfDate, r.etfLast));
  if (etf.size) findings.push(`ETF flows during the decline: ${fmtUsd(sum([...etf.values()]) * 1e6)}.`);
  return { title: 'What preceded the last major selloff', findings, table: compareDates(rows, first?.date || s.peak.date, s.trough.date).table };
}

function runs(rows, pred) {
  const out = [];
  let start = null;
  rows.forEach((r, i) => {
    const ok = pred(r, i);
    if (ok && start === null) start = i;
    if (!ok && start !== null) { out.push([rows[start], rows[i - 1]]); start = null; }
  });
  if (start !== null) out.push([rows[start], rows.at(-1)]);
  return out;
}

export function whenLiquidityDeteriorated(rows) {
  const d = rows.filter((r) => r.depth1);
  if (d.length < 8) return { title: 'When did liquidity begin deteriorating?', findings: [`Only ${d.length} days of order-book depth stored; depth history begins with the first live run and cannot be backfilled from free sources.`], table: [] };
  const r = runs(d, (x, i) => i >= 7 && d[i - 7].depthVenues === x.depthVenues && pct(x.depth1, d[i - 7].depth1) < -15);
  return { title: 'When did liquidity begin deteriorating?', findings: r.length ? r.slice(-5).reverse().map(([a, b]) => `${a.date} → ${b.date}: ±1% depth fell >15% vs a week earlier (${fmtUsd(a.depth1)} → ${fmtUsd(b.depth1)}).`) : ['No week-over-week depth decline >15% in stored history.'], table: [] };
}

export function whenEtfTurned(rows) {
  const e = rows.filter((r) => r.etf5d !== null && r.etf5d !== undefined);
  const out = [];
  for (let i = 1; i < e.length; i++) if (Math.sign(e[i].etf5d) !== Math.sign(e[i - 1].etf5d) && Math.abs(e[i].etf5d) > 100) out.push(e[i]);
  return { title: 'When did ETF flows turn?', findings: out.length ? out.slice(-8).reverse().map((r) => `${r.date}: 5-day net flipped to ${r.etf5d > 0 ? 'inflows' : 'outflows'} (${fmtUsd(r.etf5d * 1e6)}).`) : ['No sign change of 5-day ETF net flows (>$100M) in stored history.'], table: [] };
}

export function whenFundingExtreme(rows, hi = 30, lo = -5) {
  const r = runs(rows.filter((x) => x.fundingAnn !== null && x.fundingAnn !== undefined), (x) => x.fundingAnn > hi || x.fundingAnn < lo);
  return { title: 'When did funding become extreme?', findings: r.length ? r.slice(-8).reverse().map(([a, b]) => `${a.date} → ${b.date}: funding ${a.fundingAnn > 0 ? 'above +' + hi : 'below ' + lo}% annualised (start ${fmtNum(a.fundingAnn, 1)}%).`) : [`No days with funding above ${hi}% or below ${lo}% annualised in stored history.`], table: [] };
}

export function whenOiRising(rows) {
  const k = rows.some((r) => r.oiTotal) && rows.filter((r) => r.oiTotal).length > 14 ? 'oiTotal' : 'oiOkx';
  const d = rows.filter((r) => r[k]);
  const r = runs(d, (x, i) => i >= 7 && pct(x[k], d[i - 7][k]) > 8);
  return { title: 'When did open interest begin increasing?', findings: r.length ? r.slice(-6).reverse().map(([a, b]) => `${a.date} → ${b.date}: ${k === 'oiOkx' ? 'OKX' : 'aggregate'} OI rising >8% week-over-week (${fmtUsd(a[k])} → ${fmtUsd(b[k])}).`) : ['No sustained OI build (>8% w/w) in stored history.'], table: [] };
}

export function whenDecoupled(rows) {
  const c = rows.filter((r) => r.corrNdx30 !== null && r.corrNdx30 !== undefined);
  const out = [];
  for (let i = 30; i < c.length; i++) {
    const prevMax = Math.max(...c.slice(i - 30, i).map((r) => r.corrNdx30));
    if (c[i].corrNdx30 < 0.15 && prevMax > 0.4 && !(c[i - 1].corrNdx30 < 0.15)) out.push({ r: c[i], prevMax });
  }
  return { title: 'When did BTC decouple from the Nasdaq?', findings: out.length ? out.slice(-6).reverse().map(({ r, prevMax }) => `${r.date}: 30-day correlation fell to ${fmtNum(r.corrNdx30, 2)} from ${fmtNum(prevMax, 2)} within the prior month.`) : ['No decoupling episode (corr from >0.4 to <0.15 within 30 days) in stored history.'], table: [] };
}

export const QUERIES = {
  between: { label: 'What changed between two dates?', run: (rows, a, b) => compareDates(rows, a, b), needsDates: true },
  selloff: { label: 'What preceded the last major selloff?', run: (rows) => precededSelloff(rows) },
  liquidity: { label: 'When did liquidity begin deteriorating?', run: whenLiquidityDeteriorated },
  etf: { label: 'When did ETF flows turn?', run: whenEtfTurned },
  funding: { label: 'When did funding become extreme?', run: (rows) => whenFundingExtreme(rows) },
  oi: { label: 'When did open interest begin increasing?', run: whenOiRising },
  decouple: { label: 'When did BTC decouple from the Nasdaq?', run: whenDecoupled },
};
