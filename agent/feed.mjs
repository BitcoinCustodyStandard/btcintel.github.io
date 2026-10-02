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
  const items = all.filter((x) => Date.parse(x.t) >= cut).sort((a, b) => b.t.localeCompare(a.t)).filter((x) => { const k = norm(x.title); if (seen.has(k) || seen.has(x.link)) return false; seen.add(k); seen.add(x.link); return true; }).slice(0, 60);
  sources.sort((a, b) => FEEDS.findIndex((f) => f.name === a.name) - FEEDS.findIndex((f) => f.name === b.name));
  return { method: 'Headlines from public RSS feeds, last 72 hours. Tags are keyword rules (see engine/sentiment.js), not an assessment of the story.', sources, items };
}

// ---------- other blocks ----------
async function fng() {
  const j = await get('https://api.alternative.me/fng/?limit=31');
  const d = j.data.map((x) => ({ value: +x.value, label: x.value_classification, date: new Date(+x.timestamp * 1000).toISOString().slice(0, 10) }));
  return { source: 'alternative.me Crypto Fear & Greed Index (third-party)', url: 'https://alternative.me/crypto/fear-and-greed-index/', asOf: d[0].date, value: d[0].value, label: d[0].label, d1: d[1]?.value ?? null, d7: d[7]?.value ?? null, d30: d[30]?.value ?? null };
}
async function treasuries() {
  const j = await get('https://api.coingecko.com/api/v3/companies/public_treasury/bitcoin');
  const cos = (j.companies || []).filter((c) => c.total_holdings > 0).sort((a, b) => b.total_holdings - a.total_holdings);
  return { source: 'CoinGecko public company treasuries', url: 'https://www.coingecko.com/en/treasuries/bitcoin', fetchedAt: new Date().toISOString(), totalBtc: Math.round(j.total_holdings), companies: cos.length, top: cos.slice(0, 5).map((c) => ({ name: c.name, symbol: c.symbol, country: c.country, btc: Math.round(c.total_holdings), pctSupply: c.percentage_of_total_supply })) };
}
async function volume() {
  const j = await get('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=400&interval=daily');
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

async function main() {
  let prev = null;
  try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
  const out = { updated: new Date().toISOString() };
  const blocks = { news, fng, treasuries, volume, flows, lightning };
  await Promise.all(Object.entries(blocks).map(async ([k, fn]) => {
    try { out[k] = await fn(); log(`${k}: ok`); }
    catch (e) {
      log(`${k}: ${e.message}`);
      // carry the last good value forward, marked stale with its original timestamps
      out[k] = prev?.[k] ? { ...prev[k], stale: true, lastError: e.message } : { error: e.message };
    }
  }));
  if (out.news?.sources) log(out.news.sources.map((s) => `${s.name}:${s.ok ? s.n : 'ERR ' + s.error}`).join(' · '));
  const strip = (o) => JSON.stringify({ ...o, updated: 0, treasuries: o?.treasuries && { ...o.treasuries, fetchedAt: 0 } });
  if (prev && strip(prev) === strip(out)) { log('No content change.'); return; }
  await writeFile(OUT, JSON.stringify(out) + '\n');
  log('Wrote data/dash.json');
}
if (import.meta.url === `file://${process.argv[1]}`) main();
