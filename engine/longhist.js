// Long history for the Analysis deep dives (data/longhist.json), collected once per daily
// run from the same free sources the agent already uses, with longer windows:
//   FRED (since 2015, plus NFCI financial conditions), Yahoo Finance daily closes (10 years),
//   Coin Metrics Community (full history: supply, exchange flows/balance, activity, hash rate),
//   DefiLlama total stablecoin supply, alternative.me Fear & Greed (since 2018) and
//   Wikimedia pageviews for the "Bitcoin" article (since 2016).
// Points older than two years are thinned to one per week to keep the file light. A series
// that fails to refresh keeps its previous values and is marked stale with its own date.

import { fetchJSON, fetchText, num, isoDate, DAY } from './util.js';
import { FRED_SERIES, parseFredCsv } from './collect.js';

const UA = { 'User-Agent': 'Mozilla/5.0 (BTC Intel market research agent; +https://btcintel.org/)' };
export const LONG_FRED = { ...FRED_SERIES, NFCI: { label: 'Chicago Fed National Financial Conditions Index', unit: 'index', scale: 1, freq: 'weekly' } };
export const LONG_YAHOO = { DXY: 'DX-Y.NYB', NDX: '^NDX', SPX: '^GSPC', GOLD: 'GC=F', VIX: '^VIX', ACWI: 'ACWI' };
const CM = ['SplyCur', 'SplyExNtv', 'FlowInExNtv', 'FlowOutExNtv', 'AdrActCnt', 'TxCnt', 'HashRate'];

// round to 6 significant digits and thin to weekly before the last two years
const sig = (v) => (v === 0 ? 0 : +v.toPrecision(6));
export function compact(pts, keepDailyDays = 730, now = Date.now()) {
  const cut = isoDate(now - keepDailyDays * DAY), out = [];
  let wk = null;
  for (const [d, v] of pts) {
    if (!Number.isFinite(v)) continue;
    if (d >= cut) { out.push([d, sig(v)]); continue; }
    const w = Math.floor(Date.parse(d) / (7 * DAY));
    if (w === wk) out[out.length - 1] = [d, sig(v)]; else out.push([d, sig(v)]);
    wk = w;
  }
  return out;
}

async function fred() {
  const out = {}, errors = [];
  await Promise.all(Object.entries(LONG_FRED).map(async ([id, meta]) => {
    try {
      const t = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=2015-01-01`, { headers: UA }, 40000);
      let pts = parseFredCsv(t), scale = meta.scale;
      if (scale === 'auto') scale = pts.length && pts.at(-1)[1] > 1e5 ? 1e-3 : 1;
      if (pts.length) out['fred.' + id] = pts.map(([d, v]) => [d, v * scale]);
    } catch (e) { errors.push(`${id}: ${e.message}`.slice(0, 80)); }
  }));
  return { out, errors };
}
async function yahoo() {
  const out = {}, errors = [];
  await Promise.all(Object.entries(LONG_YAHOO).map(async ([k, sym]) => {
    for (const host of ['query1', 'query2']) {
      try {
        const j = await fetchJSON(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=10y&interval=1d`, { headers: UA }, 40000);
        const r = j.chart.result[0], c = r.indicators.quote[0].close;
        const pts = r.timestamp.map((t, i) => [isoDate(t * 1000), num(c[i])]).filter(([, v]) => v !== null);
        if (pts.length) { out['yahoo.' + k] = pts; return; }
      } catch (e) { if (host === 'query2') errors.push(`${k}: ${e.message}`.slice(0, 80)); }
    }
  }));
  return { out, errors };
}
async function coinmetrics() {
  const j = await fetchJSON(`https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=${CM.join(',')}&frequency=1d&start_time=2010-07-18&page_size=10000`, {}, 90000);
  const rows = j.data || [], out = {};
  for (const m of CM) { const pts = rows.map((r) => [String(r.time).slice(0, 10), num(r[m])]).filter(([, v]) => v !== null); if (pts.length) out['cm.' + m] = pts; }
  if (!Object.keys(out).length) throw new Error('no Coin Metrics rows');
  return { out, errors: [] };
}
async function stables() {
  const j = await fetchJSON('https://stablecoins.llama.fi/stablecoincharts/all', {}, 40000);
  const pts = j.map((r) => [isoDate(num(r.date) * 1000), num(r.totalCirculatingUSD?.peggedUSD ?? r.totalCirculating?.peggedUSD)]).filter(([, v]) => v);
  return { out: { 'llama.stables': pts }, errors: [] };
}
async function fng() {
  const j = await fetchJSON('https://api.alternative.me/fng/?limit=0', {}, 40000);
  const pts = (j.data || []).map((x) => [isoDate(+x.timestamp * 1000), +x.value]).filter(([, v]) => Number.isFinite(v)).reverse();
  return { out: { 'fng.value': pts }, errors: [] };
}
async function wiki() {
  const ymd = (t) => isoDate(t).replace(/-/g, '');
  const j = await fetchJSON(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Bitcoin/daily/20160101/${ymd(Date.now() - DAY)}`, { headers: UA }, 40000);
  const pts = (j.items || []).map((i) => [`${i.timestamp.slice(0, 4)}-${i.timestamp.slice(4, 6)}-${i.timestamp.slice(6, 8)}`, i.views]).filter(([, v]) => Number.isFinite(v));
  const out = { 'wiki.views': pts }, errors = [];
  try { const k = await fetchJSON(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Cryptocurrency/daily/20160101/${ymd(Date.now() - DAY)}`, { headers: UA }, 40000); const c = (k.items || []).map((i) => [`${i.timestamp.slice(0, 4)}-${i.timestamp.slice(4, 6)}-${i.timestamp.slice(6, 8)}`, i.views]).filter(([, v]) => Number.isFinite(v)); if (c.length) out['wiki.crypto'] = c; } catch (e) { errors.push(`Cryptocurrency: ${e.message}`.slice(0, 80)); }
  return { out, errors };
}

