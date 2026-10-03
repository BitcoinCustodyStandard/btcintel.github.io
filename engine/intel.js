// BTCIntel Market Intelligence Engine.
//
//   Raw data → Indicators → Interpretation → Five domains → Market forces
//   → Market read (state, breadth, Fair Grade, drivers, offsets) → Valuation & cycle
//   conclusions → Intelligence narrative.
//
// Built only on the free data the site already publishes (data/latest.json, timeseries.json,
// pi_cycle.json, dash.json, etf_flows.json). Pure functions: the browser and the daily agent
// get the same answer from the same files.
//
// Rules of the engine
//  - Each indicator is interpreted on its own, against fixed published thresholds and its own
//    history: supportive, neutral, cautionary or deteriorating. Nothing is filled in.
//  - Indicators combine only with like indicators (inside a component); components combine
//    into a domain by explicit weights and override rules. There is no grand average.
//  - Cycle and valuation are conclusions drawn from all five domains, not a sixth input.
//  - Every conclusion keeps its evidence, a time horizon and a confidence built from data
//    coverage, freshness and agreement.
//  - The engine can be evaluated "as of" any earlier date from stored history, so changes
//    over 2, 7 and 30 days compare like with like (only indicators known on both dates).
//  - No price targets and no probabilities. The Fair Grade scores the configuration of the
//    market today; it is not a forecast.

import { mean, std, pct, percentileRank, clamp, shiftDate } from './util.js';

export const INTEL_VERSION = '1.0.0';
const DAYMS = 864e5;

// ---------------------------------------------------------------------------
// series helpers: every series is [[YYYY-MM-DD, value], …] sorted ascending
const dd = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAYMS);
function idx(s, d) { let lo = 0, hi = s.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m][0] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
const pt = (s, d) => { if (!s?.length) return null; const i = idx(s, d); return i < 0 ? null : s[i]; };
const vals = (s, d, n) => { if (!s?.length) return []; const i = idx(s, d); return i < 0 ? [] : s.slice(Math.max(0, i - n + 1), i + 1).map((r) => r[1]); };
const ago = (s, d, n) => pt(s, shiftDate(d, -n))?.[1] ?? null;
const ok = (v) => v !== null && v !== undefined && Number.isFinite(v);
const clean = (s) => (s || []).filter((r) => r && r[0] && ok(r[1])).sort((a, b) => (a[0] < b[0] ? -1 : 1));
// piecewise-linear map of x through [[x, y], …]
function interp(t, x) { if (!ok(x)) return null; if (x <= t[0][0]) return t[0][1]; for (let i = 1; i < t.length; i++) if (x <= t[i][0]) { const [x0, y0] = t[i - 1], [x1, y1] = t[i]; return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); } return t.at(-1)[1]; }
const ramp = (x, scale) => (ok(x) ? clamp(x / scale, -1, 1) : null);

// technical maths on daily closes
const sma = (a, n) => (a.length >= n ? mean(a.slice(-n)) : null);
function emaArr(a, n) { const k = 2 / (n + 1), out = []; let e = null; for (const x of a) { e = e === null ? x : x * k + e * (1 - k); out.push(e); } return out; }
function rsi(a, n = 14) {
  if (a.length < n + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const c = a[i] - a[i - 1]; if (c > 0) g += c; else l -= c; }
  g /= n; l /= n;
  for (let i = n + 1; i < a.length; i++) { const c = a[i] - a[i - 1]; g = (g * (n - 1) + Math.max(c, 0)) / n; l = (l * (n - 1) + Math.max(-c, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
function macd(a) {
  if (a.length < 60) return null;
  const e12 = emaArr(a, 12), e26 = emaArr(a, 26), line = e12.map((x, i) => x - e26[i]), sig = emaArr(line.slice(26), 9);
  return { line: line.at(-1), signal: sig.at(-1), hist: line.at(-1) - sig.at(-1) };
}
const rvol = (a, n) => { if (a.length <= n) return null; const w = a.slice(-(n + 1)), r = w.slice(1).map((x, i) => Math.log(x / w[i])); return std(r) * Math.sqrt(365) * 100; };
function boll(a, n = 20) { if (a.length < n) return null; const w = a.slice(-n), m = mean(w), sd = Math.sqrt(mean(w.map((x) => (x - m) ** 2))); return { mid: m, up: m + 2 * sd, lo: m - 2 * sd, width: ((4 * sd) / m) * 100, z: sd ? (a.at(-1) - m) / sd : 0 }; }

// formatting (kept local so the engine has no UI dependencies)
const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '');
const f = (v, dp = 1) => (ok(v) ? Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '—');
const fs = (v, dp = 1) => (ok(v) ? sgn(v) + f(v, dp) : '—');
const pc = (v, dp = 1) => (ok(v) ? fs(v, dp) + '%' : '—');
const usd = (v) => (ok(v) ? '$' + Math.round(v).toLocaleString('en-US') : '—');
const big = (v) => { if (!ok(v)) return '—'; const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e12 ? `${s}$${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${s}$${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(0)}M` : `${s}$${Math.round(a).toLocaleString('en-US')}`; };
const ord = (n) => { const r = Math.round(n), s = ['th', 'st', 'nd', 'rd'], v = r % 100; return r + (s[(v - 20) % 10] || s[v] || s[0]); };
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const joinAnd = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] || '');

// ---------------------------------------------------------------------------
// INPUTS: normalise the published files into dated series + today's snapshot values
export function buildInputs({ a, rows = [], pi = null, dash = null, etf = null, live = null } = {}) {
  const M = a?.metrics || {};
  const today = String(a?.dataThrough || new Date().toISOString()).slice(0, 10);
  const ser = (k) => clean(rows.map((r) => [r.date, r[k]]));
  // daily closes: full Coin Metrics history (pi_cycle.json), then stored rows, then today's spot
  const close = pi?.rows?.length ? clean(pi.rows.map((r) => [r[0], r[1]])) : ser('price');
  for (const [d, v] of ser('price')) if (!close.length || d > close.at(-1)[0]) close.push([d, v]);
  const spot = live?.price ?? M.price?.spot ?? null;
  if (ok(spot) && close.length) { if (close.at(-1)[0] === today) close[close.length - 1] = [today, spot]; else if (close.at(-1)[0] < today) close.push([today, spot]); }
  let run = 0; const ath = close.map(([d, v]) => [d, (run = Math.max(run, v))]);
  // MVRV: weekly since 2010 for history, then daily from the stored rows
  const ch = a?.cycle?.charts || {};
  const mvrv = clean(ch.mvrv);
  for (const [d, v] of ser('mvrv')) { const i = idx(mvrv, d); if (i >= 0 && mvrv[i][0] === d) mvrv[i] = [d, v]; else if (!mvrv.length || d > mvrv.at(-1)[0]) mvrv.push([d, v]); }
  // ETF daily net flows (US$m): Farside series kept by the agent
  const em = new Map();
  for (const [d, v] of M.etf?.series20 || []) if (ok(v)) em.set(d, v);
  for (const r of etf?.rows || []) if (ok(r.total)) em.set(r.date, r.total);
  const act = dash?.activity, col = (n) => (act?.rows ? clean(act.rows.map((r) => [r[0], r[act.cols.indexOf(n)]])) : []);
  const fl = dash?.flows?.rows || [];
  const dist = dash?.distribution?.history || [];
  const X = {
    today, spot, M, a, dash, live,
    close, ath,
    volume: clean(dash?.volume?.rows),
    mvrv, puell: clean(ch.puell), sopr: clean(ch.sopr), profit: clean(ch.profit),
    sth: clean(dash?.cohorts?.sth), lth: clean(dash?.cohorts?.lth),
    exnet: clean(fl.map((r) => [r[0], r[1] - r[2]])), exbal: clean(fl.map((r) => [r[0], r[3]])),
    active: col('active'), tx: col('tx'), fees: col('feesBtc'),
    hashprice: clean(dash?.hashpower?.daily?.map((r) => [r[0], r[1]])),
    stables: ser('stables'),
    etf: [...em.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)),
    funding: ser('fundingAnn'), oi: ser('oiOkx'), dvol: ser('dvol'), basis: ser('basisAnn'), cbp: ser('cbPremium'), dom: ser('dominance'),
    fng: clean(dash?.fng?.series),
    dxy: ser('dxy'), real10y: ser('real10y'), us10y: ser('us10y'), hy: ser('hy'), vix: ser('vix'), ndx: ser('ndx'), gold: ser('gold'), netLiq: ser('netLiq'), corrNdx: ser('corrNdx30'),
    wiki: clean(dash?.attention?.rows),
    whales: clean(dist.map((h) => [h.date, (h.c?.whale?.[1] ?? NaN) + (h.c?.humpback?.[1] ?? NaN)])),
    _c: {},
  };
  return X;
}

// ---------------------------------------------------------------------------
// LAYER 2 helpers: per-date technical bundle (cached)
function techAt(X, d) {
  const key = 't' + d;
  if (key in X._c) return X._c[key];
  const P = pt(X.close, d);
  if (!P || dd(P[0], d) > 3) return (X._c[key] = null);
  const C = vals(X.close, d, 430), p = C.at(-1);
  if (C.length < 220) return (X._c[key] = null);
  const t = { p, asOf: P[0], C, ma20: sma(C, 20), ma50: sma(C, 50), ma100: sma(C, 100), ma200: sma(C, 200), ma200p: sma(C.slice(0, -30), 200), rsi: rsi(C.slice(-250)), macd: macd(C.slice(-250)), bb: boll(C), rv30: rvol(C, 30), rv365: rvol(C, 365) };
  const rvS = [], bwS = [];
  for (let i = Math.max(40, C.length - 365); i <= C.length; i += 3) { const s = C.slice(Math.max(0, i - 40), i); rvS.push(rvol(s, 30)); bwS.push(boll(s).width); }
  t.rvPct = percentileRank(t.rv30, rvS); t.bwPct = percentileRank(t.bb.width, bwS);
  const c15 = C.slice(-15); t.atr = (mean(c15.slice(1).map((x, i) => Math.abs(x - c15[i]))) / p) * 100;
  t.roc7 = pct(p, C.at(-8)); t.roc30 = pct(p, C.at(-31)); t.roc90 = pct(p, C.at(-91));
  const l30 = C.slice(-30), p30 = C.slice(-60, -30);
  t.hh = Math.max(...l30) > Math.max(...p30); t.hl = Math.min(...l30) > Math.min(...p30);
  const c90 = C.slice(-90); t.hi90 = Math.max(...c90); t.lo90 = Math.min(...c90); t.rangePos = (p - t.lo90) / (t.hi90 - t.lo90 || 1);
  t.ath = pt(X.ath, d)?.[1] ?? null; t.dd = t.ath ? pct(p, t.ath) : null;
  const W = vals(X.close, d, 1400); t.ma200w = W.length >= 1400 ? mean(W) : null;
  // swing levels from the last 180 days: local extremes over ±7 days
  const c180 = C.slice(-180), lv = [];
  for (let i = 7; i < c180.length - 7; i++) { const w = c180.slice(i - 7, i + 8); if (c180[i] === Math.max(...w) || c180[i] === Math.min(...w)) lv.push(c180[i]); }
  t.res = lv.filter((x) => x > p * 1.005).sort((x, y) => x - y)[0] ?? null;
  t.sup = lv.filter((x) => x < p * 0.995).sort((x, y) => y - x)[0] ?? null;
  const V = vals(X.volume, d, 30); t.volRatio = V.length >= 30 ? mean(V.slice(-7)) / mean(V) : null; t.volAsOf = pt(X.volume, d)?.[0] ?? null;
  return (X._c[key] = t);
}

// ---------------------------------------------------------------------------
// LAYER 2–3: indicators and their interpretation
// Each definition: id, name, domain, component, horizon, weight, expected update interval
// (days), source, and calc(X, d, isToday) → { v, disp, s, why, asOf } (s ∈ [−1, 1], or null
// for context-only readings). Current-only inputs (order books, options surface, news…) are
// known only for today, so they never enter an "as of" comparison.
const DOMAINS = [
  { key: 'tech', name: 'Technical', question: 'What are price structure, trend, momentum and volatility telling us?', comps: { Trend: 0.35, Momentum: 0.25, Structure: 0.2, Extension: 0.1, Volatility: 0.1 } },
  { key: 'chain', name: 'On-chain', question: 'What are the Bitcoin network and its holders telling us?', comps: { Valuation: 0.22, 'Holder behaviour': 0.25, 'Exchange behaviour': 0.15, 'On-chain liquidity': 0.15, 'Network activity': 0.15, 'Supply dynamics': 0.08 } },
  { key: 'mkt', name: 'Market structure', question: 'What is capital doing and how is the market positioned?', comps: { 'Institutional demand': 0.3, 'Spot demand': 0.2, Leverage: 0.2, Derivatives: 0.15, 'Market positioning': 0.1, 'Crypto market structure': 0.05 } },
  { key: 'sent', name: 'Sentiment', question: 'What does the market believe, fear, search for and discuss?', comps: { 'Fear & Greed': 0.45, News: 0.2, 'Retail attention': 0.25, Narrative: 0.1 } },
  { key: 'macro', name: 'Macro & liquidity', question: 'What financial environment is Bitcoin operating in?', comps: { Liquidity: 0.3, Rates: 0.2, Dollar: 0.2, 'Risk appetite': 0.2, 'Monetary regime': 0.1 } },
];
export const DOMAIN_META = DOMAINS;
// words for a component's state: [positive, neutral, negative]
const VOCAB = {
  Extension: ['Not extended', 'Moderate', 'Stretched'], Volatility: ['Calm', 'Normal', 'Elevated'], Valuation: ['Attractive', 'Fair', 'Expensive'],
  Leverage: ['Healthy', 'Moderate', 'Elevated'], Derivatives: ['Calm', 'Neutral', 'Stressed'], 'Fear & Greed': ['Supportive', 'Neutral', 'Crowded'],
};
// gaps we will not paper over: listed on the Analysis page
export const UNAVAILABLE = {
  tech: [],
  chain: ['MVRV Z-Score (needs the market-cap history in the free tier)', 'NVT and NVT Signal (transfer value is not on the Coin Metrics free tier)', 'Adjusted SOPR, RHODL, HODL waves, dormancy, coin days destroyed', 'Long-/short-term holder supply (only their cost bases are free)', 'Stablecoin exchange balances and netflows', 'Miner selling pressure'],
  mkt: ['Spot CVD across venues', 'Dealer gamma positioning (modelled only on the Liquidity page)', 'Options term structure beyond Deribit'],
  sent: ['Google Trends (no free API; Wikipedia pageviews used instead)', 'Reddit and X sentiment (no reliable free source)'],
  macro: ['PMI (ISM data is not free)', 'Global M2 (US M2 and the Fed/ECB/BoJ balance sheets used instead)', 'Fed-funds futures (the 2-year yield is used as the rate-expectations proxy)'],
};

const SRC = {
  px: 'Coin Metrics daily closes + live spot', vol: 'CoinGecko aggregate spot volume', cm: 'Coin Metrics Community', bg: 'BGeometrics (free tier)', cyc: 'Coin Metrics, derived (On-chain cycle)',
  fl: 'Coin Metrics exchange flows', act: 'Coin Metrics Community (activity)', hp: 'CloudMineCrypto hashprice', ll: 'DefiLlama stablecoins', fs: 'Farside Investors ETF flows',
  okx: 'OKX public API', der: 'Deribit (options)', drv: 'Exchange APIs (OKX, Binance, Bybit, Deribit…)', cg: 'CoinGecko', book: 'Exchange order books', cftc: 'CFTC Commitments of Traders',
  fng: 'alternative.me Fear & Greed', news: 'Public RSS headlines (keyword tags)', wiki: 'Wikimedia pageviews', pm: 'Polymarket (market-implied)', fred: 'FRED', yh: 'Yahoo Finance / FRED',
  et: 'Yahoo Finance ETF quotes', tr: 'BitcoinTreasuries', dist: 'BitInfoCharts rich list',
};
const DEFS = [];
const def = (id, name, domain, comp, horizon, w, freq, src, calc, o = {}) => DEFS.push({ id, name, domain, comp, horizon, w, freq, src, calc, ...o });

