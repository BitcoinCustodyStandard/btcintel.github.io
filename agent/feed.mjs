// BTC Dashboard feed (runs every 15 minutes on GitHub Actions).
// Writes data/dash.json with the slow-moving dashboard inputs that browsers cannot
// fetch reliably themselves: news headlines (RSS), Fear & Greed, public-company
// treasuries, completed-day spot volume, exchange in/out flows and Lightning stats.
// Every block keeps its own source, as-of time and error; nothing is filled in.
// The file is rewritten only when its content changes (ignoring `updated`).

import { readFile, writeFile } from 'node:fs/promises';
import { tagHeadline } from '../engine/sentiment.js';
import { pearson, alignedReturns } from '../engine/util.js';

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
  { name: 'Bitcoinist', url: 'https://bitcoinist.com/feed/', keep: BTC_RE },
  { name: 'NewsBTC', url: 'https://www.newsbtc.com/feed/', keep: BTC_RE },
  { name: 'CryptoSlate', url: 'https://cryptoslate.com/feed/', keep: BTC_RE },
  { name: 'Blockworks', url: 'https://blockworks.co/feed', keep: BTC_RE },
  { name: 'CryptoPotato', url: 'https://cryptopotato.com/feed/', keep: BTC_RE },
  { name: 'crypto.news', url: 'https://crypto.news/feed/', keep: BTC_RE },
  { name: 'U.Today', url: 'https://u.today/rss', keep: BTC_RE },
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
// Headlines are carried forward between runs, so the window is a true 7 days even though each RSS
// file only holds its latest items. A daily tally [date, headlines, positive, negative] (crypto
// feeds only) is kept for 400 days: it gives news volume and tone their own history.
const NEWS_DAYS = 7;
export function tallyDays(items, prevDaily = [], now = Date.now()) {
  const by = new Map((prevDaily || []).map((r) => [r[0], r]));
  const fresh = new Map();
  for (const x of items) { if (x.macro) continue; const d = x.t.slice(0, 10), r = fresh.get(d) || [d, 0, 0, 0]; r[1]++; if (x.tag === 'bullish') r[2]++; if (x.tag === 'bearish') r[3]++; fresh.set(d, r); }
  // a day still inside the window is recounted; the oldest day may be only partly covered, so never lower a stored count
  for (const [d, r] of fresh) { const o = by.get(d); by.set(d, o && o[1] > r[1] ? o : r); }
  const cut = new Date(now - 400 * 864e5).toISOString().slice(0, 10);
  return [...by.values()].filter((r) => r[0] >= cut).sort((a, b) => a[0].localeCompare(b[0]));
}
async function news(prev) {
  const sources = [], all = [];
  await Promise.all(FEEDS.map(async (f) => {
    try { const items = parseRss(await get(f.url, 'text'), f); all.push(...items); sources.push({ name: f.name, url: f.url, ok: true, n: items.length }); }
    catch (e) { sources.push({ name: f.name, url: f.url, ok: false, error: e.message }); }
  }));
  const cut = Date.now() - NEWS_DAYS * 864e5, seen = new Set();
  const items = [...all, ...(prev?.items || [])].filter((x) => Date.parse(x.t) >= cut).sort((a, b) => b.t.localeCompare(a.t)).filter((x) => { const k = norm(x.title); if (seen.has(k) || seen.has(x.link)) return false; seen.add(k); seen.add(x.link); return true; }).slice(0, 500);
  const order = (n) => { const i = FEEDS.findIndex((f) => f.name === n); return i < 0 ? 99 : i; };
  sources.sort((a, b) => order(a.name) - order(b.name));
  return { method: `Headlines from public RSS feeds, last ${NEWS_DAYS} days (carried forward between runs). Tags are keyword rules (see engine/sentiment.js), not an assessment of the story.`, sources, items, daily: tallyDays(items, prev?.daily) };
}