export const LONG_SOURCES = {
  fred: { name: 'FRED (Federal Reserve Bank of St. Louis)', url: 'https://fred.stlouisfed.org', fn: fred },
  yahoo: { name: 'Yahoo Finance daily closes', url: 'https://finance.yahoo.com', fn: yahoo },
  cm: { name: 'Coin Metrics Community API', url: 'https://coinmetrics.io/community-network-data/', fn: coinmetrics },
  llama: { name: 'DefiLlama stablecoins', url: 'https://defillama.com/stablecoins', fn: stables },
  fng: { name: 'alternative.me Fear & Greed Index', url: 'https://alternative.me/crypto/fear-and-greed-index/', fn: fng },
  wiki: { name: 'Wikimedia pageviews (en.wikipedia “Bitcoin”, “Cryptocurrency”)', url: 'https://pageviews.wmcloud.org/?pages=Bitcoin|Cryptocurrency&project=en.wikipedia.org', fn: wiki },
};

// Collect everything; anything that fails keeps the previous series (marked stale).
export async function collectLong(prev, log = () => {}) {
  const series = { ...(prev?.series || {}) }, sources = { ...(prev?.sources || {}) };
  await Promise.all(Object.entries(LONG_SOURCES).map(async ([k, S]) => {
    try {
      const { out, errors } = await S.fn();
      for (const [key, pts] of Object.entries(out)) series[key] = compact(pts);
      sources[k] = { name: S.name, url: S.url, status: 'ok', fetchedAt: new Date().toISOString(), asOf: Object.entries(out).map(([, p]) => p.at(-1)?.[0]).filter(Boolean).sort().at(-1) || null, ...(errors.length ? { note: errors.join('; ') } : {}) };
      log(`longhist ${k}: ${Object.keys(out).length} series${errors.length ? ` (${errors.length} failed)` : ''}`);
    } catch (e) {
      sources[k] = { ...(sources[k] || { name: S.name, url: S.url }), status: prev?.sources?.[k] ? 'stale' : 'error', error: String(e.message).slice(0, 160), failedAt: new Date().toISOString() };
      log(`longhist ${k}: ${e.message}`);
    }
  }));
  return { updated: new Date().toISOString(), note: 'Daily points for the last two years, weekly before that.', sources, series };
}

// First file before a long-window run: the history already stored in the snapshot.
export function seedFromSnapshot(snap) {
  const series = {}, F = snap?.macro?.fred || {}, Y = snap?.macro?.markets || {}, C = snap?.onchain?.coinmetrics?.series || {};
  for (const [id, s] of Object.entries(F)) if (s?.points?.length) series['fred.' + id] = compact(s.points);
  for (const k of Object.keys(LONG_YAHOO)) if (Y[k]?.length) series['yahoo.' + k] = compact(Y[k]);
  for (const m of CM) if (C[m]?.length) series['cm.' + m] = compact(C[m]);
  if (snap?.onchain?.stablecoins?.length) series['llama.stables'] = compact(snap.onchain.stablecoins);
  const at = snap?.collectedAt || new Date().toISOString();
  const sources = Object.fromEntries(Object.entries(LONG_SOURCES).map(([k, S]) => [k, { name: S.name, url: S.url, status: Object.keys(series).some((x) => x.startsWith(k + '.')) ? 'seeded' : 'pending', asOf: at.slice(0, 10), note: 'Seeded from the daily snapshot (shorter window); the next daily run fetches the long history.' }]));
  return { updated: at, note: 'Seeded from the daily snapshot; daily points for the last two years, weekly before that.', sources, series };
}