// ---- TECHNICAL ---------------------------------------------------------------
def('t_ma200', 'Price vs 200-day average', 'tech', 'Trend', 'long', 1.2, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!t?.ma200) return null; const x = (t.p / t.ma200 - 1) * 100; return { v: x, disp: `${pc(x, 0)} (200-day ${usd(t.ma200)})`, s: interp([[-15, -1], [-3, -0.4], [0, 0], [3, 0.4], [12, 0.9], [25, 1]], x), why: x >= 0 ? 'Price holds above its long-term average.' : 'Price trades below its long-term average.', asOf: t.asOf }; });
def('t_ma50_200', '50-day vs 200-day average', 'tech', 'Trend', 'medium', 1, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!t?.ma50 || !t.ma200) return null; const x = (t.ma50 / t.ma200 - 1) * 100; return { v: x, disp: `${pc(x, 1)} (${usd(t.ma50)} vs ${usd(t.ma200)})`, s: ramp(x, 6), why: x >= 0 ? 'The medium-term average sits above the long-term one (trend structure positive).' : 'The medium-term average sits below the long-term one.', asOf: t.asOf }; });
def('t_slope200', '200-day average, 30-day slope', 'tech', 'Trend', 'long', 0.9, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!t?.ma200p) return null; const x = (t.ma200 / t.ma200p - 1) * 100; return { v: x, disp: pc(x, 1), s: ramp(x, 3), why: x > 0.5 ? 'The long-term average is rising.' : x < -0.5 ? 'The long-term average is falling.' : 'The long-term average is flat.', asOf: t.asOf }; });
def('t_ma20_50', '20-day vs 50-day average', 'tech', 'Trend', 'short', 0.6, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!t?.ma20) return null; const x = (t.ma20 / t.ma50 - 1) * 100; return { v: x, disp: `${pc(x, 1)} (20-day ${usd(t.ma20)})`, s: ramp(x, 4), why: x >= 0 ? 'Short-term trend points up.' : 'Short-term trend points down.', asOf: t.asOf }; });
def('t_ma100', 'Price vs 100-day average', 'tech', 'Trend', 'medium', 0.5, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!t?.ma100) return null; const x = (t.p / t.ma100 - 1) * 100; return { v: x, disp: `${pc(x, 0)} (100-day ${usd(t.ma100)})`, s: ramp(x, 10), why: 'Medium-term trend check.', asOf: t.asOf }; });
def('t_rsi', 'RSI (14-day)', 'tech', 'Momentum', 'short', 0.8, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!ok(t?.rsi)) return null; return { v: t.rsi, disp: f(t.rsi, 0), s: interp([[30, -0.8], [45, -0.2], [50, 0], [60, 0.5], [70, 0.7], [80, 0.4]], t.rsi), why: t.rsi >= 70 ? 'Strong momentum, near overbought.' : t.rsi <= 30 ? 'Weak momentum, near oversold.' : t.rsi >= 50 ? 'Momentum leans positive.' : 'Momentum leans negative.', asOf: t.asOf }; });
def('t_macd', 'MACD (12, 26, 9)', 'tech', 'Momentum', 'short', 0.8, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!t?.macd) return null; const m = t.macd, rel = (m.line / t.p) * 100, h = (m.hist / t.p) * 100; return { v: rel, disp: `${fs(m.line, 0)} line, histogram ${fs(m.hist, 0)}`, s: clamp(ramp(rel, 3) * 0.6 + ramp(h, 0.8) * 0.4, -1, 1), why: `${m.line >= 0 ? 'Above' : 'Below'} zero, ${m.hist >= 0 ? 'above' : 'below'} its signal line.`, asOf: t.asOf }; });
def('t_roc30', 'Rate of change, 30 days', 'tech', 'Momentum', 'medium', 0.8, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!ok(t?.roc30)) return null; return { v: t.roc30, disp: pc(t.roc30), s: ramp(t.roc30, 15), why: 'One-month price momentum.', asOf: t.asOf }; });
def('t_roc90', 'Rate of change, 90 days', 'tech', 'Momentum', 'medium', 0.6, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!ok(t?.roc90)) return null; return { v: t.roc90, disp: pc(t.roc90), s: ramp(t.roc90, 30), why: 'Three-month price momentum.', asOf: t.asOf }; });
def('t_volume', 'Volume trend (7d vs 30d)', 'tech', 'Momentum', 'short', 0.4, 2, SRC.vol, (X, d) => { const t = techAt(X, d); if (!ok(t?.volRatio) || !ok(t.roc7)) return null; const r = t.volRatio; return { v: r, disp: `${f(r, 2)}× · price ${pc(t.roc7)} over 7 days`, s: clamp(ramp(r - 1, 0.4) * Math.sign(t.roc7) * 0.6, -1, 1), why: r > 1.15 ? (t.roc7 >= 0 ? 'Rising volume confirms the up-move.' : 'Rising volume on a down-move.') : r < 0.85 ? 'Volume is fading.' : 'Volume is steady.', asOf: t.volAsOf }; });
def('t_hhhl', 'Highs and lows (30d vs prior 30d)', 'tech', 'Structure', 'medium', 1, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!t) return null; const s = t.hh && t.hl ? 1 : !t.hh && !t.hl ? -1 : 0; return { v: s, disp: `${t.hh ? 'Higher' : 'Lower'} high, ${t.hl ? 'higher' : 'lower'} low`, s: s * 0.8, why: s > 0 ? 'Higher highs and higher lows: an orderly advance.' : s < 0 ? 'Lower highs and lower lows: a downtrend structure.' : 'Mixed structure: range-bound.', asOf: t.asOf }; });
def('t_range', 'Position in the 90-day range', 'tech', 'Structure', 'short', 0.6, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!t) return null; const x = t.rangePos * 100; return { v: x, disp: `${f(x, 0)}% (${usd(t.lo90)} – ${usd(t.hi90)})`, s: interp([[10, -0.7], [35, -0.2], [50, 0], [65, 0.2], [90, 0.6]], x), why: x >= 65 ? 'Trading in the upper part of its recent range.' : x <= 35 ? 'Trading in the lower part of its recent range.' : 'Mid-range.', asOf: t.asOf }; });
def('t_dd', 'Drawdown from all-time high', 'tech', 'Structure', 'long', 0.6, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!ok(t?.dd)) return null; return { v: t.dd, disp: `${pc(t.dd, 0)} (ATH ${usd(t.ath)})`, s: interp([[-60, -0.7], [-35, -0.35], [-20, -0.1], [-10, 0.2], [0, 0.4]], t.dd), why: t.dd > -10 ? 'Near the all-time high.' : t.dd > -25 ? 'A moderate distance below the high.' : 'Well below the all-time high: structure still repairing.', asOf: t.asOf }; });
def('t_levels', 'Nearest swing support / resistance', 'tech', 'Structure', 'short', 0, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!t || (!t.sup && !t.res)) return null; return { v: t.sup, disp: `support ${t.sup ? usd(t.sup) + ` (${pc((t.sup / t.p - 1) * 100, 1)})` : '—'} · resistance ${t.res ? usd(t.res) + ` (${pc((t.res / t.p - 1) * 100, 1)})` : '—'}`, s: null, why: 'Recent turning points in daily closes (context, not scored).', asOf: t.asOf }; });
def('t_mayer', 'Mayer Multiple (price ÷ 200-day)', 'tech', 'Extension', 'medium', 1, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!t?.ma200) return null; const x = t.p / t.ma200; return { v: x, disp: f(x, 2), s: interp([[0.7, 0.6], [1.0, 0.3], [1.25, 0], [1.5, -0.4], [2.0, -0.8], [2.4, -1]], x), why: x >= 1.5 ? 'Price is far above its long-term average: extended.' : x < 1 ? 'Price is below its long-term average: not extended.' : 'Normal distance from the long-term average.', asOf: t.asOf }; });
def('t_bbz', 'Distance from 20-day mean (σ)', 'tech', 'Extension', 'short', 0.7, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!t?.bb) return null; const z = t.bb.z; return { v: z, disp: `${fs(z, 1)}σ (bands ${usd(t.bb.lo)} – ${usd(t.bb.up)})`, s: interp([[-2.5, 0.4], [-1, 0.1], [0, 0], [1.5, -0.1], [2.2, -0.6], [3, -1]], z), why: z >= 2 ? 'At or above the upper Bollinger band: short-term stretched.' : z <= -2 ? 'At or below the lower band: short-term washed out.' : 'Inside the Bollinger bands.', asOf: t.asOf }; });
def('t_rsiext', 'RSI extremes', 'tech', 'Extension', 'short', 0.5, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!ok(t?.rsi)) return null; return { v: t.rsi, disp: f(t.rsi, 0), s: interp([[20, 0.5], [30, 0.2], [40, 0], [68, 0], [75, -0.5], [85, -1]], t.rsi), why: t.rsi >= 72 ? 'Overbought territory.' : t.rsi <= 30 ? 'Oversold territory.' : 'No extreme.', asOf: t.asOf }; });
def('t_rv', 'Realised volatility (30d, annualised)', 'tech', 'Volatility', 'short', 1, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!ok(t?.rv30)) return null; return { v: t.rv30, disp: `${f(t.rv30, 0)}% · ${ord(t.rvPct)} percentile of the past year`, s: interp([[10, 0.2], [60, 0.1], [80, -0.3], [95, -0.8]], t.rvPct), why: t.rvPct >= 80 ? 'Volatility is high for the past year: moves are disorderly.' : t.rvPct <= 20 ? 'Volatility is unusually low.' : 'Volatility is in its normal range.', asOf: t.asOf, pctile: t.rvPct }; });
def('t_bbw', 'Bollinger Band width', 'tech', 'Volatility', 'short', 0.6, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!t?.bb) return null; return { v: t.bb.width, disp: `${f(t.bb.width, 1)}% · ${ord(t.bwPct)} percentile`, s: interp([[15, 0], [70, 0.05], [90, -0.4]], t.bwPct), why: t.bwPct <= 15 ? 'Bands are compressed: a larger move often follows (direction unknown).' : t.bwPct >= 85 ? 'Bands are very wide after a large move.' : 'Normal band width.', asOf: t.asOf, pctile: t.bwPct }; });
def('t_atr', 'Average daily move (14d, close-to-close ATR)', 'tech', 'Volatility', 'short', 0.3, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!ok(t?.atr)) return null; return { v: t.atr, disp: `${f(t.atr, 2)}% a day`, s: interp([[1.5, 0.1], [3, 0], [4.5, -0.4], [6, -0.8]], t.atr), why: 'Typical daily swing (computed from closes; intraday highs and lows are not in the free data).', asOf: t.asOf }; });
def('t_hv', 'Historical volatility (1 year)', 'tech', 'Volatility', 'long', 0, 1, SRC.px, (X, d) => { const t = techAt(X, d); if (!ok(t?.rv365)) return null; return { v: t.rv365, disp: `${f(t.rv365, 0)}% annualised`, s: null, why: 'Baseline volatility for comparison (context).', asOf: t.asOf }; });