// ---------- other blocks ----------
async function fng() {
  const j = await get('https://api.alternative.me/fng/?limit=400');
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
  // a point stamped 00:00 UTC holds the previous day's 24h volume, so label it with that day
  const rows = j.total_volumes.filter(([ts]) => ts % 864e5 === 0).map(([ts, v]) => [new Date(ts - 864e5).toISOString().slice(0, 10), Math.round(v)]).filter(([d]) => d < today);
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

// Polymarket prediction markets on Bitcoin's price (public Gamma API, no key).
// Keeps the "What price will Bitcoin hit …" ladders (week, month, year) and the nearest
// "Bitcoin above ___ on <date>" ladder at least a day away. Prices are market-implied odds.
export function pickPolymarket(events, now = Date.now()) {
  const ladder = (e) => /^what price will bitcoin hit/i.test(e.title) && !/eth\/btc/i.test(e.title);
  const above = events.filter((e) => /^bitcoin above .* on /i.test(e.title) && Date.parse(e.endDate) - now > 20 * 3600e3).sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate))[0];
  const chosen = events.filter(ladder).sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate)).concat(above ? [above] : []);
  return chosen.map((e) => {
    const markets = (e.markets || []).filter((m) => m.active && !m.closed).map((m) => {
      let yes = null; try { yes = +JSON.parse(m.outcomePrices)[0]; } catch {}
      const g = String(m.groupItemTitle || ''), dir = g.includes('↑') ? 'up' : g.includes('↓') ? 'down' : null;
      const strike = +((g.match(/[\d,.]+/) || m.question.match(/\$([\d,]+)/) || [])[0] || '').replace(/[^\d.]/g, '') || null;
      return { label: g || m.question, q: m.question, dir, strike, yes, ch: Number.isFinite(+m.oneDayPriceChange) ? +m.oneDayPriceChange : null, v24: Math.round(+m.volume24hr || 0), vol: Math.round(+m.volumeNum || +m.volume || 0) };
    }).filter((m) => Number.isFinite(m.yes)).sort((a, b) => (b.strike || 0) - (a.strike || 0));
    return { title: e.title, slug: e.slug, url: `https://polymarket.com/event/${e.slug}`, end: e.endDate, vol: Math.round(+e.volume || 0), v24: Math.round(+e.volume24hr || 0), markets };
  }).filter((e) => e.markets.length);
}
async function polymarket() {
  const j = await get('https://gamma-api.polymarket.com/events?tag_slug=bitcoin&active=true&closed=false&limit=100', 'json', 40000);
  return { source: 'Polymarket public Gamma API', url: 'https://polymarket.com', fetchedAt: new Date().toISOString(), events: pickPolymarket(j) };
}

