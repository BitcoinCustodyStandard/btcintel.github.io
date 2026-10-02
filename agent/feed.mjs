// BTC Dashboard feed (runs every 15 minutes on GitHub Actions).
// Writes data/dash.json with the slow-moving dashboard inputs that browsers cannot
// fetch reliably themselves: news headlines (RSS), Fear & Greed, public-company
// treasuries, completed-day spot volume, exchange in/out flows and Lightning stats.
// Every block keeps its own source, as-of time and error; nothing is filled in.
// The file is rewritten only when its content changes (ignoring `updated`).

import { readFile, writeFile } from 'node:fs/promises';
import { tagHeadline } from '../engine/sentiment.js';

const OUT = new URL('../data/dash.json', import.meta.url);
const UA = { 'User-Agent': 'Mozilla/5.0 (BTC Intel dashboard feed; +https://btcintel.org/)', Accept: '*/*' };
const log = (...a) => console.log(...a);

async function get(url, type = 'json', ms = 20000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return type === 'json' ? r.json() : r.text();
}

// ---------- news (RSS 2.0) ----------
const BTC_RE = /bitcoin|\bbtc\b|satoshi|\bsats?\b|halving|\bminers?\b|mining|\betfs?\b|\bibit\b|strategy|saylor|stablecoin|federal reserve|\bfed\b|fomc|powell|inflation|\bcpi\b|interest rate|rate cut|rate hike|treasur|tariff|\bsec\b|cftc|liquidat/i;
const FED_RE = /fomc|monetary policy|federal funds|discount rate|minutes|balance sheet|beige book|statement on|stablecoin|crypto|digital asset|payment|bank term|liquidity|reserve requirement/i;
export const FEEDS = [
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', keep: BTC_RE },
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss/tag/bitcoin', keep: null },
  { name: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/feed', keep: null },
  { name: 'Decrypt', url: 'https://decrypt.co/feed', keep: BTC_RE },
  { name: 'The Block', url: 'https://www.theblock.co/rss.xml', keep: BTC_RE },
  { name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', keep: FED_RE, macro: true },
];
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#039': "'", hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m));
const tagText = (item, tag) => { const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(item); return m ? decode(decode(m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : ''; };

export function parseRss(xml, feed, now = Date.now()) {
  const out = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const it = m[0], title = tagText(it, 'title'), link = tagText(it, 'link') || tagText(it, 'guid');
    const t = Date.parse(tagText(it, 'pubDate') || tagText(it, 'dc:date'));
    if (!title || !/^https:\/\//.test(link) || !Number.isFinite(t) || t > now + 3600e3) continue;
    if (feed.keep && !feed.keep.test(title)) continue;
    const s = feed.macro ? { tag: 'neutral', words: [] } : tagHeadline(title);
    out.push({ t: new Date(t).toISOString(), title, link, source: feed.name, tag: s.tag, words: s.words, ...(feed.macro ? { macro: true } : {}) });
  }
  return out;
}
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter((w) => w.length > 3).slice(0, 8).join(' ');
async function news() {
  const sources = [], all = [];
  await Promise.all(FEEDS.map(async (f) => {
    try { const items = parseRss(await get(f.url, 'text'), f); all.push(...items); sources.push({ name: f.name, url: f.url, ok: true, n: items.length }); }
    catch (e) { sources.push({ name: f.name, url: f.url, ok: false, error: e.message }); }
  }));
  const cut = Date.now() - 72 * 3600e3, seen = new Set();
  const items = all.filter((x) => Date.parse(x.t) >= cut).sort((a, b) => b.t.localeCompare(a.t)).filter((x) => { const k = norm(x.title); if (seen.has(k) || seen.has(x.link)) return false; seen.add(k); seen.add(x.link); return true; }).slice(0, 80);
  const order = (n) => { const i = FEEDS.findIndex((f) => f.name === n); return i < 0 ? 99 : i; };
  sources.sort((a, b) => order(a.name) - order(b.name));
  return { method: 'Headlines from public RSS feeds, last 72 hours. Tags are keyword rules (see engine/sentiment.js), not an assessment of the story.', sources, items };
}

// ---------- other blocks ----------
async function fng() {
  const j = await get('https://api.alternative.me/fng/?limit=90');
  const d = j.data.map((x) => ({ value: +x.value, label: x.value_classification, date: new Date(+x.timestamp * 1000).toISOString().slice(0, 10) }));
  const avg = (n) => (d.length >= n ? Math.round(d.slice(0, n).reduce((s, x) => s + x.value, 0) / n) : null);
  return { source: 'alternative.me Crypto Fear & Greed Index (third-party)', url: 'https://alternative.me/crypto/fear-and-greed-index/', asOf: d[0].date, value: d[0].value, label: d[0].label, d1: d[1]?.value ?? null, d7: d[7]?.value ?? null, d30: d[30]?.value ?? null, avg7: avg(7), avg30: avg(30), series: d.map((x) => [x.date, x.value]).reverse() };
}
async function treasuries() {
  const j = await get('https://api.coingecko.com/api/v3/companies/public_treasury/bitcoin');
  const cos = (j.companies || []).filter((c) => c.total_holdings > 0).sort((a, b) => b.total_holdings - a.total_holdings);
  return { source: 'CoinGecko public company treasuries', url: 'https://www.coingecko.com/en/treasuries/bitcoin', fetchedAt: new Date().toISOString(), totalBtc: Math.round(j.total_holdings), companies: cos.length, top: cos.slice(0, 30).map((c) => ({ name: c.name, symbol: c.symbol, country: c.country, btc: Math.round(c.total_holdings), pctSupply: c.percentage_of_total_supply })) };
}
async function volume() {
  const j = await get('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily');
  const today = new Date().toISOString().slice(0, 10);
  // keep completed UTC days only (the last point is a running value)
  const rows = j.total_volumes.filter(([ts]) => ts % 864e5 === 0).map(([ts, v]) => [new Date(ts).toISOString().slice(0, 10), Math.round(v)]).filter(([d]) => d < today);
  return { source: 'CoinGecko aggregate 24h spot volume (daily, 00:00 UTC)', asOf: rows.at(-1)?.[0] ?? null, rows };
}
async function flows() {
  const start = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const j = await get(`https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=FlowInExNtv,FlowOutExNtv,SplyExNtv&frequency=1d&start_time=${start}&page_size=200`);
  const rows = j.data.filter((x) => x.FlowInExNtv && x.FlowOutExNtv).map((x) => [x.time.slice(0, 10), Math.round(+x.FlowInExNtv), Math.round(+x.FlowOutExNtv), x.SplyExNtv ? Math.round(+x.SplyExNtv) : null]);
  return { source: 'Coin Metrics Community API (FlowInExNtv, FlowOutExNtv, SplyExNtv; recent days are “flash” estimates)', asOf: rows.at(-1)?.[0] ?? null, rows };
}
async function lightning() {
  const j = await get('https://mempool.space/api/v1/lightning/statistics/latest');
  const L = j.latest;
  return { source: 'mempool.space Lightning statistics', asOf: L.added.slice(0, 10), channels: L.channel_count, nodes: L.node_count, capacityBtc: L.total_capacity / 1e8 };
}

// snapshot of mempool.space network state, used by the page when a browser cannot reach it
async function network() {
  const M = 'https://mempool.space/api';
  const [blocks, fees, mp, da, hr, rw] = await Promise.all(['/v1/blocks', '/v1/fees/recommended', '/mempool', '/v1/difficulty-adjustment', '/v1/mining/hashrate/3d', '/v1/mining/reward-stats/144'].map((p) => get(M + p)));
  return {
    source: 'mempool.space (server snapshot)', at: new Date().toISOString(),
    blocks: blocks.slice(0, 15).map((b) => ({ height: b.height, timestamp: b.timestamp, tx_count: b.tx_count, size: b.size, extras: { reward: b.extras?.reward ?? null, totalFees: b.extras?.totalFees ?? null, pool: { name: b.extras?.pool?.name ?? null } } })),
    fees, mempool: { count: mp.count, vsize: mp.vsize, total_fee: mp.total_fee }, da,
    hash: { currentHashrate: hr.currentHashrate, currentDifficulty: hr.currentDifficulty }, reward: rw,
  };
}

// mining economics with 90 days of history (hashprice, fee share)
async function hashpower() {
  const j = await get('https://cloudminecrypto.com/api/hashpower-market');
  const L = j.latest || {};
  return { source: 'CloudMineCrypto hashpower market API', url: 'https://cloudminecrypto.com', fetchedAt: new Date().toISOString(), asOf: new Date(j.as_of * 1000).toISOString(),
    hashpriceUsdPh: L.hashprice_usd_per_th_day * 1000, hashpriceBtcPh: L.hashprice_btc_per_ph_day, feeSharePct: L.fees_share_pct, hashrateEh: L.network_hashrate_eh,
    daily: (j.daily || []).map((x) => [x.date, x.hashprice_usd_per_th_day * 1000, x.fees_share_pct]) };
}
// mining pools' share of blocks over the last week
async function pools() {
  const j = await get('https://mempool.space/api/v1/mining/pools/1w');
  const total = j.pools.reduce((s, p) => s + p.blockCount, 0);
  return { source: 'mempool.space mining pools (last 7 days)', fetchedAt: new Date().toISOString(), blocks: total, count: j.pools.length, top: j.pools.slice(0, 8).map((p) => ({ name: p.name, blocks: p.blockCount, share: (p.blockCount / total) * 100 })) };
}
// network activity, daily (Coin Metrics Community; all free-tier metrics)
async function activity() {
  const start = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const j = await get(`https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=AdrActCnt,TxCnt,TxTfrCnt,AdrBalCnt,FeeTotNtv&frequency=1d&start_time=${start}&page_size=200`);
  const rows = j.data.map((x) => [x.time.slice(0, 10), +x.AdrActCnt || null, +x.TxCnt || null, +x.TxTfrCnt || null, +x.AdrBalCnt || null, x.FeeTotNtv ? +(+x.FeeTotNtv).toFixed(4) : null]);
  return { source: 'Coin Metrics Community API (AdrActCnt, TxCnt, TxTfrCnt, AdrBalCnt, FeeTotNtv)', fetchedAt: new Date().toISOString(), asOf: rows.at(-1)?.[0] ?? null, cols: ['date', 'active', 'tx', 'transfers', 'withBalance', 'feesBtc'], rows };
}
// short- and long-term holder realised prices. BGeometrics free tier is tightly limited
// (and shared with the daily agent), so this is fetched at most once every 23 hours.
async function cohorts() {
  const start = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
  const [sth, lth] = await Promise.all([
    get(`https://bitcoin-data.com/v1/sth-realized-price?startday=${start}`, 'json', 40000),
    get(`https://bitcoin-data.com/v1/lth-realized-price?startday=${start}`, 'json', 40000),
  ]);
  const ser = (a, k) => a.filter((x) => x[k] !== null && x[k] !== undefined).map((x) => [x.d, +(+x[k]).toFixed(2)]);
  const S = ser(sth, 'sthRealizedPrice'), L = ser(lth, 'lthRealizedPrice');
  return { source: 'BGeometrics free API (sth/lth-realized-price; free tier is delayed about a week)', fetchedAt: new Date().toISOString(), asOf: S.at(-1)?.[0] ?? null, sth: S, lth: L };
}

async function main() {
  let prev = null;
  try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
  const out = { updated: new Date().toISOString() };
  const blocks = { news, fng, treasuries, volume, flows, lightning, network, hashpower, pools, activity, cohorts };
  // minimum age before a block is fetched again (default: every run)
  const EVERY = { hashpower: 55 * 60e3, pools: 55 * 60e3, activity: 6 * 3600e3, treasuries: 55 * 60e3, cohorts: 23 * 3600e3 };
  await Promise.all(Object.entries(blocks).map(async ([k, fn]) => {
    const p = prev?.[k];
    if (EVERY[k] && p?.fetchedAt && !p.error && Date.now() - Date.parse(p.fetchedAt) < EVERY[k]) { out[k] = p; log(`${k}: cached`); return; }
    // after a failure, wait before retrying (6 h for the rate-limited BGeometrics, else 1 h)
    if (EVERY[k] && p?.failedAt && Date.now() - Date.parse(p.failedAt) < (k === 'cohorts' ? 6 * 3600e3 : 3600e3)) { out[k] = p; log(`${k}: backing off`); return; }
    try { out[k] = await fn(); log(`${k}: ok`); }
    catch (e) {
      log(`${k}: ${e.message}`);
      // carry the last good value forward, marked stale with its original timestamps
      out[k] = prev?.[k] && !prev[k].error ? { ...prev[k], stale: true, lastError: e.message, failedAt: new Date().toISOString() } : { error: e.message, failedAt: new Date().toISOString() };
    }
  }));
  if (out.news?.sources) log(out.news.sources.map((s) => `${s.name}:${s.ok ? s.n : 'ERR ' + s.error}`).join(' · '));
  // fetch times alone are not a content change
  const strip = (o) => JSON.stringify({ ...o, updated: 0 }, (k, v) => (k === 'fetchedAt' || k === 'at' || k === 'failedAt' ? 0 : v));
  if (prev && strip(prev) === strip(out)) { log('No content change.'); return; }
  await writeFile(OUT, JSON.stringify(out) + '\n');
  log('Wrote data/dash.json');
}
if (import.meta.url === `file://${process.argv[1]}`) main();