// ---- ON-CHAIN ----------------------------------------------------------------
const pAt = (X, d) => techAt(X, d)?.p ?? pt(X.close, d)?.[1] ?? null;
const sAt = (X, k, d, maxAge) => { const r = pt(X[k], d); return r && dd(r[0], d) <= maxAge ? r : null; };
def('c_mvrv', 'MVRV ratio', 'chain', 'Valuation', 'long', 1.4, 2, SRC.cm, (X, d) => { const r = sAt(X, 'mvrv', d, 10); if (!r) return null; const v = r[1], hist = X.mvrv.filter((x) => x[0] <= d).map((x) => x[1]), p = percentileRank(v, hist); return { v, disp: `${f(v, 2)} · ${ord(p)} percentile since 2010`, s: interp([[0.8, 1], [1.2, 0.7], [1.6, 0.2], [2.0, 0], [2.4, -0.3], [3.2, -0.8], [3.8, -1]], v), why: v < 1 ? 'Price is below the average holder cost basis: historically deep value.' : v < 1.6 ? 'Holders sit on modest unrealised gains: not expensive.' : v < 2.4 ? 'Mid-cycle valuation.' : 'Holders sit on large unrealised gains: historically expensive.', asOf: r[0], pctile: p }; });
def('c_realized', 'Realised price (average cost basis)', 'chain', 'Valuation', 'long', 0, 2, SRC.cm, (X, d) => { const r = sAt(X, 'mvrv', d, 10), p = pAt(X, d); if (!r || !p) return null; const rp = p / r[1]; return { v: rp, disp: `${usd(rp)} (price ${pc((p / rp - 1) * 100, 0)} above)`, s: null, why: 'What all coins last moved at, on average (same information as MVRV; context).', asOf: r[0] }; });
def('c_nupl', 'NUPL (net unrealised profit/loss)', 'chain', 'Valuation', 'long', 0, 2, SRC.cm, (X, d) => { const r = sAt(X, 'mvrv', d, 10); if (!r) return null; const v = 1 - 1 / r[1]; return { v, disp: `${f(v, 2)} (${v < 0 ? 'capitulation' : v < 0.25 ? 'hope / fear' : v < 0.5 ? 'optimism / anxiety' : v < 0.75 ? 'belief / denial' : 'euphoria / greed'})`, s: null, why: 'Derived exactly from MVRV, so shown for context and not scored twice.', asOf: r[0] }; });
def('c_puell', 'Puell Multiple', 'chain', 'Valuation', 'long', 0.7, 3, SRC.cyc, (X, d) => { const r = sAt(X, 'puell', d, 10); if (!r) return null; return { v: r[1], disp: f(r[1], 2), s: interp([[0.5, 0.8], [0.8, 0.3], [1.2, 0], [1.6, -0.3], [2.5, -0.8], [3.5, -1]], r[1]), why: r[1] < 0.8 ? 'Miner revenue is low versus its yearly average (historically cheap).' : r[1] > 1.6 ? 'Miner revenue is high versus its yearly average.' : 'Miner revenue is near its yearly average.', asOf: r[0] }; });
def('c_sth', 'Price vs short-term holder cost basis', 'chain', 'Holder behaviour', 'medium', 1.2, 7, SRC.bg, (X, d) => { const r = sAt(X, 'sth', d, 14), p = pAt(X, d); if (!r || !p) return null; const x = (p / r[1] - 1) * 100; return { v: x, disp: `${pc(x, 0)} (STH realised ${usd(r[1])})`, s: interp([[-20, -1], [-5, -0.4], [0, 0], [8, 0.5], [30, 0.6], [60, -0.2]], x), why: x >= 0 ? 'Recent buyers are in profit on average, so dips tend to meet support near their cost.' : 'Recent buyers are underwater on average, so rallies meet break-even selling.', asOf: r[0] }; });
def('c_lth', 'Price vs long-term holder cost basis', 'chain', 'Holder behaviour', 'long', 0.6, 7, SRC.bg, (X, d) => { const r = sAt(X, 'lth', d, 14), p = pAt(X, d); if (!r || !p) return null; const x = p / r[1]; return { v: x, disp: `${f(x, 2)}× (LTH realised ${usd(r[1])})`, s: interp([[0.8, 1], [1, 0.8], [1.5, 0.4], [2.5, 0.1], [4, -0.5], [6, -1]], x), why: x < 1.5 ? 'Long-term holders sit on small gains: little incentive to distribute.' : x > 3 ? 'Long-term holders sit on large gains: historically when they distribute.' : 'Long-term holders sit on moderate gains.', asOf: r[0] }; });
def('c_sopr', 'SOPR (7-day average)', 'chain', 'Holder behaviour', 'short', 0.8, 3, SRC.bg, (X, d) => { const r = sAt(X, 'sopr', d, 12); if (!r) return null; return { v: r[1], disp: f(r[1], 3), s: interp([[0.97, 0.3], [0.99, 0.1], [1.0, 0], [1.02, 0.1], [1.04, -0.2], [1.07, -0.6]], r[1]), why: r[1] < 0.99 ? 'Coins are being sold at a loss (capitulation-type behaviour).' : r[1] > 1.04 ? 'Heavy profit-taking.' : 'Coins move near their cost: no heavy profit-taking.', asOf: r[0] }; });
def('c_profit', 'Supply in profit', 'chain', 'Holder behaviour', 'medium', 0.8, 3, SRC.bg, (X, d) => { const r = sAt(X, 'profit', d, 12); if (!r) return null; return { v: r[1], disp: `${f(r[1], 0)}%`, s: interp([[50, 0.6], [60, 0.4], [75, 0.1], [85, -0.1], [92, -0.4], [97, -0.8]], r[1]), why: r[1] > 90 ? 'Nearly all coins are in profit: more potential sellers.' : r[1] < 60 ? 'Much of the supply is at a loss: sellers are exhausted.' : 'A normal share of coins is in profit.', asOf: r[0] }; });
def('c_active', 'Active addresses (30d vs 90d average)', 'chain', 'Network activity', 'long', 0.8, 3, SRC.act, (X, d) => { const v = vals(X.active, d, 90), r = pt(X.active, d); if (v.length < 90 || dd(r[0], d) > 7) return null; const x = (mean(v.slice(-30)) / mean(v) - 1) * 100; return { v: x, disp: `${pc(x)} (${Math.round(mean(v.slice(-30))).toLocaleString('en-US')} a day)`, s: ramp(x, 10), why: x > 2 ? 'More addresses are active than in recent months.' : x < -2 ? 'Fewer addresses are active than in recent months.' : 'Network use is steady.', asOf: r[0] }; });
def('c_tx', 'Transactions (30d vs 90d average)', 'chain', 'Network activity', 'long', 0.6, 3, SRC.act, (X, d) => { const v = vals(X.tx, d, 90), r = pt(X.tx, d); if (v.length < 90 || dd(r[0], d) > 7) return null; const x = (mean(v.slice(-30)) / mean(v) - 1) * 100; return { v: x, disp: pc(x), s: ramp(x, 12), why: 'Demand for blockspace from transactions.', asOf: r[0] }; });
def('c_fees', 'Fees paid (30d vs 90d average)', 'chain', 'Network activity', 'medium', 0.4, 3, SRC.act, (X, d) => { const v = vals(X.fees, d, 90), r = pt(X.fees, d); if (v.length < 90 || dd(r[0], d) > 7) return null; const x = (mean(v.slice(-30)) / mean(v) - 1) * 100; return { v: x, disp: pc(x, 0), s: ramp(x, 40) * 0.5, why: 'Willingness to pay for blockspace.', asOf: r[0] }; });
def('c_hash', 'Hash rate, 30-day change', 'chain', 'Network activity', 'long', 0.6, 2, SRC.cm, (X, d, now) => { const v = now ? X.M.onchain?.hashCh30d : null; if (!ok(v)) return null; return { v, disp: pc(v), s: ramp(v, 10) * 0.7, why: v >= 0 ? 'Miners keep adding capacity: network security is growing.' : 'Hash rate is falling: some miners are switching off.', asOf: X.M.onchain?.mvrvDate || X.today }; });
def('c_hashprice', 'Hashprice (miner revenue per PH/s), 30d', 'chain', 'Network activity', 'medium', 0.5, 2, SRC.hp, (X, d) => { const r = pt(X.hashprice, d); if (!r || dd(r[0], d) > 5) return null; const o = ago(X.hashprice, d, 30); if (!ok(o)) return null; const x = pct(r[1], o); return { v: x, disp: `$${f(r[1], 1)} / PH/s / day (${pc(x, 0)} over 30 days)`, s: ramp(x, 20) * 0.6, why: x < -15 ? 'Miner revenue is squeezed, which can force selling.' : x > 15 ? 'Miner revenue is improving.' : 'Miner revenue is stable.', asOf: r[0] }; });
def('c_exnet', 'Exchange netflow, 30 days', 'chain', 'Exchange behaviour', 'medium', 1, 2, SRC.fl, (X, d) => { const v = vals(X.exnet, d, 30), r = pt(X.exnet, d); if (v.length < 30 || dd(r[0], d) > 5) return null; const x = v.reduce((s, y) => s + y, 0); return { v: x, disp: `${fs(x, 0)} BTC`, s: ramp(-x, 40000), why: x < 0 ? 'More BTC left exchanges than arrived: coins moving to custody.' : 'More BTC arrived on exchanges than left: potential supply for sale.', asOf: r[0] }; });
def('c_exbal', 'Exchange balance, 30-day change', 'chain', 'Supply dynamics', 'medium', 1, 2, SRC.fl, (X, d) => { const r = pt(X.exbal, d), o = ago(X.exbal, d, 30); if (!r || !ok(o) || dd(r[0], d) > 5) return null; const x = pct(r[1], o); return { v: x, disp: `${pc(x, 2)} (${Math.round(r[1]).toLocaleString('en-US')} BTC on exchanges)`, s: ramp(-x, 2.5), why: x < 0 ? 'Fewer coins sit on exchanges: tighter liquid supply.' : 'More coins sit on exchanges: looser liquid supply.', asOf: r[0] }; });
def('c_whales', 'Large holders (≥1,000 BTC), 30-day change', 'chain', 'Supply dynamics', 'medium', 0.6, 2, SRC.dist, (X, d) => { const r = pt(X.whales, d); if (!r || dd(r[0], d) > 4) return null; const o = pt(X.whales, shiftDate(d, -30)); if (!o || dd(o[0], r[0]) < 7) return null; const x = pct(r[1], o[1]); return { v: x, disp: `${pc(x, 2)} over ${dd(o[0], r[0])} days`, s: ramp(x, 1.5) * 0.7, why: x > 0 ? 'Addresses holding 1,000+ BTC are adding.' : 'Addresses holding 1,000+ BTC are reducing (includes exchange wallets).', asOf: r[0] }; });
def('c_stab30', 'Stablecoin supply, 30-day change', 'chain', 'On-chain liquidity', 'medium', 1, 2, SRC.ll, (X, d) => { const r = pt(X.stables, d), o = ago(X.stables, d, 30); if (!r || !ok(o) || dd(r[0], d) > 5) return null; const x = pct(r[1], o); return { v: x, disp: `${pc(x)} (${big(r[1])})`, s: ramp(x, 3), why: x > 0.5 ? 'More dollar liquidity sits on crypto rails, ready to deploy.' : x < -0.5 ? 'Dollar liquidity is leaving crypto rails.' : 'Stablecoin supply is flat.', asOf: r[0] }; });
def('c_stab7', 'Stablecoin supply, 7-day change', 'chain', 'On-chain liquidity', 'short', 0.5, 2, SRC.ll, (X, d) => { const r = pt(X.stables, d), o = ago(X.stables, d, 7); if (!r || !ok(o) || dd(r[0], d) > 5) return null; const x = pct(r[1], o); return { v: x, disp: `${pc(x, 2)} (${big(r[1] - o)})`, s: ramp(x, 1), why: 'Short-term stablecoin issuance.', asOf: r[0] }; });
def('c_usdt', 'USDT / USDC supply, 30 days', 'chain', 'On-chain liquidity', 'medium', 0.4, 1, SRC.ll, (X, d, now) => { const L = now ? X.dash?.stablecoins : null, T = L?.top?.find((x) => x.sym === 'USDT'), C = L?.top?.find((x) => x.sym === 'USDC'); if (!T?.d30 || !C?.d30) return null; const t = pct(T.now, T.d30), c = pct(C.now, C.d30); return { v: (t + c) / 2, disp: `USDT ${pc(t)} (${big(T.now)}) · USDC ${pc(c)} (${big(C.now)})`, s: ramp((t + c) / 2, 3) * 0.8, why: 'The two largest dollar stablecoins.', asOf: L.asOf }; });

// ---- MARKET STRUCTURE --------------------------------------------------------
const etfSum = (X, d, n) => { const i = idx(X.etf, d); if (i < n - 1 || dd(X.etf[i][0], d) > 5) return null; return { s: X.etf.slice(i - n + 1, i + 1).reduce((a, r) => a + r[1], 0), asOf: X.etf[i][0] }; };
def('m_etf5', 'Spot ETF net flows, 5 trading days', 'mkt', 'Institutional demand', 'short', 1, 3, SRC.fs, (X, d) => { const e = etfSum(X, d, 5); if (!e) return null; return { v: e.s, disp: `${fs(e.s, 0)} US$m`, s: ramp(e.s, 1000), why: e.s > 250 ? 'US spot ETFs are absorbing coins.' : e.s < -250 ? 'US spot ETFs are releasing coins.' : 'ETF flows are small either way.', asOf: e.asOf }; });
def('m_etf20', 'Spot ETF net flows, 20 trading days', 'mkt', 'Institutional demand', 'medium', 1.2, 3, SRC.fs, (X, d) => { const e = etfSum(X, d, 20); if (!e) return null; return { v: e.s, disp: `${fs(e.s, 0)} US$m`, s: ramp(e.s, 3000), why: 'The persistent part of institutional demand.', asOf: e.asOf }; });
def('m_etfacc', 'ETF flow acceleration (5d vs 20d pace)', 'mkt', 'Institutional demand', 'short', 0.5, 3, SRC.fs, (X, d) => { const a = etfSum(X, d, 5), b = etfSum(X, d, 20); if (!a || !b) return null; const x = a.s / 5 - b.s / 20; return { v: x, disp: `${fs(x, 0)} US$m a day`, s: ramp(x, 150) * 0.6, why: x > 0 ? 'Daily inflows are running above their 20-day pace.' : 'Daily inflows are running below their 20-day pace.', asOf: a.asOf }; });
def('m_etfweeks', 'ETF weekly streak', 'mkt', 'Institutional demand', 'medium', 0, 7, SRC.fs, (X, d, now) => { const e = now ? X.M.etf : null; if (!e || (!e.consecInWeeks && !e.consecOutWeeks)) return null; return { v: e.consecInWeeks || -e.consecOutWeeks, disp: e.consecInWeeks ? `${e.consecInWeeks} straight week(s) of net inflows` : `${e.consecOutWeeks} straight week(s) of net outflows`, s: null, why: 'Persistence of the flow (context).', asOf: e.lastDate }; });
def('m_etfaum', 'US spot ETF assets', 'mkt', 'Institutional demand', 'long', 0, 1, SRC.et, (X, d, now) => { const F = now ? X.dash?.etfs?.funds : null; if (!F?.length) return null; const t = F.reduce((s, x) => s + (x.assets || 0), 0); if (!t) return null; return { v: t, disp: `${big(t)} across ${F.length} funds`, s: null, why: 'Size of the institutional wrapper (context).', asOf: X.dash.etfs.fetchedAt }; });
def('m_treas', 'Public-company treasuries', 'mkt', 'Institutional demand', 'long', 0, 2, SRC.tr, (X, d, now) => { const T = now ? X.dash?.treasuries : null; if (!ok(T?.totalBtc)) return null; return { v: T.totalBtc, disp: `${Math.round(T.totalBtc).toLocaleString('en-US')} BTC`, s: null, why: 'Corporate balance-sheet holdings (context).', asOf: T.fetchedAt }; });
def('m_cftcam', 'CME asset managers, weekly net change', 'mkt', 'Institutional demand', 'medium', 0.4, 9, SRC.cftc, (X, d, now) => { const c = now ? X.M.derivs?.cot : null; if (!ok(c?.amNet) || !ok(c.amNetPrev)) return null; const x = c.amNet - c.amNetPrev; return { v: x, disp: `${fs(x, 0)} contracts (net ${fs(c.amNet, 0)})`, s: ramp(x, 1500) * 0.6, why: 'Regulated-futures positioning of asset managers.', asOf: c.date }; });
def('m_funding', 'Perpetual funding (annualised)', 'mkt', 'Leverage', 'short', 1, 1, SRC.drv, (X, d, now) => { let v = now ? X.M.derivs?.fundingAnn : null, at = X.today; if (!ok(v)) { const r = pt(X.funding, d); if (!r || dd(r[0], d) > 3) return null; v = r[1]; at = r[0]; } return { v, disp: `${pc(v)} a year`, s: interp([[-10, 0.1], [-2, 0.2], [0, 0.2], [8, 0.1], [15, -0.2], [25, -0.6], [40, -1]], v), why: v > 20 ? 'Longs pay a lot to stay leveraged: crowded.' : v < 0 ? 'Shorts pay longs: bearish positioning, squeeze fuel.' : 'Leverage costs are moderate.', asOf: at }; });
def('m_oigrowth', 'Open interest vs price, 30 days (OKX)', 'mkt', 'Leverage', 'medium', 1, 2, SRC.okx, (X, d) => { const r = pt(X.oi, d), o = ago(X.oi, d, 30), p = pAt(X, d), po = ago(X.close, d, 30); if (!r || !ok(o) || !p || !ok(po) || dd(r[0], d) > 4) return null; const oi = pct(r[1], o), px = pct(p, po), x = oi - px; return { v: x, disp: `OI ${pc(oi, 0)} vs price ${pc(px, 0)}`, s: -ramp(x - 5, 25), why: x > 15 ? 'Open interest is growing faster than price: the move is leaning on leverage.' : x < -15 ? 'Open interest fell versus price: leverage has been flushed.' : 'Leverage is growing in line with price.', asOf: r[0] }; });
def('m_oimcap', 'Futures open interest ÷ market cap', 'mkt', 'Leverage', 'medium', 0.8, 1, SRC.drv, (X, d, now) => { const v = now ? X.M.derivs?.oiPctMcap : null; if (!ok(v)) return null; return { v, disp: `${f(v, 2)}% (${big(X.M.derivs.totalOi)})`, s: interp([[1.5, 0.2], [2.5, 0], [3.5, -0.4], [5, -0.8]], v), why: v > 3.5 ? 'A lot of leverage relative to the asset.' : 'Leverage is moderate relative to the asset.', asOf: X.today }; });
def('m_liq', 'Liquidations (sample, last ~day)', 'mkt', 'Leverage', 'short', 0, 1, SRC.okx, (X, d, now) => { const L = now ? X.M.liq : null; if (!L || !ok(L.longUsd)) return null; return { v: L.longUsd + L.shortUsd, disp: `longs ${big(L.longUsd)} · shorts ${big(L.shortUsd)} (${L.venue})`, s: null, why: 'Forced closures in the latest public sample (context).', asOf: L.to }; });
def('m_basis', 'Futures basis (annualised, ~3 months)', 'mkt', 'Derivatives', 'medium', 0.8, 1, SRC.der, (X, d, now) => { let v = now ? X.M.derivs?.basis?.annPct : null, at = X.today; if (!ok(v)) { const r = pt(X.basis, d); if (!r || dd(r[0], d) > 3) return null; v = r[1]; at = r[0]; } return { v, disp: `${pc(v)} a year (${v >= 0 ? 'contango' : 'backwardation'})`, s: interp([[-2, -0.4], [2, -0.1], [5, 0.2], [10, 0.2], [15, -0.3], [25, -0.9]], v), why: v > 15 ? 'Rich basis: leveraged demand is paying up.' : v < 2 ? 'Thin basis: little appetite for leveraged longs.' : 'A normal carry.', asOf: at }; });
def('m_skew', 'Options 25-delta skew (30-day)', 'mkt', 'Derivatives', 'short', 0.8, 1, SRC.der, (X, d, now) => { const v = now ? X.M.options?.skew25 : null; if (!ok(v)) return null; return { v, disp: `${fs(v, 1)} vol pts (${v < 0 ? 'puts richer' : 'calls richer'})`, s: ramp(v, 8) * 0.8, why: v < -4 ? 'Strong demand for downside protection.' : v > 3 ? 'Demand for upside calls.' : 'Balanced options demand.', asOf: X.today }; });
def('m_pcr', 'Options put/call ratio (open interest)', 'mkt', 'Derivatives', 'medium', 0.3, 1, SRC.der, (X, d, now) => { const v = now ? X.M.options?.pcRatio : null; if (!ok(v)) return null; return { v, disp: f(v, 2), s: interp([[0.4, 0.1], [0.7, 0], [1.0, -0.2], [1.3, -0.4]], v), why: 'Share of puts in open options positions.', asOf: X.today }; });
def('m_dvol', 'Implied volatility (DVOL) percentile', 'mkt', 'Derivatives', 'short', 0.6, 1, SRC.der, (X, d) => { const r = pt(X.dvol, d); if (!r || dd(r[0], d) > 3) return null; const p = percentileRank(r[1], vals(X.dvol, d, 365)); return { v: r[1], disp: `${f(r[1], 0)} · ${ord(p)} percentile of the past year`, s: interp([[20, 0.1], [60, 0], [85, -0.5], [95, -0.8]], p), why: p >= 85 ? 'Options price a lot of turbulence.' : p <= 20 ? 'Options price calm conditions.' : 'Implied volatility is ordinary.', asOf: r[0] }; });
def('m_ivrv', 'Implied minus realised volatility', 'mkt', 'Derivatives', 'short', 0, 1, SRC.der, (X, d, now) => { const v = now ? X.M.options?.ivRvSpread : null; if (!ok(v)) return null; return { v, disp: `${fs(v, 1)} vol pts`, s: null, why: v > 10 ? 'Protection is expensive versus actual movement.' : v < 0 ? 'Options are cheap versus actual movement.' : 'Options are fairly priced versus actual movement (context).', asOf: X.today }; });
def('m_cbp', 'Coinbase premium', 'mkt', 'Spot demand', 'short', 0.7, 1, SRC.book, (X, d, now) => { let v = now ? X.M.depth?.coinbasePremiumPct : null, at = X.today; if (!ok(v)) { const r = pt(X.cbp, d); if (!r || dd(r[0], d) > 2) return null; v = r[1]; at = r[0]; } return { v, disp: `${fs(v, 3)}%`, s: ramp(v, 0.08), why: v > 0.02 ? 'US buyers are paying up versus offshore venues.' : v < -0.02 ? 'US venues trade at a discount: weaker US demand.' : 'No US premium either way.', asOf: at }; });
def('m_taker', 'Spot taker buy/sell ratio, 7 days (OKX)', 'mkt', 'Spot demand', 'short', 0.6, 1, SRC.okx, (X, d, now) => { const v = now ? X.M.derivs?.takerSpot7d : null; if (!ok(v)) return null; return { v, disp: f(v, 3), s: ramp(v - 1, 0.08), why: v > 1.02 ? 'Aggressive buyers outweigh aggressive sellers.' : v < 0.98 ? 'Aggressive sellers outweigh buyers.' : 'Balanced aggressor flow.', asOf: X.today }; });
def('m_depth', 'Order-book balance within ±1%', 'mkt', 'Spot demand', 'short', 0.4, 1, SRC.book, (X, d, now) => { const D = now ? X.M.depth : null; if (!ok(D?.imbalance1)) return null; const v = D.imbalance1; return { v, disp: `${big(D.d1)} deep · ${v >= 0 ? 'bid' : 'ask'}-heavy by ${f(Math.abs(v) * 100, 0)}%`, s: ramp(v, 0.25) * 0.5, why: v > 0.1 ? 'More resting bids than offers near price.' : v < -0.1 ? 'More resting offers than bids near price.' : 'Books are balanced near price.', asOf: X.today }; });
def('m_spotvol', 'Spot volume, 24h', 'mkt', 'Spot demand', 'short', 0, 1, SRC.cg, (X, d, now) => { const v = now ? X.M.structure?.spotVolume24h : null; if (!ok(v)) return null; return { v, disp: `${big(v)} (derivatives ÷ spot ${f(X.M.structure.derivToSpot, 2)}×)`, s: null, why: 'Activity level (context).', asOf: X.today }; });
def('m_ls', 'Long/short account ratio (OKX)', 'mkt', 'Market positioning', 'short', 0.6, 1, SRC.okx, (X, d, now) => { const L = now ? X.M.derivs?.longShort : null; if (!ok(L?.okx)) return null; const v = L.okx; return { v, disp: `${f(v, 2)}${ok(L.okx7dAgo) ? ` (7 days ago ${f(L.okx7dAgo, 2)})` : ''}`, s: interp([[0.7, 0.3], [1, 0.1], [1.5, 0], [2.2, -0.3], [3, -0.6]], v), why: v > 2 ? 'Retail accounts lean heavily long: crowded.' : v < 0.9 ? 'Accounts lean short: contrarian support.' : 'Positioning is not one-sided.', asOf: X.today }; });
def('m_cftclev', 'CME leveraged funds, net position', 'mkt', 'Market positioning', 'medium', 0, 9, SRC.cftc, (X, d, now) => { const c = now ? X.M.derivs?.cot : null; if (!ok(c?.levNet)) return null; return { v: c.levNet, disp: `${fs(c.levNet, 0)} contracts`, s: null, why: 'Hedge funds are usually short CME futures against long ETF holdings (basis trade), so this is context, not direction.', asOf: c.date }; });
def('m_dom', 'BTC dominance', 'mkt', 'Crypto market structure', 'medium', 0.5, 1, SRC.cg, (X, d, now) => { const v = now ? X.M.structure?.dominance : pt(X.dom, d)?.[1]; if (!ok(v)) return null; const o = ago(X.dom, d, 7); const ch = ok(o) && dd(pt(X.dom, shiftDate(d, -7))[0], d) >= 5 ? v - o : null; return { v, disp: `${f(v, 1)}%${ok(ch) ? ` (${fs(ch, 1)} pts in 7 days)` : ''}`, s: ok(ch) ? ramp(ch, 1.5) * 0.4 : null, why: 'Share of crypto value held in BTC; rising means capital is concentrating in Bitcoin.', asOf: X.today }; });
def('m_breadth', 'Altcoin breadth (30d, vs BTC)', 'mkt', 'Crypto market structure', 'medium', 0, 1, SRC.cg, (X, d, now) => { const v = now ? X.M.structure?.breadth30 : null; if (!ok(v)) return null; return { v, disp: `${f(v, 0)}% of the top coins beat BTC`, s: null, why: v > 70 ? 'A broad altcoin rotation: speculative risk appetite is high.' : v < 30 ? 'Bitcoin is leading the market.' : 'Mixed leadership (context).', asOf: X.today }; });
def('m_stabdom', 'Stablecoin share of crypto market cap', 'mkt', 'Crypto market structure', 'medium', 0, 1, SRC.ll, (X, d, now) => { const s = now ? X.M.onchain?.stables : null; const tot = now ? X.totalMcap : null; if (!ok(s) || !ok(tot)) return null; const v = (s / tot) * 100; return { v, disp: `${f(v, 1)}%`, s: null, why: 'Higher means more capital parked in dollars inside crypto (context).', asOf: X.today }; });