// Address and coin distribution by balance band, from bitinfocharts' public table
// (one request a day). Changes are computed from our own stored daily snapshots.
export const COHORTS = [['shrimp', 'Shrimp', '< 1 BTC', 0], ['crab', 'Crab', '1–10 BTC', 1], ['fish', 'Fish', '10–100 BTC', 10], ['shark', 'Shark', '100–1K BTC', 100], ['whale', 'Whale', '1K–10K BTC', 1000], ['humpback', 'Humpback', '> 10K BTC', 10000]];
export function parseDistribution(html) {
  const i = html.indexOf('Bitcoin distribution</caption>'); if (i < 0) throw new Error('distribution table not found');
  const t = html.slice(i, html.indexOf('</table>', i));
  const rows = [...t.matchAll(/<tr><td>([^<]+)<\/td><td data-val='([\d.]+)'>[\s\S]*?<\/td><td class='hidden-phone'[^>]*>[\s\S]*?<\/td><td data-val='([\d.]+)'>/g)].map((m) => ({ range: m[1].trim(), lo: +m[1].replace(/[[(]/, '').split('-')[0].replace(/,/g, '').trim(), addresses: +m[2], btc: +m[3] }));
  if (rows.length < 10) throw new Error(`distribution table: only ${rows.length} rows`);
  const c = {};
  for (const [k, , , lo] of COHORTS) c[k] = [0, 0];
  for (const r of rows) { const k = [...COHORTS].reverse().find((x) => r.lo >= x[3])[0]; c[k][0] += r.addresses; c[k][1] += r.btc; }
  for (const k in c) c[k][1] = Math.round(c[k][1]);
  return { rows, cohorts: c };
}
async function distribution(prev) {
  const d = parseDistribution(await get('https://bitinfocharts.com/top-100-richest-bitcoin-addresses.html', 'text', 30000));
  const date = new Date().toISOString().slice(0, 10);
  const history = (prev?.history || []).filter((h) => h.date !== date).concat([{ date, c: d.cohorts }]).slice(-40);
  return { source: 'bitinfocharts.com Bitcoin distribution table (address balances)', url: 'https://bitinfocharts.com/top-100-richest-bitcoin-addresses.html', fetchedAt: new Date().toISOString(), asOf: date, cohorts: d.cohorts, bands: d.rows, history };
}

// Rolling correlation of daily log returns, computed from series we already store:
// BTC daily closes (data/pi_cycle.json) and the agent's Yahoo Finance closes (data/snapshot.json).
export async function correlations() {
  const [pi, snap] = await Promise.all([readFile(new URL('../data/pi_cycle.json', import.meta.url), 'utf8').then(JSON.parse), readFile(new URL('../data/snapshot.json', import.meta.url), 'utf8').then(JSON.parse)]);
  const btc = pi.rows.slice(-520).map((r) => [r[0], r[1]]), M = snap.macro?.markets || {};
  const pairs = {};
  for (const [k, label] of [['SPX', 'S&P 500'], ['GOLD', 'Gold'], ['DXY', 'US dollar index (DXY)']]) {
    const s = M[k]; if (!s?.length) continue;
    const roll = (n) => { const out = []; for (const [d] of s.slice(-260)) { const a = alignedReturns(btc.filter((r) => r[0] <= d), s.filter((r) => r[0] <= d), n); if (a.ra.length >= n * 0.8) { const c = pearson(a.ra, a.rb); if (Number.isFinite(c)) out.push([d, +c.toFixed(3)]); } } return out; };
    const s30 = roll(30), s90 = roll(90);
    pairs[k] = { label, c30: s30.at(-1)?.[1] ?? null, c90: s90.at(-1)?.[1] ?? null, c30MonthAgo: s30.at(-22)?.[1] ?? null, s30, s90, asOf: s30.at(-1)?.[0] ?? null };
  }
  return { source: 'Computed by BTC Intel: BTC daily closes (Coin Metrics) vs Yahoo Finance daily closes; overlapping trading days, daily log returns', method: 'Pearson correlation of daily log returns over the last 30 and 90 overlapping trading days.', asOf: Object.values(pairs)[0]?.asOf ?? null, pairs };
}

// US spot Bitcoin ETFs: net assets, price, volume, fee and YTD return from Yahoo Finance's quote
// endpoint (needs only a session cookie and crumb, no key); stockanalysis.com fills any fund
// Yahoo returns without net assets. Fund-reported assets can lag by a day or more.
export const ETFS = [
  ['IBIT', 'iShares Bitcoin Trust', 'BlackRock'], ['FBTC', 'Fidelity Wise Origin Bitcoin Fund', 'Fidelity'], ['GBTC', 'Grayscale Bitcoin Trust', 'Grayscale'],
  ['BTC', 'Grayscale Bitcoin Mini Trust', 'Grayscale'], ['BITB', 'Bitwise Bitcoin ETF', 'Bitwise'], ['ARKB', 'ARK 21Shares Bitcoin ETF', 'ARK / 21Shares'],
  ['HODL', 'VanEck Bitcoin ETF', 'VanEck'], ['BRRR', 'CoinShares Bitcoin ETF', 'CoinShares'], ['EZBC', 'Franklin Bitcoin ETF', 'Franklin Templeton'],
  ['BTCO', 'Invesco Galaxy Bitcoin ETF', 'Invesco / Galaxy'], ['BTCW', 'WisdomTree Bitcoin Fund', 'WisdomTree'], ['MSBT', 'Morgan Stanley Bitcoin Trust', 'Morgan Stanley'],
  ['DEFI', 'Hashdex Bitcoin ETF', 'Hashdex'],
];
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
async function yahooQuotes(symbols) {
  const r1 = await fetch('https://fc.yahoo.com', { headers: { 'user-agent': BROWSER }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const cookie = (r1.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const crumb = await (await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'user-agent': BROWSER, cookie }, signal: AbortSignal.timeout(15000) })).text();
  if (!crumb || crumb.length > 40 || /</.test(crumb)) throw new Error('no Yahoo crumb');
  const r = await fetch(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(',')}&crumb=${encodeURIComponent(crumb)}`, { headers: { 'user-agent': BROWSER, cookie }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Yahoo quote HTTP ${r.status}`);
  return (await r.json()).quoteResponse?.result || [];
}
export function parseStockAnalysisAssets(html) {
  const m = /Assets<\/[^>]+>[\s\S]{0,200}?\$([\d.,]+)\s*([KMBT])/.exec(html) || /Assets[\s\S]{0,120}?\$([\d.,]+)\s*([KMBT])/.exec(html);
  return m ? +m[1].replace(/,/g, '') * { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2]] : null;
}
async function etfs() {
  const q = await yahooQuotes(ETFS.map((e) => e[0])).catch((e) => { log('yahoo etfs:', e.message); return []; });
  const by = new Map(q.map((x) => [x.symbol, x]));
  const funds = [];
  for (const [sym, name, issuer] of ETFS) {
    const y = by.get(sym) || {};
    let assets = Number.isFinite(y.netAssets) && y.netAssets > 0 ? y.netAssets : null, assetsSrc = assets ? 'Yahoo Finance' : null;
    if (!assets) { try { assets = parseStockAnalysisAssets(await get(`https://stockanalysis.com/etf/${sym.toLowerCase()}/`, 'text')); assetsSrc = assets ? 'stockanalysis.com' : null; } catch {} }
    funds.push({ sym, name, issuer, price: y.regularMarketPrice ?? null, chPct: y.regularMarketChangePercent ?? null, assets, assetsSrc, feePct: y.netExpenseRatio ?? null, volume: y.regularMarketVolume ?? null, dollarVolume: y.regularMarketVolume && y.regularMarketPrice ? Math.round(y.regularMarketVolume * y.regularMarketPrice) : null, ytdPct: y.ytdReturn ?? null, quoteTime: y.regularMarketTime ? new Date(y.regularMarketTime * 1000).toISOString() : null });
  }
  if (!funds.some((f) => f.assets)) throw new Error('no fund assets from Yahoo or stockanalysis');
  return { source: 'Yahoo Finance quotes (net assets, price, volume, fee); stockanalysis.com as fallback', fetchedAt: new Date().toISOString(), funds };
}