// ---- SENTIMENT ---------------------------------------------------------------
def('s_fng', 'Fear & Greed level', 'sent', 'Fear & Greed', 'medium', 1.2, 1, SRC.fng, (X, d) => { const r = pt(X.fng, d); if (!r || dd(r[0], d) > 3) return null; const v = r[1], h = vals(X.fng, d, 365), p = h.length >= 60 ? percentileRank(v, h) : null; return { v, disp: `${v} (${v <= 24 ? 'extreme fear' : v <= 44 ? 'fear' : v <= 55 ? 'neutral' : v <= 74 ? 'greed' : 'extreme greed'})${ok(p) ? ` · ${ord(p)} percentile of the year` : ''}`, s: interp([[10, 0.5], [25, 0.25], [40, 0], [60, 0.1], [75, 0], [85, -0.5], [95, -0.9]], v), why: v >= 80 ? 'Extreme greed: consensus is crowded, historically a caution signal.' : v <= 25 ? 'Extreme fear: historically closer to lows than highs (contrarian).' : 'Sentiment is not at an extreme.', asOf: r[0] }; });
def('s_fngchg', 'Fear & Greed, 7-day change', 'sent', 'Fear & Greed', 'short', 0.6, 1, SRC.fng, (X, d) => { const r = pt(X.fng, d), o = ago(X.fng, d, 7); if (!r || !ok(o) || dd(r[0], d) > 3) return null; const x = r[1] - o, hot = r[1] >= 78 && x > 0; return { v: x, disp: `${fs(x, 0)} points (from ${o})`, s: hot ? -0.3 : ramp(x, 20) * 0.5, why: hot ? 'Greed is still rising from an already high level (overheating).' : x > 0 ? 'Sentiment is improving.' : x < 0 ? 'Sentiment is cooling.' : 'Sentiment is unchanged.', asOf: r[0] }; });
def('s_fngreg', 'Fear & Greed, 30-day average', 'sent', 'Fear & Greed', 'medium', 0, 1, SRC.fng, (X, d) => { const v = vals(X.fng, d, 30), r = pt(X.fng, d); if (v.length < 30 || dd(r[0], d) > 3) return null; const m = mean(v); return { v: m, disp: f(m, 0), s: null, why: 'The sentiment regime behind the daily reading (context).', asOf: r[0] }; });
def('s_news', 'News tone (last 48 hours)', 'sent', 'News', 'short', 0.7, 1, SRC.news, (X, d, now) => { const I = now ? X.dash?.news?.items?.filter((x) => !x.macro && Date.parse(X.nowIso) - Date.parse(x.t) < 48 * 3600e3) : null; if (!I || I.length < 5) return null; const b = I.filter((x) => x.tag === 'bullish').length, r = I.filter((x) => x.tag === 'bearish').length, bal = (b - r) / I.length; return { v: bal, disp: `${b} positive · ${r} negative of ${I.length} headlines`, s: ramp(bal, 0.4) * 0.6, why: Math.abs(bal) < 0.1 ? 'Coverage is balanced.' : bal > 0 ? 'Coverage leans positive.' : 'Coverage leans negative.', asOf: X.dash.news.items[0]?.t }; });
def('s_newsvol', 'News volume (24h vs 72h pace)', 'sent', 'Narrative', 'short', 0, 1, SRC.news, (X, d, now) => { const I = now ? X.dash?.news?.items?.filter((x) => !x.macro) : null; if (!I?.length) return null; const t = Date.parse(X.nowIso), n24 = I.filter((x) => t - Date.parse(x.t) < 24 * 3600e3).length, n72 = I.filter((x) => t - Date.parse(x.t) < 72 * 3600e3).length; const r = n72 ? n24 / (n72 / 3) : null; if (!ok(r)) return null; return { v: r, disp: `${n24} in 24h vs ${f(n72 / 3, 0)} a day over 72h`, s: null, why: r > 1.4 ? 'Coverage is intensifying: a story is in focus.' : r < 0.7 ? 'Coverage is quiet.' : 'Normal coverage (context).', asOf: I[0]?.t }; });
def('s_themes', 'Dominant headline themes', 'sent', 'Narrative', 'short', 0, 1, SRC.news, (X, d, now) => { const I = now ? X.dash?.news?.items : null; if (!I?.length) return null; const c = {}; for (const x of I) for (const w of x.words || []) c[w] = (c[w] || 0) + 1; const top = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 4); if (!top.length) return null; return { v: top.length, disp: top.map(([w, n]) => `${w} (${n})`).join(' · '), s: null, why: 'Most frequent tagged words in recent headlines (context).', asOf: I[0]?.t }; });
def('s_wiki', 'Retail attention (Wikipedia views, 7d vs 90d)', 'sent', 'Retail attention', 'medium', 0.8, 2, SRC.wiki, (X, d) => { const v = vals(X.wiki, d, 90), r = pt(X.wiki, d); if (v.length < 90 || dd(r[0], d) > 5) return null; const x = mean(v.slice(-7)) / mean(v); return { v: x, disp: `${f(x, 2)}× (${Math.round(mean(v.slice(-7))).toLocaleString('en-US')} views a day)`, s: interp([[0.6, 0.15], [1, 0], [1.5, -0.1], [2.5, -0.6]], x), why: x > 1.8 ? 'A spike in public attention: often frenzy or panic.' : x < 0.8 ? 'Public attention is low: no retail froth.' : 'Public attention is normal.', asOf: r[0] }; });
def('s_wikitr', 'Retail attention trend (30d vs 90d)', 'sent', 'Retail attention', 'medium', 0.4, 2, SRC.wiki, (X, d) => { const v = vals(X.wiki, d, 90), r = pt(X.wiki, d); if (v.length < 90 || dd(r[0], d) > 5) return null; const x = (mean(v.slice(-30)) / mean(v) - 1) * 100; return { v: x, disp: pc(x, 0), s: ramp(x, 30) * 0.3, why: x > 10 ? 'Interest is building gradually.' : x < -10 ? 'Interest is fading.' : 'Interest is stable.', asOf: r[0] }; });
def('s_pm', 'Prediction markets (Polymarket)', 'sent', 'Narrative', 'short', 0, 1, SRC.pm, (X, d, now) => { const E = now ? X.dash?.polymarket?.events : null; if (!E?.length) return null; return { v: E.length, disp: `${E.length} active Bitcoin price markets`, s: null, why: 'Market-implied odds are shown on the dashboard; they are not scored here.', asOf: X.dash.polymarket.fetchedAt }; });