// ---------- stablecoins by issuer (DefiLlama, free) ----------
// Current USD-pegged supply per stablecoin with DefiLlama's own day/week/month-ago values.
async function stablecoins() {
  const j = await get('https://stablecoins.llama.fi/stablecoins?includePrices=false', 'json', 30000);
  const v = (o) => (typeof o?.peggedUSD === 'number' ? o.peggedUSD : null);
  const list = (j.peggedAssets || []).filter((a) => a.pegType === 'peggedUSD')
    .map((a) => ({ sym: a.symbol, name: a.name, now: v(a.circulating), d1: v(a.circulatingPrevDay), d7: v(a.circulatingPrevWeek), d30: v(a.circulatingPrevMonth) }))
    .filter((a) => a.now > 0).sort((a, b) => b.now - a.now);
  if (!list.length) throw new Error('no stablecoins');
  const tot = (k) => list.reduce((s, a) => s + (a[k] || 0), 0);
  const at = new Date().toISOString();
  return { source: 'DefiLlama stablecoins API (USD-pegged supply)', url: 'https://defillama.com/stablecoins', fetchedAt: at, asOf: at, total: { now: tot('now'), d1: tot('d1'), d7: tot('d7'), d30: tot('d30') }, top: list.slice(0, 8) };
}

// ---------- retail attention: Wikipedia pageviews (free Wikimedia REST API) ----------
// Daily human views of the English "Bitcoin" article, a public proxy for retail curiosity
// (Google Trends has no free API).
async function attention() {
  const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Bitcoin/daily/${ymd(Date.now() - 400 * 864e5)}/${ymd(Date.now() - 864e5)}`;
  const j = await get(url, 'json', 30000);
  const rows = (j.items || []).map((i) => [`${i.timestamp.slice(0, 4)}-${i.timestamp.slice(4, 6)}-${i.timestamp.slice(6, 8)}`, i.views]).filter(([, v]) => Number.isFinite(v));
  if (rows.length < 30) throw new Error('too few pageview rows');
  let crypto = null;
  try { const k = await get(url.replace('/Bitcoin/daily/', '/Cryptocurrency/daily/'), 'json', 30000); crypto = (k.items || []).map((i) => [`${i.timestamp.slice(0, 4)}-${i.timestamp.slice(4, 6)}-${i.timestamp.slice(6, 8)}`, i.views]).filter(([, v]) => Number.isFinite(v)); } catch { crypto = null; }
  return { source: 'Wikimedia pageviews API (English Wikipedia “Bitcoin” and “Cryptocurrency” articles, human traffic)', url: 'https://pageviews.wmcloud.org/?pages=Bitcoin|Cryptocurrency&project=en.wikipedia.org', fetchedAt: new Date().toISOString(), asOf: rows.at(-1)[0], rows, ...(crypto?.length >= 30 ? { crypto } : {}) };
}

async function main() {
  let prev = null;
  try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
  const out = { updated: new Date().toISOString() };
  const blocks = { news, fng, treasuries, volume, flows, lightning, network, hashpower, pools, activity, cohorts, polymarket, distribution, correlations, etfs, stablecoins, attention };
  // minimum age before a block is fetched again (default: every run)
  const EVERY = { hashpower: 55 * 60e3, pools: 55 * 60e3, activity: 6 * 3600e3, treasuries: 55 * 60e3, cohorts: 23 * 3600e3, polymarket: 3 * 3600e3 - 5 * 60e3, distribution: 20 * 3600e3, etfs: 2 * 3600e3 - 5 * 60e3, stablecoins: 55 * 60e3, attention: 6 * 3600e3 };
  await Promise.all(Object.entries(blocks).map(async ([k, fn]) => {
    const p = prev?.[k];
    if (EVERY[k] && p?.fetchedAt && !p.error && Date.now() - Date.parse(p.fetchedAt) < EVERY[k]) { out[k] = p; log(`${k}: cached`); return; }
    // after a failure, wait before retrying (6 h for the rate-limited BGeometrics, else 1 h)
    if (EVERY[k] && p?.failedAt && Date.now() - Date.parse(p.failedAt) < (k === 'cohorts' ? 6 * 3600e3 : 3600e3)) { out[k] = p; log(`${k}: backing off`); return; }
    try { out[k] = await fn(p); log(`${k}: ok`); }
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