// ---- MACRO & LIQUIDITY ---------------------------------------------------------
const chgAbs = (X, k, d, n, maxAge = 10) => { const r = pt(X[k], d), o = ago(X[k], d, n); return r && ok(o) && dd(r[0], d) <= maxAge ? { x: r[1] - o, v: r[1], at: r[0] } : null; };
const chgPct = (X, k, d, n, maxAge = 10) => { const r = pt(X[k], d), o = ago(X[k], d, n); return r && ok(o) && dd(r[0], d) <= maxAge ? { x: pct(r[1], o), v: r[1], at: r[0] } : null; };
const MM = (X, now) => (now ? X.M.macro || {} : {});
def('x_netliq4', 'US net liquidity, 4-week change', 'macro', 'Liquidity', 'medium', 1, 7, SRC.fred, (X, d) => { const c = chgAbs(X, 'netLiq', d, 28, 12); if (!c) return null; return { v: c.x, disp: `${fs(c.x, 0)} bn (level $${f(c.v / 1000, 2)}T)`, s: ramp(c.x, 200), why: c.x > 0 ? 'Fed assets net of the Treasury account and reverse repo are rising: more dollars in the system.' : 'Net dollar liquidity is shrinking.', asOf: c.at }; });
def('x_netliq13', 'US net liquidity, 13-week change', 'macro', 'Liquidity', 'long', 0.8, 7, SRC.fred, (X, d) => { const c = chgAbs(X, 'netLiq', d, 91, 12); if (!c) return null; return { v: c.x, disp: `${fs(c.x, 0)} bn`, s: ramp(c.x, 400), why: 'The slower liquidity trend.', asOf: c.at }; });
def('x_m2', 'US M2 money supply, year on year', 'macro', 'Liquidity', 'long', 0.7, 35, SRC.fred, (X, d, now) => { const v = MM(X, now).m2Yoy; if (!v) return null; return { v: v[1], disp: `${pc(v[1])}${MM(X, now).m2Yoy3m ? ` (3 months earlier ${pc(MM(X, now).m2Yoy3m[1])})` : ''}`, s: interp([[0, -0.6], [2, -0.2], [4, 0.1], [6, 0.5], [9, 0.8]], v[1]), why: v[1] > 4 ? 'Broad money is growing at a healthy pace.' : v[1] < 1 ? 'Broad money is barely growing.' : 'Broad money growth is modest.', asOf: v[0] }; });
def('x_g3', 'Fed + ECB + BoJ balance sheets, 13 weeks', 'macro', 'Liquidity', 'long', 0.5, 7, SRC.fred, (X, d, now) => { const g = MM(X, now).g3; if (!ok(g?.ch13wPct)) return null; return { v: g.ch13wPct, disp: `${pc(g.ch13wPct)} (${big(g.usdBn * 1e9)})`, s: ramp(g.ch13wPct, 3) * 0.6, why: 'Global central-bank liquidity (BoJ data is monthly and lags).', asOf: X.today }; });
def('x_real', '10-year real yield, 4-week change', 'macro', 'Rates', 'medium', 1, 3, SRC.fred, (X, d) => { const c = chgAbs(X, 'real10y', d, 28, 6); if (!c) return null; return { v: c.x, disp: `${fs(c.x * 100, 0)} bp (now ${f(c.v, 2)}%)`, s: -ramp(c.x, 0.35), why: c.x > 0.1 ? 'Rising real yields raise the cost of holding a non-yielding asset.' : c.x < -0.1 ? 'Falling real yields ease the pressure on non-yielding assets.' : 'Real yields are stable.', asOf: c.at }; });
def('x_2y', '2-year yield, 4-week change (rate expectations)', 'macro', 'Rates', 'medium', 0.7, 3, SRC.fred, (X, d, now) => { const m = MM(X, now); if (!ok(m.us2y20d) || !m.us2y) return null; return { v: m.us2y20d, disp: `${fs(m.us2y20d * 100, 0)} bp (now ${f(m.us2y[1], 2)}%)`, s: -ramp(m.us2y20d, 0.35) * 0.8, why: m.us2y20d < -0.1 ? 'Markets are pricing more rate cuts.' : m.us2y20d > 0.1 ? 'Markets are pricing fewer cuts or more hikes.' : 'Rate expectations are steady.', asOf: m.us2y[0] }; });
def('x_10y', '10-year yield, 4-week change', 'macro', 'Rates', 'medium', 0.4, 3, SRC.fred, (X, d) => { const c = chgAbs(X, 'us10y', d, 28, 6); if (!c) return null; return { v: c.x, disp: `${fs(c.x * 100, 0)} bp (now ${f(c.v, 2)}%)`, s: -ramp(c.x, 0.4) * 0.6, why: 'Long-term borrowing costs.', asOf: c.at }; });
def('x_curve', 'Yield curve (10y − 2y)', 'macro', 'Rates', 'long', 0, 3, SRC.fred, (X, d, now) => { const v = MM(X, now).curve; if (!v) return null; return { v: v[1], disp: `${fs(v[1], 2)} pts`, s: null, why: v[1] < 0 ? 'Inverted: markets expect slower growth or cuts (context).' : 'Positively sloped (context).', asOf: v[0] }; });
def('x_dxy', 'Dollar index, 4-week change', 'macro', 'Dollar', 'medium', 1, 3, SRC.yh, (X, d) => { const c = chgPct(X, 'dxy', d, 28, 6); if (!c) return null; return { v: c.x, disp: `${pc(c.x)} (now ${f(c.v, 2)})`, s: -ramp(c.x, 2.5), why: c.x > 0.5 ? 'A firmer dollar tightens global financial conditions.' : c.x < -0.5 ? 'A softer dollar eases global financial conditions.' : 'The dollar is stable.', asOf: c.at }; });
def('x_dxytr', 'Dollar vs its 200-day average', 'macro', 'Dollar', 'long', 0.7, 3, SRC.yh, (X, d) => { const v = vals(X.dxy, d, 200), r = pt(X.dxy, d); if (v.length < 200 || dd(r[0], d) > 6) return null; const x = (r[1] / mean(v) - 1) * 100; return { v: x, disp: pc(x), s: -ramp(x, 4) * 0.8, why: x > 0 ? 'The dollar is in an uptrend.' : 'The dollar is in a downtrend.', asOf: r[0] }; });
def('x_vix', 'VIX (equity volatility)', 'macro', 'Risk appetite', 'short', 0.9, 3, SRC.yh, (X, d) => { const r = pt(X.vix, d); if (!r || dd(r[0], d) > 6) return null; return { v: r[1], disp: f(r[1], 1), s: interp([[12, 0.4], [16, 0.2], [20, 0], [25, -0.4], [32, -0.8], [40, -1]], r[1]), why: r[1] > 25 ? 'Equity markets are stressed.' : r[1] < 16 ? 'Equity markets are calm: risk appetite is healthy.' : 'Equity volatility is normal.', asOf: r[0] }; });
def('x_hy', 'High-yield credit spread, 4-week change', 'macro', 'Risk appetite', 'medium', 0.8, 3, SRC.fred, (X, d) => { const c = chgAbs(X, 'hy', d, 28, 6); if (!c) return null; return { v: c.x, disp: `${fs(c.x * 100, 0)} bp (now ${f(c.v, 2)}%)`, s: -ramp(c.x, 0.4), why: c.x > 0.15 ? 'Credit markets are demanding more compensation for risk.' : c.x < -0.15 ? 'Credit spreads are tightening: risk appetite is improving.' : 'Credit spreads are stable.', asOf: c.at }; });
def('x_ndx', 'Nasdaq 100, 4-week change', 'macro', 'Risk appetite', 'medium', 0.8, 3, SRC.yh, (X, d) => { const c = chgPct(X, 'ndx', d, 28, 6); if (!c) return null; return { v: c.x, disp: pc(c.x), s: ramp(c.x, 6), why: c.x > 0 ? 'Growth equities are rising.' : 'Growth equities are falling.', asOf: c.at }; });
def('x_gold', 'Gold, 4-week change', 'macro', 'Risk appetite', 'medium', 0, 3, SRC.yh, (X, d) => { const c = chgPct(X, 'gold', d, 28, 6); if (!c) return null; return { v: c.x, disp: `${pc(c.x)} (${usd(c.v)})`, s: null, why: 'Demand for the traditional hedge (context).', asOf: c.at }; });
def('x_corr', 'BTC–Nasdaq correlation (30 days)', 'macro', 'Risk appetite', 'short', 0, 3, SRC.yh, (X, d) => { const r = pt(X.corrNdx, d); if (!r || dd(r[0], d) > 6) return null; return { v: r[1], disp: f(r[1], 2), s: null, why: Math.abs(r[1]) >= 0.4 ? 'Bitcoin is trading with equities: macro matters more than usual.' : 'Bitcoin is moving largely on its own drivers (context).', asOf: r[0] }; });
def('x_fed', 'Fed balance sheet, 13 weeks', 'macro', 'Monetary regime', 'long', 0.8, 7, SRC.fred, (X, d, now) => { const m = MM(X, now); if (!ok(m.fedAssets13w)) return null; return { v: m.fedAssets13w, disp: `${fs(m.fedAssets13w, 0)} bn (QT ${m.fedAssets13w < -20 ? 'running' : 'paused or slow'})`, s: ramp(m.fedAssets13w, 150) * 0.7, why: m.fedAssets13w < -20 ? 'The Fed is still shrinking its balance sheet.' : m.fedAssets13w > 20 ? 'The Fed balance sheet is growing.' : 'The Fed balance sheet is roughly flat.', asOf: m.fedAssets?.[0] }; });
def('x_ff', 'Fed funds rate, 6-month change', 'macro', 'Monetary regime', 'long', 0.8, 3, SRC.fred, (X, d, now) => { const m = MM(X, now); if (!ok(m.ff180) || !m.ff) return null; return { v: m.ff180, disp: `${fs(m.ff180 * 100, 0)} bp (now ${f(m.ff[1], 2)}%)`, s: -ramp(m.ff180, 0.75) * 0.7, why: m.ff180 < -0.1 ? 'The Fed is cutting rates.' : m.ff180 > 0.1 ? 'The Fed is raising rates.' : 'Policy rates are on hold.', asOf: m.ff[0] }; });
def('x_cpi', 'CPI inflation, year on year', 'macro', 'Monetary regime', 'medium', 0.5, 35, SRC.fred, (X, d, now) => { const m = MM(X, now); if (!m.cpiYoy) return null; const tr = m.cpiYoy3m ? m.cpiYoy[1] - m.cpiYoy3m[1] : null; return { v: m.cpiYoy[1], disp: `${f(m.cpiYoy[1], 1)}%${ok(tr) ? ` (${fs(tr, 1)} pts in 3 months)` : ''}`, s: clamp((ok(tr) ? -ramp(tr, 0.6) * 0.5 : 0) + interp([[2, 0.2], [3, 0], [4, -0.3], [6, -0.6]], m.cpiYoy[1]) * 0.5, -1, 1), why: ok(tr) && tr > 0.2 ? 'Inflation is re-accelerating, which limits rate cuts.' : ok(tr) && tr < -0.2 ? 'Inflation is cooling, which gives room for easier policy.' : 'Inflation is stable.', asOf: m.cpiYoy[0] }; });
def('x_pce', 'Core PCE inflation, year on year', 'macro', 'Monetary regime', 'medium', 0, 35, SRC.fred, (X, d, now) => { const m = MM(X, now); if (!m.pceYoy) return null; return { v: m.pceYoy[1], disp: `${f(m.pceYoy[1], 1)}%`, s: null, why: 'The Fed’s preferred inflation gauge (context).', asOf: m.pceYoy[0] }; });
def('x_be', '10-year breakeven inflation', 'macro', 'Monetary regime', 'medium', 0, 3, SRC.fred, (X, d, now) => { const m = MM(X, now); if (!m.breakeven) return null; return { v: m.breakeven[1], disp: `${f(m.breakeven[1], 2)}%`, s: null, why: 'Market inflation expectations (context).', asOf: m.breakeven[0] }; });
def('x_unrate', 'Unemployment rate', 'macro', 'Monetary regime', 'medium', 0, 35, SRC.fred, (X, d, now) => { const m = MM(X, now); if (!m.unrate) return null; return { v: m.unrate[1], disp: `${f(m.unrate[1], 1)}%${ok(m.unrate3m) ? ` (${fs(m.unrate3m, 1)} pts in 3 months)` : ''}`, s: null, why: 'A rising rate can bring cuts but also growth worries, so it is context, not direction.', asOf: m.unrate[0] }; });
def('x_gdp', 'Real GDP growth (q/q annualised)', 'macro', 'Monetary regime', 'long', 0, 100, SRC.fred, (X, d, now) => { const m = MM(X, now); if (!m.gdp) return null; return { v: m.gdp[1], disp: `${f(m.gdp[1], 1)}%`, s: null, why: 'Growth backdrop (context).', asOf: m.gdp[0] }; });

export const INDICATORS = DEFS.map(({ calc, ...x }) => x);

// ---------------------------------------------------------------------------
// LAYER 3: evaluate every indicator as of date d
function readingsAt(X, d) {
  const key = 'r' + d;
  if (X._c[key]) return X._c[key];
  const now = d === X.today, out = {};
  for (const D of DEFS) {
    let r = null;
    try { r = D.calc(X, d, now); } catch { r = null; }
    if (!r || (r.s !== null && r.s !== undefined && !ok(r.s))) continue;
    const at = r.asOf ? String(r.asOf).slice(0, 10) : d, age = Math.max(0, dd(at, d));
    const q = age <= D.freq * 1.5 + 1 ? 1 : age <= D.freq * 3 + 3 ? 0.7 : 0;
    if (q === 0) continue; // too old to use
    out[D.id] = { id: D.id, name: D.name, domain: D.domain, comp: D.comp, horizon: D.horizon, w: D.w, src: D.src, value: r.v, disp: r.disp, s: ok(r.s) && D.w > 0 ? r.s : null, why: r.why, asOf: at, age, q, fresh: q === 1 ? 'fresh' : 'delayed', pctile: r.pctile ?? null };
  }
  return (X._c[key] = out);
}
const STATE = (s) => (s === null ? 'Context' : s >= 0.2 ? 'Supportive' : s <= -0.2 ? 'Cautionary' : 'Neutral');

// ---------------------------------------------------------------------------
// LAYER 4: domains (components first, then explicit weights and override rules)
const LBL = (s, mixed) => (s >= 0.4 ? 'Supportive' : s >= 0.15 ? 'Constructive' : s > -0.15 ? (mixed ? 'Mixed' : 'Neutral') : s > -0.4 ? 'Cautionary' : 'Adverse');
const ARROW = (s) => (s >= 0.4 ? '↑↑' : s >= 0.15 ? '↑' : s > -0.15 ? '→' : s > -0.4 ? '↓' : '↓↓');
// named states (valuation, leverage…) need a clearer reading before they leave "neutral"
const word = (comp, s) => { const v = VOCAB[comp] || ['Positive', 'Neutral', 'Negative'], t = VOCAB[comp] ? 0.3 : 0.15; return s >= t ? (s >= 0.6 && !VOCAB[comp] ? 'Strong' : v[0]) : s > -t ? v[1] : s <= -0.6 && !VOCAB[comp] ? 'Weak' : v[2]; };
function synthDomains(R, only) {
  const use = (r) => r.s !== null && (!only || only.has(r.id));
  return DOMAINS.map((D) => {
    const inD = Object.values(R).filter((r) => r.domain === D.key);
    const comps = Object.entries(D.comps).map(([name, W]) => {
      const ind = inD.filter((r) => r.comp === name), sc = ind.filter(use);
      const defW = DEFS.filter((x) => x.domain === D.key && x.comp === name && x.w > 0).reduce((a, x) => a + x.w, 0);
      const wq = sc.reduce((a, r) => a + r.w * r.q, 0);
      const score = wq ? sc.reduce((a, r) => a + r.w * r.q * r.s, 0) / wq : null;
      const cov = defW ? sc.reduce((a, r) => a + r.w, 0) / defW : 0;
      return { name, W, score, cov, word: score === null ? 'No data' : word(name, score), n: sc.length, indicators: ind };
    });
    const live = comps.filter((c) => c.score !== null);
    const wsum = live.reduce((a, c) => a + c.W * (0.5 + 0.5 * c.cov), 0);
    let score = wsum ? live.reduce((a, c) => a + c.W * (0.5 + 0.5 * c.cov) * c.score, 0) / wsum : null;
    const notes = [], C = (n) => comps.find((c) => c.name === n)?.score ?? null;
    if (score !== null) {
      if (D.key === 'tech' && C('Trend') !== null && C('Trend') <= -0.35 && score > 0.1) { score = 0.1; notes.push('Capped: the long-term trend is negative, so short-term strength cannot make this domain constructive.'); }
      if (D.key === 'tech' && C('Trend') >= 0.35 && C('Extension') !== null && C('Extension') <= -0.5 && score > 0.35) { score = 0.35; notes.push('Capped: the trend is strong but price is stretched.'); }
      if (D.key === 'mkt' && C('Leverage') !== null && C('Leverage') <= -0.6 && score > 0.15) { score = 0.15; notes.push('Capped: demand is present but leverage is elevated.'); }
      if (D.key === 'chain' && C('Valuation') !== null && C('Valuation') <= -0.6 && score > 0.2) { score = 0.2; notes.push('Capped: on-chain valuation is expensive.'); }
      if (D.key === 'sent' && C('Fear & Greed') !== null && C('Fear & Greed') <= -0.5 && score > -0.15) { score = Math.min(score, -0.15); notes.push('Extreme greed overrides the other sentiment inputs.'); }
    }
    const mixed = live.some((c) => c.score >= 0.3) && live.some((c) => c.score <= -0.3);
    // confidence: coverage of defined weight, freshness, agreement of signs
    const all = inD.filter(use), defW = DEFS.filter((x) => x.domain === D.key && x.w > 0).reduce((a, x) => a + x.w, 0);
    const coverage = defW ? all.reduce((a, r) => a + r.w, 0) / defW : 0;
    const fresh = all.length ? mean(all.map((r) => r.q)) : 0;
    const sign = Math.sign(score || 0), dis = all.filter((r) => Math.abs(r.s) >= 0.2 && Math.sign(r.s) === -sign).reduce((a, r) => a + r.w, 0), tot = all.filter((r) => Math.abs(r.s) >= 0.2).reduce((a, r) => a + r.w, 0);
    const agree = sign === 0 || !tot ? 0.6 : 1 - dis / tot;
    const cs = 0.45 * Math.min(1, coverage / 0.8) + 0.3 * fresh + 0.25 * agree;
    const level = score === null ? 'None' : cs >= 0.72 ? 'High' : cs >= 0.5 ? 'Moderate' : 'Low';
    return { key: D.key, name: D.name, question: D.question, score, state: score === null ? 'No data' : LBL(score, mixed), arrow: score === null ? '·' : ARROW(score), mixed, notes, comps, confidence: { level, score: cs, coverage, fresh, agree }, unavailable: UNAVAILABLE[D.key], n: all.length };
  });
}

// ---------------------------------------------------------------------------
// LAYER 5: market forces (detected from combinations of indicators across domains)
const HZW = { long: 1, medium: 0.9, short: 0.75 };
const CONFW = { High: 1, Moderate: 0.8, Low: 0.6 };
const FORCES = [
  { id: 'trend', domains: ['tech'], horizon: 'medium', ev: ['t_ma200', 't_ma50_200', 't_slope200', 't_hhhl'], name: (d) => (d > 0 ? 'Uptrend intact' : 'Downtrend in force'),
    detect: (R, Dm) => { const t = comp(Dm, 'tech', 'Trend'); return t !== null && Math.abs(t) >= 0.3 ? { dir: Math.sign(t), str: Math.abs(t) } : null; },
    text: (d, R) => d > 0 ? `Price ${R.t_ma200?.disp ? `is ${R.t_ma200.disp.split(' (')[0]} versus its 200-day average` : 'holds above its long-term average'}, the 50-day sits ${R.t_ma50_200?.value >= 0 ? 'above' : 'below'} the 200-day and the long-term average is ${R.t_slope200?.value > 0 ? 'rising' : 'flat'}.` : `Price trades below its long-term average and the trend structure points down.` },
  { id: 'momentum', domains: ['tech'], horizon: 'short', ev: ['t_rsi', 't_macd', 't_roc30', 't_volume'], name: (d) => (d > 0 ? 'Momentum building' : 'Momentum fading'),
    detect: (R, Dm) => { const m = comp(Dm, 'tech', 'Momentum'); return m !== null && Math.abs(m) >= 0.35 ? { dir: Math.sign(m), str: Math.abs(m) } : null; },
    text: (d, R) => `RSI ${R.t_rsi ? f(R.t_rsi.value, 0) : '—'}, MACD ${R.t_macd?.value >= 0 ? 'above' : 'below'} zero, 30-day change ${R.t_roc30 ? pc(R.t_roc30.value) : '—'}.` },
  { id: 'stretch', domains: ['tech'], horizon: 'short', ev: ['t_mayer', 't_bbz', 't_rsiext'], name: (d) => (d < 0 ? 'Price stretched' : 'Washed out'),
    detect: (R, Dm) => { const e = comp(Dm, 'tech', 'Extension'), t = comp(Dm, 'tech', 'Trend'); if (e === null) return null; if (e <= -0.4) return { dir: -1, str: Math.abs(e) }; if (e >= 0.4 && (t ?? 0) <= 0) return { dir: 1, str: e * 0.8 }; return null; },
    text: (d, R) => d < 0 ? `Mayer Multiple ${R.t_mayer ? f(R.t_mayer.value, 2) : '—'}, price ${R.t_bbz ? R.t_bbz.disp.split(' (')[0] : '—'} from its 20-day mean: the move has run ahead of its averages.` : `Price sits ${R.t_bbz ? R.t_bbz.disp.split(' (')[0] : 'well'} below its 20-day mean with RSI ${R.t_rsi ? f(R.t_rsi.value, 0) : '—'}: selling looks exhausted short term.` },
  { id: 'squeeze', domains: ['tech', 'mkt'], horizon: 'short', ev: ['t_bbw', 't_rv', 'm_dvol'], name: () => 'Volatility compressed',
    detect: (R) => (R.t_bbw?.pctile !== null && R.t_bbw?.pctile <= 15 ? { dir: 0, str: 1 - R.t_bbw.pctile / 15 * 0.5 } : null),
    text: (d, R) => `Bollinger Band width is at the ${ord(R.t_bbw.pctile)} percentile of the past year. Compressed ranges tend to resolve in a larger move; the direction is not known in advance.` },
  { id: 'etf', domains: ['mkt'], horizon: 'medium', ev: ['m_etf5', 'm_etf20', 'm_etfacc'], name: (d) => (d > 0 ? 'Institutional demand' : 'Institutional outflows'),
    detect: (R) => { const a = R.m_etf5?.s, b = R.m_etf20?.s; const x = ok(b) ? 0.4 * (a ?? 0) + 0.6 * b : a; return ok(x) && Math.abs(x) >= 0.25 ? { dir: Math.sign(x), str: Math.min(1, Math.abs(x) * 1.2) } : null; },
    text: (d, R) => `US spot ETFs: ${R.m_etf5 ? R.m_etf5.disp : '—'} over five trading days${R.m_etf20 ? `, ${R.m_etf20.disp} over twenty` : ''}.` },
  { id: 'accum', domains: ['chain'], horizon: 'medium', ev: ['c_exnet', 'c_exbal', 'c_whales'], name: (d) => (d > 0 ? 'Coins leaving exchanges' : 'Coins moving to exchanges'),
    detect: (R) => { const a = R.c_exnet?.s, b = R.c_exbal?.s; if (!ok(a) && !ok(b)) return null; const x = mean([a, b].filter(ok)); return Math.abs(x) >= 0.3 ? { dir: Math.sign(x), str: Math.min(1, Math.abs(x)) } : null; },
    text: (d, R) => `Exchange netflow ${R.c_exnet ? R.c_exnet.disp : '—'} over 30 days; exchange balance ${R.c_exbal ? R.c_exbal.disp.split(' (')[0] : '—'}.` },
  { id: 'profit', domains: ['chain'], horizon: 'medium', ev: ['c_sopr', 'c_profit', 'c_lth'], name: () => 'Profit-taking / distribution',
    detect: (R) => { const a = R.c_sopr?.s, b = R.c_profit?.s, c = R.c_lth?.s; const x = Math.min(...[a, b, c].filter(ok)); return Number.isFinite(x) && x <= -0.35 ? { dir: -1, str: Math.min(1, -x) } : null; },
    text: (d, R) => `SOPR ${R.c_sopr ? R.c_sopr.disp : '—'}, ${R.c_profit ? R.c_profit.disp : '—'} of supply in profit, long-term holders at ${R.c_lth ? R.c_lth.disp.split(' (')[0] : '—'} their cost basis.` },
  { id: 'value', domains: ['chain', 'tech'], horizon: 'long', ev: ['c_mvrv', 'c_puell', 't_mayer'], name: (d) => (d > 0 ? 'Valuation reset' : 'Valuation stretched'),
    detect: (R, Dm) => { const v = comp(Dm, 'chain', 'Valuation'); return v !== null && Math.abs(v) >= 0.4 ? { dir: Math.sign(v), str: Math.min(1, Math.abs(v)) } : null; },
    text: (d, R) => `MVRV ${R.c_mvrv ? R.c_mvrv.disp : '—'}; Puell ${R.c_puell ? R.c_puell.disp : '—'}.` },
  { id: 'holders', domains: ['chain'], horizon: 'medium', ev: ['c_sth', 'c_sopr'], name: (d) => (d > 0 ? 'Recent buyers in profit' : 'Recent buyers underwater'),
    detect: (R) => { const x = R.c_sth?.s; return ok(x) && Math.abs(x) >= 0.4 ? { dir: Math.sign(x), str: Math.min(1, Math.abs(x)) } : null; },
    text: (d, R) => `Price is ${R.c_sth.disp}. ${d > 0 ? 'That cost basis tends to act as support on pullbacks.' : 'That cost basis tends to cap rallies as buyers get their money back.'}` },
  { id: 'leverage', domains: ['mkt'], horizon: 'short', ev: ['m_funding', 'm_oigrowth', 'm_oimcap', 'm_basis'], name: (d) => (d < 0 ? 'Leverage building' : 'Leverage flushed'),
    detect: (R) => { const a = R.m_funding?.s, b = R.m_oigrowth?.s, c = R.m_oimcap?.s; const lo = Math.min(...[a, b, c].filter(ok)); if (Number.isFinite(lo) && lo <= -0.3) return { dir: -1, str: Math.min(1, -lo) }; if (ok(b) && b >= 0.4 && (R.m_funding?.value ?? 0) <= 8) return { dir: 1, str: b * 0.8 }; return null; },
    text: (d, R) => `Funding ${R.m_funding ? R.m_funding.disp : '—'}; ${R.m_oigrowth ? R.m_oigrowth.disp : 'OI change n/a'}; OI ÷ market cap ${R.m_oimcap ? R.m_oimcap.disp.split(' (')[0] : '—'}.` },
  { id: 'stress', domains: ['mkt'], horizon: 'short', ev: ['m_skew', 'm_dvol', 'm_pcr'], name: () => 'Hedging demand / derivatives stress',
    detect: (R) => { const x = Math.min(...[R.m_skew?.s, R.m_dvol?.s].filter(ok)); return Number.isFinite(x) && x <= -0.4 ? { dir: -1, str: Math.min(1, -x) } : null; },
    text: (d, R) => `Skew ${R.m_skew ? R.m_skew.disp : '—'}; implied volatility ${R.m_dvol ? R.m_dvol.disp : '—'}.` },
  { id: 'spot', domains: ['mkt'], horizon: 'short', ev: ['m_cbp', 'm_taker', 'm_depth'], name: (d) => (d > 0 ? 'Spot buyers in control' : 'Spot selling pressure'),
    detect: (R, Dm) => { const s = comp(Dm, 'mkt', 'Spot demand'); return s !== null && Math.abs(s) >= 0.35 ? { dir: Math.sign(s), str: Math.min(1, Math.abs(s)) } : null; },
    text: (d, R) => `Coinbase premium ${R.m_cbp ? R.m_cbp.disp : '—'}; spot taker ratio ${R.m_taker ? R.m_taker.disp : '—'}.` },
  { id: 'stables', domains: ['chain', 'macro'], horizon: 'medium', ev: ['c_stab30', 'c_stab7', 'c_usdt'], name: (d) => (d > 0 ? 'Stablecoin liquidity expanding' : 'Stablecoin liquidity contracting'),
    detect: (R) => { const x = R.c_stab30?.s; return ok(x) && Math.abs(x) >= 0.25 ? { dir: Math.sign(x), str: Math.min(1, Math.abs(x)) } : null; },
    text: (d, R) => `Stablecoin supply ${R.c_stab30.disp} over 30 days${R.c_usdt ? `; ${R.c_usdt.disp}` : ''}.` },
  { id: 'liquidity', domains: ['macro'], horizon: 'long', ev: ['x_netliq4', 'x_netliq13', 'x_m2', 'x_g3'], name: (d) => (d > 0 ? 'Liquidity expanding' : 'Liquidity draining'),
    detect: (R, Dm) => { const l = comp(Dm, 'macro', 'Liquidity'); return l !== null && Math.abs(l) >= 0.3 ? { dir: Math.sign(l), str: Math.min(1, Math.abs(l)) } : null; },
    text: (d, R) => `US net liquidity ${R.x_netliq4 ? R.x_netliq4.disp.split(' (')[0] : '—'} over 4 weeks${R.x_m2 ? `; M2 ${R.x_m2.disp.split(' (')[0]} year on year` : ''}.` },
  { id: 'conditions', domains: ['macro'], horizon: 'medium', ev: ['x_dxy', 'x_real', 'x_2y'], name: (d) => (d < 0 ? 'Macro tightening' : 'Financial conditions easing'),
    detect: (R, Dm) => { const r = comp(Dm, 'macro', 'Rates'), u = comp(Dm, 'macro', 'Dollar'); if (r === null || u === null) return null; if (r <= -0.2 && u <= -0.2) return { dir: -1, str: Math.min(1, -(r + u) / 1.4) }; if (r >= 0.2 && u >= 0.2) return { dir: 1, str: Math.min(1, (r + u) / 1.4) }; return null; },
    text: (d, R) => `Dollar ${R.x_dxy ? R.x_dxy.disp.split(' (')[0] : '—'} over 4 weeks; 10-year real yield ${R.x_real ? R.x_real.disp.split(' (')[0] : '—'}.` },
  { id: 'risk', domains: ['macro'], horizon: 'medium', ev: ['x_vix', 'x_hy', 'x_ndx', 'x_corr'], name: (d) => (d > 0 ? 'Risk appetite firm' : 'Risk appetite deteriorating'),
    detect: (R, Dm) => { const x = comp(Dm, 'macro', 'Risk appetite'); if (x === null || Math.abs(x) < 0.35) return null; const c = Math.abs(R.x_corr?.value ?? 0.3); return { dir: Math.sign(x), str: Math.min(1, Math.abs(x) * (0.6 + 0.4 * c)) }; },
    text: (d, R) => `VIX ${R.x_vix ? R.x_vix.disp : '—'}; high-yield spreads ${R.x_hy ? R.x_hy.disp.split(' (')[0] : '—'}; Nasdaq ${R.x_ndx ? R.x_ndx.disp : '—'} over 4 weeks${R.x_corr ? `; BTC–Nasdaq correlation ${R.x_corr.disp}` : ''}.` },
  { id: 'heat', domains: ['sent'], horizon: 'medium', ev: ['s_fng', 's_fngchg', 's_wiki'], name: (d) => (d < 0 ? 'Sentiment overheating' : 'Extreme fear (contrarian)'),
    detect: (R, Dm, X, d) => { const v = R.s_fng?.value; if (!ok(v)) return null; const a7 = mean(vals(X.fng, d, 7)); if (v >= 78 && a7 >= 72) return { dir: -1, str: Math.min(1, (v - 70) / 20) }; if (v <= 25 && a7 <= 30) return { dir: 1, str: Math.min(1, (35 - v) / 20) }; return null; },
    text: (d, R) => `Fear & Greed ${R.s_fng.disp.split(' ·')[0]}${R.s_wiki ? `; public attention ${R.s_wiki.disp.split(' (')[0]} its 90-day norm` : ''}.` },
  { id: 'network', domains: ['chain'], horizon: 'long', ev: ['c_active', 'c_tx', 'c_hash'], name: (d) => (d > 0 ? 'Network activity growing' : 'Network activity slowing'),
    detect: (R, Dm) => { const x = comp(Dm, 'chain', 'Network activity'); return x !== null && Math.abs(x) >= 0.3 ? { dir: Math.sign(x), str: Math.min(1, Math.abs(x)) } : null; },
    text: (d, R) => `Active addresses ${R.c_active ? R.c_active.disp.split(' (')[0] : '—'} versus their 90-day average; hash rate ${R.c_hash ? R.c_hash.disp : '—'} over 30 days.` },
  { id: 'miners', domains: ['chain'], horizon: 'medium', ev: ['c_hashprice', 'c_puell'], name: () => 'Miner revenue squeeze',
    detect: (R) => (ok(R.c_hashprice?.s) && R.c_hashprice.s <= -0.4 ? { dir: -1, str: Math.min(1, -R.c_hashprice.s) } : null),
    text: (d, R) => `Hashprice ${R.c_hashprice.disp}. Squeezed miners sell more of what they mine.` },
];
const comp = (Dm, dk, c) => Dm.find((x) => x.key === dk)?.comps.find((y) => y.name === c)?.score ?? null;
function detectForces(X, d, R, Dm) {
  const out = [];
  for (const F of FORCES) {
    let r = null;
    try { r = F.detect(R, Dm, X, d); } catch { r = null; }
    if (!r || !ok(r.str)) continue;
    out.push({ id: F.id, dir: r.dir, strength: clamp(r.str, 0, 1) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// LAYERS 6–7: conclusions
const VAL_STATES = [[1.25, 'Depressed'], [0.5, 'Attractive'], [-0.5, 'Fair'], [-1.25, 'Elevated'], [-Infinity, 'Extreme']];
function valuation(X, d, R, Dm) {
  const t = techAt(X, d), p = t?.p ?? pAt(X, d), ev = [];
  const add = (id, name, v, disp, sc, w, src, asOf) => { if (ok(v) && ok(sc)) ev.push({ id, name, disp, score: sc, w, src, asOf, zone: sc >= 1 ? 'cheap' : sc >= 0.3 ? 'below average' : sc > -0.3 ? 'fair' : sc > -1 ? 'rich' : 'very rich' }); };
  const mv = R.c_mvrv;
  if (mv) add('mvrv', 'MVRV', mv.value, mv.disp.split(' ·')[0], interp([[0.8, 2], [1, 1.5], [1.5, 0.5], [2.0, -0.2], [2.4, -0.7], [3.2, -1.5], [3.8, -2]], mv.value), 3, mv.src, mv.asOf);
  if (t?.ma200) { const x = t.p / t.ma200; add('mayer', 'Mayer Multiple', x, f(x, 2), interp([[0.6, 2], [0.8, 1.2], [1.0, 0.4], [1.3, 0], [1.5, -0.5], [2.0, -1.2], [2.4, -2]], x), 2, SRC.px, t.asOf); }
  if (t?.ma200w) { const x = t.p / t.ma200w; add('w200', 'Price ÷ 200-week average', x, `${f(x, 2)}× (${usd(t.ma200w)})`, interp([[0.8, 2], [1.0, 1.3], [1.3, 0.5], [1.7, 0], [2.5, -0.8], [3.5, -1.6], [4.5, -2]], x), 2, SRC.px, t.asOf); }
  if (R.c_puell) add('puell', 'Puell Multiple', R.c_puell.value, R.c_puell.disp, interp([[0.5, 1.5], [0.8, 0.6], [1.2, 0], [1.6, -0.5], [2.5, -1.3], [3.5, -2]], R.c_puell.value), 1, R.c_puell.src, R.c_puell.asOf);
  if (R.c_profit) add('profit', 'Supply in profit', R.c_profit.value, R.c_profit.disp, interp([[50, 1.5], [60, 0.8], [75, 0.1], [85, -0.4], [92, -1], [97, -1.8]], R.c_profit.value), 1.5, R.c_profit.src, R.c_profit.asOf);
  if (R.c_sth && p) { const x = 1 + R.c_sth.value / 100; add('sth', 'Price ÷ short-term holder cost', x, `${f(x, 2)}×`, interp([[0.8, 1], [1, 0.3], [1.15, 0], [1.4, -0.8], [1.7, -1.5]], x), 1, R.c_sth.src, R.c_sth.asOf); }
  if (R.c_lth && p) add('lth', 'Price ÷ long-term holder cost', R.c_lth.value, R.c_lth.disp.split(' (')[0], interp([[0.8, 2], [1, 1.5], [1.5, 0.7], [2.5, 0], [4, -1], [6, -2]], R.c_lth.value), 1, R.c_lth.src, R.c_lth.asOf);
  if (!ev.length) return null;
  const W = ev.reduce((a, x) => a + x.w, 0), idxV = ev.reduce((a, x) => a + x.w * x.score, 0) / W;
  const state = VAL_STATES.find(([m]) => idxV >= m)[1];
  const sd = std(ev.map((x) => x.score)) ?? 0;
  const conf = ev.length >= 5 && sd < 0.8 ? 'High' : ev.length >= 3 && sd < 1.2 ? 'Moderate' : 'Low';
  const dem = (Dm.find((x) => x.key === 'mkt')?.score ?? 0) + (Dm.find((x) => x.key === 'macro')?.score ?? 0);
  const context = state === 'Elevated' || state === 'Extreme'
    ? (dem > 0.3 ? 'Demand and liquidity are still supportive, which historically allows rich valuations to persist for a while; it also leaves less room for error.' : 'Demand and liquidity are not offsetting it, so the valuation is a genuine headwind.')
    : state === 'Depressed' || state === 'Attractive'
      ? (dem < -0.3 ? 'Demand and liquidity are weak, so cheap readings can stay cheap; value is a long-horizon support, not a timing signal.' : 'With demand and liquidity not working against it, the valuation backdrop is a support.')
      : 'Valuation offers no strong edge either way; the other domains matter more for now.';
  return { state, index: idxV, confidence: conf, evidence: ev.sort((a, b) => b.w - a.w), context, mvrvPctile: mv?.pctile ?? null };
}

const HALVINGS = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20'];
function cycle(X, d, R, Dm, V) {
  const t = techAt(X, d); if (!t?.ma200) return null;
  const slope = R.t_slope200?.value ?? null, val = V?.state, fng = R.s_fng?.value, fund = R.m_funding?.value, sth = R.c_sth?.value, mvrv = R.c_mvrv?.value, mom = comp(Dm, 'tech', 'Momentum');
  const above = t.p > t.ma200, gold = t.ma50 > t.ma200, draw = t.dd ?? 0;
  const C = (c) => (c === null || c === undefined ? null : c ? 1 : 0);
  const PH = [
    { name: 'Capitulation', desc: 'Forced selling near the bottom of a bear market: price below the average holder cost, extreme fear.', c: [[3, C(ok(mvrv) ? mvrv < 1 : null), 'MVRV below 1'], [1, C(draw < -50), 'Drawdown deeper than 50%'], [1, C(ok(fng) ? fng <= 25 : null), 'Extreme fear'], [1, C(!above), 'Below the 200-day average'], [1, C(ok(R.c_sopr?.value) ? R.c_sopr.value < 0.98 : null), 'Coins selling at a loss (SOPR < 0.98)']] },
    { name: 'Contraction', desc: 'A bear market: falling long-term trend, recent buyers underwater.', c: [[2, C(!above), 'Below the 200-day average'], [2, C(ok(slope) ? slope < -0.5 : null), '200-day average falling'], [1.5, C(ok(sth) ? sth < 0 : null), 'Price below short-term holder cost'], [1, C(draw < -30), 'Drawdown deeper than 30%'], [1, C(!gold), '50-day below 200-day']] },
    { name: 'Accumulation', desc: 'Base-building after a decline: cheap valuations, flat long-term trend.', c: [[2, C(val ? ['Depressed', 'Attractive'].includes(val) : null), 'Valuation attractive or depressed'], [1, C(draw < -30), 'Drawdown deeper than 30%'], [1.5, C(Math.abs(t.p / t.ma200 - 1) < 0.1), 'Price near the 200-day average'], [1, C(ok(slope) ? Math.abs(slope) < 1.5 : null), '200-day average flat'], [0.5, C(ok(fng) ? fng < 50 : null), 'Sentiment below neutral']] },
    { name: 'Early expansion', desc: 'A new uptrend forming from a reset: trend turning up, valuation still moderate, price well below the old high.', c: [[2, C(above), 'Above the 200-day average'], [1.5, C(ok(slope) ? slope > 0 : null), '200-day average rising'], [1.5, C(val ? ['Fair', 'Attractive', 'Depressed'].includes(val) : null), 'Valuation fair or cheaper'], [1, C(draw < -20), 'More than 20% below the all-time high'], [1, C(ok(sth) ? sth > 0 : null), 'Recent buyers in profit']] },
    { name: 'Expansion', desc: 'An established uptrend: rising averages, recent buyers in profit, price close to its highs.', c: [[2, C(above), 'Above the 200-day average'], [1.5, C(gold), '50-day above 200-day'], [1.5, C(ok(slope) ? slope > 1 : null), '200-day average rising more than 1% a month'], [1, C(val ? ['Fair', 'Elevated'].includes(val) : null), 'Valuation fair to elevated'], [1, C(ok(sth) ? sth > 0 : null), 'Recent buyers in profit'], [1, C(draw > -20), 'Within 20% of the all-time high']] },
    { name: 'Late expansion', desc: 'A mature uptrend running hot: rich valuations, crowded sentiment and leverage.', c: [[2.5, C(val ? ['Elevated', 'Extreme'].includes(val) : null), 'Valuation elevated or extreme'], [1, C(above), 'Above the 200-day average'], [1, C(ok(fng) ? fng >= 75 : null), 'Greed'], [1, C(ok(fund) ? fund > 20 : null), 'Funding above 20% a year'], [1, C(t.p / t.ma200 > 1.8), 'Mayer Multiple above 1.8']] },
    { name: 'Distribution', desc: 'Topping behaviour: rich valuations with weakening momentum while still above the long-term trend.', c: [[2, C(val ? ['Elevated', 'Extreme'].includes(val) : null), 'Valuation elevated or extreme'], [1.5, C(t.p < t.ma50), 'Below the 50-day average'], [1, C(ok(mom) ? mom < -0.2 : null), 'Momentum negative'], [1, C(ok(R.c_profit?.value) ? R.c_profit.value > 85 : null), 'More than 85% of supply in profit'], [1, C(above), 'Still above the 200-day average']] },
    { name: 'Mid-cycle correction', desc: 'A pullback inside an intact long-term uptrend.', c: [[1.5, C(above), 'Above the 200-day average'], [1.5, C(t.p < t.ma50), 'Below the 50-day average'], [1.5, C(val === 'Fair'), 'Valuation fair'], [1, C(draw < -15 && draw > -40), '15–40% below the all-time high']] },
  ];
  const scored = PH.map((p) => { const ev = p.c.filter((c) => c[1] !== null), w = ev.reduce((a, c) => a + c[0], 0), all = p.c.reduce((a, c) => a + c[0], 0); const m = w ? ev.reduce((a, c) => a + c[0] * c[1], 0) / w : 0; return { ...p, match: m * Math.min(1, w / (all * 0.7)), met: ev.filter((c) => c[1]).map((c) => c[2]), unmet: ev.filter((c) => !c[1]).map((c) => c[2]) }; }).sort((a, b) => b.match - a.match);
  const best = scored[0], second = scored[1];
  const last = HALVINGS.filter((h) => h <= d).at(-1), days = last ? dd(last, d) : null;
  return { phase: best.name, desc: best.desc, match: best.match, met: best.met, unmet: best.unmet, runnerUp: second.match >= best.match - 0.1 ? { phase: second.name, match: second.match } : null, transitional: second.match >= best.match - 0.1, halving: last ? { date: last, days, note: `${days} days since the ${last.slice(0, 4)} halving. Shown for context; it does not set the phase.` } : null, confidence: best.match >= 0.85 && !(second.match >= best.match - 0.1) ? 'High' : best.match >= 0.7 ? 'Moderate' : 'Low' };
}

function riskRegime(R, Dm, V, divergences) {
  const pts = [], add = (n, why) => pts.push({ n, why });
  if (ok(R.t_rv?.pctile) && R.t_rv.pctile >= 80) add(2, `Realised volatility at the ${ord(R.t_rv.pctile)} percentile of the year`);
  if (R.m_dvol?.s <= -0.4) add(1, 'Implied volatility high');
  if (ok(R.m_funding?.value)) { if (R.m_funding.value > 30) add(2, 'Funding above 30% a year'); else if (R.m_funding.value > 20) add(1, 'Funding above 20% a year'); }
  if (R.m_oimcap?.s <= -0.3) add(1, 'Open interest high relative to market cap');
  if (R.m_oigrowth?.s <= -0.4) add(1, 'Leverage growing faster than price');
  if (V?.state === 'Elevated') add(1, 'Valuation elevated'); if (V?.state === 'Extreme') add(2, 'Valuation extreme');
  if (R.x_vix?.value > 25) add(1, 'Equity volatility (VIX) above 25');
  if (R.x_hy?.s <= -0.4) add(1, 'Credit spreads widening');
  if (R.s_fng && (R.s_fng.value >= 80 || R.s_fng.value <= 20)) add(1, 'Sentiment at an extreme');
  if (divergences >= 2) add(1, `${divergences} cross-domain divergences`);
  if (R.t_dd?.value < -35 && R.t_ma200?.value < 0) add(1, 'Deep drawdown below a falling trend');
  const n = pts.reduce((a, x) => a + x.n, 0);
  const level = n >= 6 ? 'High' : n >= 4 ? 'Elevated' : n >= 2 ? 'Moderate' : 'Low';
  return { level, points: n, evidence: pts, desc: { Low: 'Few stress signals: moves are orderly and leverage is contained.', Moderate: 'Some stress signals; normal for an active market.', Elevated: 'Several stress signals line up: larger, faster moves are more likely in either direction.', High: 'Many stress signals: conditions are fragile.' }[level] };
}

// cross-domain confirmation and divergence
const PAIR_TXT = {
  'tech|macro': 'price strength is running against the macro backdrop', 'tech|chain': 'price and on-chain behaviour disagree', 'tech|mkt': 'price and capital flows disagree',
  'tech|sent': 'price and sentiment disagree', 'chain|macro': 'on-chain behaviour and the macro backdrop disagree', 'chain|mkt': 'holders and market flows disagree',
  'mkt|macro': 'crypto-native demand is running against the macro backdrop', 'sent|mkt': 'sentiment and positioning disagree', 'chain|sent': 'holders and sentiment disagree', 'sent|macro': 'sentiment and macro disagree',
};
function crossDomain(R, Dm) {
  const live = Dm.filter((x) => x.score !== null), up = live.filter((x) => x.score >= 0.15), dn = live.filter((x) => x.score <= -0.15);
  const agree = [];
  if (up.length >= 3) agree.push({ dir: 1, domains: up.map((x) => x.name), text: `${joinAnd(up.map((x) => x.name))} all point the same way (supportive). Independent agreement is stronger than any single indicator.` });
  if (dn.length >= 3) agree.push({ dir: -1, domains: dn.map((x) => x.name), text: `${joinAnd(dn.map((x) => x.name))} all point the same way (cautionary).` });
  const div = [];
  for (const a of up) for (const b of dn) { const k = [a.key, b.key].join('|'), k2 = [b.key, a.key].join('|'); div.push({ kind: 'domains', a: a.name, b: b.name, text: `${a.name} ${a.arrow} versus ${b.name} ${b.arrow}: ${PAIR_TXT[k] || PAIR_TXT[k2] || 'the two domains disagree'}.` }); }
  const T = comp(Dm, 'tech', 'Trend');
  if (T >= 0.3 && R.m_oigrowth?.s <= -0.3) div.push({ kind: 'pattern', text: 'Price is rising while leverage grows faster than price: part of the move rests on borrowed money, which can unwind quickly.' });
  if (T >= 0.3 && R.m_etf5?.s <= -0.3) div.push({ kind: 'pattern', text: 'The uptrend is holding while US spot ETFs are seeing outflows: the advance lacks institutional sponsorship for now.' });
  if (T <= -0.3 && (R.c_exnet?.s >= 0.3 || R.c_exbal?.s >= 0.3)) div.push({ kind: 'pattern', constructive: true, text: 'Price is weak while coins keep leaving exchanges: holders are accumulating into weakness (a constructive divergence).' });
  if (R.s_fng?.value >= 75 && comp(Dm, 'mkt', 'Spot demand') <= -0.2) div.push({ kind: 'pattern', text: 'Sentiment is greedy while spot demand is soft: optimism is running ahead of actual buying.' });
  if (R.s_fng?.value <= 30 && T >= 0.3) div.push({ kind: 'pattern', constructive: true, text: 'Sentiment is fearful even though the trend is up: a wall of worry rather than euphoria.' });
  // lens rows for the confirmation matrix (beyond the five domains)
  const lens = [
    R.m_etf5 && { name: 'ETF flows', arrow: ARROW(R.m_etf5.s), s: R.m_etf5.s, note: R.m_etf5.disp },
    (R.m_oigrowth || R.m_funding) && { name: 'Leverage', arrow: ARROW(-(R.m_oigrowth?.s ?? R.m_funding.s)), s: R.m_oigrowth?.s ?? R.m_funding.s, note: R.m_oigrowth?.disp || R.m_funding.disp, inverse: true },
    R.s_fng && { name: 'Sentiment heat', arrow: ARROW((R.s_fng.value - 50) / 40), s: R.s_fng.s, note: R.s_fng.disp.split(' ·')[0], inverse: true },
    R.c_stab30 && { name: 'Stablecoin liquidity', arrow: ARROW(R.c_stab30.s), s: R.c_stab30.s, note: R.c_stab30.disp.split(' (')[0] },
  ].filter(Boolean);
  return { agree, diverge: div, lens };
}

// Fair Grade: a configuration score built from explicit contributions (not an average)
const VAL_ADJ = { Depressed: 6, Attractive: 3, Fair: 0, Elevated: -4, Extreme: -8 };
function fairGrade(Dm, V, risk, divCount, breadth) {
  const D = (k) => Dm.find((x) => x.key === k), sc = (k) => D(k)?.score ?? 0, cf = (k) => ({ High: 1, Moderate: 0.85, Low: 0.65, None: 0 }[D(k)?.confidence.level] ?? 0);
  const c = (k, n) => comp(Dm, k, n) ?? 0;
  const parts = [
    { key: 'trend', label: 'Trend', max: 12, x: sc('tech') * cf('tech'), note: 'Technical domain (trend, momentum, structure).' },
    { key: 'demand', label: 'Demand', max: 12, x: (0.5 * c('mkt', 'Institutional demand') + 0.25 * c('mkt', 'Spot demand') + 0.25 * c('chain', 'Exchange behaviour')) * Math.min(cf('mkt'), cf('chain') || 1), note: 'ETF flows, spot buying and coins leaving exchanges.' },
    { key: 'network', label: 'Network & holders', max: 8, x: (0.6 * c('chain', 'Holder behaviour') + 0.4 * c('chain', 'Network activity')) * cf('chain'), note: 'Holder profitability and network use.' },
    { key: 'liquidity', label: 'Liquidity', max: 10, x: (0.7 * sc('macro') + 0.3 * c('chain', 'On-chain liquidity')) * cf('macro'), note: 'Macro liquidity, rates, dollar and stablecoins.' },
    { key: 'positioning', label: 'Positioning', max: 8, x: (0.4 * c('mkt', 'Leverage') + 0.3 * c('mkt', 'Derivatives') + 0.3 * sc('sent')) * Math.min(cf('mkt'), cf('sent') || 1), note: 'Leverage, derivatives and sentiment.' },
  ].map((p) => ({ ...p, pts: Math.round(clamp(p.x, -1, 1) * p.max * 10) / 10 }));
  const breadthPts = clamp((breadth.n - 2.5) * 1.5, -4, 4);
  const riskPts = -(Math.min(3, divCount) * 1.5) - ({ High: 4, Elevated: 2 }[risk.level] || 0);
  const valPts = V ? VAL_ADJ[V.state] : 0;
  parts.push({ key: 'breadth', label: 'Breadth', max: 4, pts: breadthPts, note: `${breadth.n} of ${breadth.of} domains supportive.` });
  parts.push({ key: 'risk', label: 'Risk adjustment', max: 8.5, pts: riskPts, note: `${divCount} divergence(s); risk regime ${risk.level.toLowerCase()}.` });
  parts.push({ key: 'valuation', label: 'Valuation adjustment', max: 8, pts: valPts, note: V ? `Valuation ${V.state.toLowerCase()}.` : 'Valuation unavailable.' });
  const raw = 50 + parts.reduce((a, p) => a + p.pts, 0);
  return { value: Math.round(clamp(raw, 0, 100)), parts };
}

// full synthesis for one date (optionally restricted to a set of indicator ids)
function synth(X, d, R, only) {
  const Rx = only ? Object.fromEntries(Object.entries(R).filter(([k]) => only.has(k))) : R;
  const Dm = synthDomains(Rx, only);
  const live = Dm.filter((x) => x.score !== null);
  const breadth = { n: live.filter((x) => x.score >= 0.15).length, neg: live.filter((x) => x.score <= -0.15).length, of: live.length };
  const W = { tech: 0.25, chain: 0.2, mkt: 0.25, sent: 0.1, macro: 0.2 };
  const wsum = live.reduce((a, x) => a + W[x.key], 0), overall = wsum ? live.reduce((a, x) => a + W[x.key] * x.score, 0) / wsum : 0;
  let state;
  if (overall >= 0.35 && breadth.n >= 4) state = 'Strong';
  else if (overall >= 0.15 && breadth.n >= 3) state = 'Constructive';
  else if (overall >= 0.12) state = 'Constructive';
  else if (overall <= -0.35 && breadth.neg >= 4) state = 'Weak';
  else if (overall <= -0.12) state = 'Cautious';
  else state = breadth.n >= 2 && breadth.neg >= 2 ? 'Mixed' : 'Neutral';
  const V = valuation(X, d, Rx, Dm);
  const cross = crossDomain(Rx, Dm);
  const divCount = cross.diverge.filter((x) => !x.constructive).length;
  const risk = riskRegime(Rx, Dm, V, divCount);
  const grade = fairGrade(Dm, V, risk, divCount, breadth);
  return { Dm, breadth, overall, state, V, cross, risk, grade, R: Rx };
}

// ---------------------------------------------------------------------------
// LAYER 8 + orchestration
export function intelligence(input) {
  const X = input?.today ? input : buildInputs(input);
  X.nowIso = input?.nowIso || new Date().toISOString();
  X.totalMcap = X.M.structure && X.M.price?.marketCap && X.M.structure.dominance ? X.M.price.marketCap / (X.M.structure.dominance / 100) : null;
  const d = X.today;
  const R = readingsAt(X, d);
  const S = synth(X, d, R);
  // indicator deterioration vs 7 days ago
  const R7 = readingsAt(X, shiftDate(d, -7));
  for (const r of Object.values(R)) { r.state = STATE(r.s); const p = R7[r.id]?.s; r.prev7 = ok(p) ? p : null; if (r.s !== null && (r.s <= -0.7 || (r.s <= -0.2 && ok(p) && r.s - p <= -0.25))) r.state = 'Deteriorating'; }
  // forces: today, plus persistence and trend from daily re-evaluation over 30 days
  const today = detectForces(X, d, R, S.Dm);
  const hist = {};
  for (let k = 1; k <= 30; k++) { const dk = shiftDate(d, -k), Rk = readingsAt(X, dk); hist[k] = detectForces(X, dk, Rk, synthDomains(Rk)); }
  const forces = today.map((F) => {
    const def = FORCES.find((x) => x.id === F.id);
    let persist = 0; for (let k = 1; k <= 30; k++) { if (hist[k].some((y) => y.id === F.id && y.dir === F.dir)) persist++; else break; }
    const prev = hist[7]?.find((y) => y.id === F.id && y.dir === F.dir)?.strength ?? null;
    const trend = prev === null ? 'new' : F.strength - prev >= 0.1 ? 'strengthening' : F.strength - prev <= -0.1 ? 'weakening' : 'steady';
    const evR = def.ev.map((id) => R[id]).filter(Boolean);
    const qn = evR.length ? mean(evR.map((r) => r.q)) : 0;
    const confidence = evR.length >= 3 && qn >= 0.9 ? 'High' : evR.length >= 2 && qn >= 0.7 ? 'Moderate' : 'Low';
    const rank = F.strength * CONFW[confidence] * HZW[def.horizon] * (persist >= 5 ? 1.05 : 1);
    return { id: F.id, name: def.name(F.dir), dir: F.dir, strength: F.strength, strengthWord: F.strength >= 0.7 ? 'Strong' : F.strength >= 0.45 ? 'Moderate' : 'Mild', confidence, horizon: def.horizon, horizonText: { short: 'Short term (days)', medium: 'Medium term (weeks)', long: 'Long term (months)' }[def.horizon], domains: def.domains.map((k) => DOMAINS.find((x) => x.key === k).name), persistence: persist, trend, rank, text: def.text(F.dir, R), evidence: evR.map((r) => ({ id: r.id, name: r.name, disp: r.disp, state: r.state, asOf: r.asOf, src: r.src })) };
  }).sort((a, b) => b.rank - a.rank);
  const drivers = forces.filter((x) => x.dir > 0), offsets = forces.filter((x) => x.dir < 0), watch = forces.filter((x) => x.dir === 0);
  // what changed: like-for-like over 2, 7 and 30 days
  const changes = {};
  for (const h of [2, 7, 30]) {
    const dh = shiftDate(d, -h), Rh = readingsAt(X, dh);
    const common = new Set(Object.keys(R).filter((k) => R[k].s !== null && Rh[k] && Rh[k].s !== null));
    if (common.size < 8) { changes['d' + h] = { h, label: 'Not enough history', text: `Only ${common.size} indicators have readings on both dates.`, n: common.size }; continue; }
    const A = synth(X, d, R, common), B = synth(X, dh, Rh, common);
    const doms = A.Dm.map((x) => { const y = B.Dm.find((z) => z.key === x.key); return { key: x.key, name: x.name, now: x.score, then: y?.score ?? null, delta: x.score !== null && y?.score !== null && y ? x.score - y.score : null, stateNow: x.state, stateThen: y?.state }; });
    const up = doms.filter((x) => x.delta >= 0.1), dn = doms.filter((x) => x.delta <= -0.1);
    const label = up.length && !dn.length ? 'Improving' : dn.length && !up.length ? 'Deteriorating' : up.length && dn.length ? 'Mixed' : 'Little changed';
    const movers = [...common].map((k) => ({ id: k, name: R[k].name, dom: DOMAINS.find((x) => x.key === R[k].domain).name, ds: R[k].s - Rh[k].s, w: R[k].w, from: Rh[k].disp, to: R[k].disp })).filter((x) => Math.abs(x.ds) >= 0.15).sort((a, b) => Math.abs(b.ds) * b.w - Math.abs(a.ds) * a.w);
    const pos = movers.filter((m) => m.ds > 0).slice(0, 3), neg = movers.filter((m) => m.ds < 0).slice(0, 3);
    const bit = (m) => `${m.name} (${m.from.split(' (')[0]} → ${m.to.split(' (')[0]})`;
    const text = label === 'Little changed' ? `No domain moved meaningfully${movers[0] ? `; the largest single change was ${bit(movers[0])}` : ''}.`
      : `${up.length ? `${joinAnd(up.map((x) => x.name))} improved${pos[0] ? ` as ${bit(pos[0])}` : ''}` : ''}${up.length && dn.length ? ', while ' : ''}${dn.length ? `${joinAnd(dn.map((x) => x.name))} ${up.length ? 'weakened' : 'weakened'}${neg[0] ? ` as ${bit(neg[0])}` : ''}` : ''}.`;
    changes['d' + h] = { h, label, text: cap(text), stateNow: A.state, stateThen: B.state, gradeNow: A.grade.value, gradeThen: B.grade.value, domains: doms, movers: { up: pos, down: neg }, n: common.size, of: Object.values(R).filter((r) => r.s !== null).length };
  }
  const C = cycle(X, d, R, S.Dm, S.V);
  const out = {
    version: INTEL_VERSION, asOf: d, generatedAt: X.nowIso,
    state: S.state, overall: S.overall, breadth: S.breadth, grade: S.grade,
    confidence: (() => { const l = S.Dm.filter((x) => x.score !== null).map((x) => x.confidence.score); const m = mean(l) ?? 0; return { level: m >= 0.72 ? 'High' : m >= 0.5 ? 'Moderate' : 'Low', score: m }; })(),
    domains: S.Dm.map((x) => ({ ...x, comps: x.comps.map((c) => ({ ...c, indicators: c.indicators.map((i) => R[i.id] || i) })) })),
    forces, drivers, offsets, watch,
    confirmation: S.cross, changes, valuation: S.V, cycle: C, risk: S.risk,
    readings: R,
  };
  out.narrative = narrative(out);
  out.headline = `${out.state} · Fair Grade ${out.grade.value}/100 · ${out.breadth.n} of ${out.breadth.of} domains supportive`;
  return out;
}

// plain-English explanation of the conclusion (templated from the evidence; no forecasts)
function narrative(I) {
  const P = [], D = (k) => I.domains.find((x) => x.key === k);
  const sup = I.domains.filter((x) => x.score >= 0.15).map((x) => x.name.toLowerCase()), neg = I.domains.filter((x) => x.score !== null && x.score <= -0.15).map((x) => x.name.toLowerCase());
  P.push(`Bitcoin’s overall market configuration reads <b>${I.state.toLowerCase()}</b>, with a Fair Grade of ${I.grade.value} out of 100. ${I.breadth.n} of the ${I.breadth.of} analytical domains are supportive${sup.length ? ` (${joinAnd(sup)})` : ''}${neg.length ? `, while ${joinAnd(neg)} ${neg.length > 1 ? 'lean' : 'leans'} against it` : ''}. ${I.cycle ? `Taken together, the evidence places the market in <b>${I.cycle.phase.toLowerCase()}</b>${I.cycle.transitional && I.cycle.runnerUp ? ` (bordering on ${I.cycle.runnerUp.phase.toLowerCase()})` : ''}` : ''}${I.valuation ? `${I.cycle ? ', with valuation' : 'Valuation is'} <b>${I.valuation.state.toLowerCase()}</b>` : ''}.`);
  if (I.drivers.length) P.push(`The strongest supports right now: ${I.drivers.slice(0, 3).map((x) => `<b>${x.name.toLowerCase()}</b> — ${x.text.replace(/\.$/, '')}`).join('; ')}.${I.drivers[0].persistence >= 7 ? ` The lead support has held for ${I.drivers[0].persistence >= 30 ? 'at least 30' : I.drivers[0].persistence} days, so it is not a one-day blip.` : ''}`);
  if (I.offsets.length) P.push(`Holding it back: ${I.offsets.slice(0, 3).map((x) => `<b>${x.name.toLowerCase()}</b> — ${x.text.replace(/\.$/, '')}`).join('; ')}.${I.offsets.some((x) => x.horizon === 'short') && I.drivers.some((x) => x.horizon !== 'short') ? ' Some of these offsets are short-term in nature, while the main supports work over weeks to months; the engine weighs them accordingly.' : ''}`);
  const cr = I.confirmation;
  if (cr.agree.length || cr.diverge.length) P.push(`${cr.agree.length ? cr.agree[0].text + ' ' : ''}${cr.diverge.length ? `Where the picture disagrees: ${cr.diverge.slice(0, 2).map((x) => x.text.replace(/\.$/, '')).join('; ')}.` : 'There are no notable divergences between domains.'}`);
  const c2 = I.changes.d2, c7 = I.changes.d7;
  P.push(`${c2?.label && c2.label !== 'Not enough history' ? `Over the last two days the picture is ${c2.label.toLowerCase()}: ${c2.text.charAt(0).toLowerCase() + c2.text.slice(1)}` : ''} ${c7?.label && c7.label !== 'Not enough history' ? `Over a week it is ${c7.label.toLowerCase()}.` : ''} The risk regime is <b>${I.risk.level.toLowerCase()}</b>: ${I.risk.desc.charAt(0).toLowerCase() + I.risk.desc.slice(1)}${I.watch.length ? ` Also worth watching: ${I.watch.map((x) => x.name.toLowerCase()).join(', ')}.` : ''}`.trim());
  return P;
}
