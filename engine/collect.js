// Data collection layer. Every collector returns raw-but-normalized observations
// and registers provenance (source, timestamp, frequency, methodology) in `sources`.
// Collectors never invent values: on failure they record the error and return null,
// and the merge step (mergeWithPrevious) carries the last known value forward,
// labelled STALE with its original timestamp.

import { fetchJSON, fetchText, num, isoDate, DAY, bsGreeks } from './util.js';

const UA = { 'User-Agent': 'Mozilla/5.0 (BTC Intel market research agent; +https://btcintel.org/)' };

export const SOURCE_META = {
  coingecko: { name: 'CoinGecko', url: 'https://www.coingecko.com/en/coins/bitcoin', frequency: 'intraday (≈1–5 min)', method: 'Volume-weighted aggregate spot price across exchanges.' },
  coingecko_hist: { name: 'CoinGecko (daily history)', url: 'https://www.coingecko.com/en/coins/bitcoin/historical_data', frequency: 'daily (00:00 UTC)', method: 'Daily aggregate price/volume/market cap.' },
  coinbase_hist: { name: 'Coinbase Exchange candles', url: 'https://exchange.coinbase.com', frequency: 'daily (UTC)', method: 'BTC-USD daily OHLCV, single venue; fallback when CoinGecko history is unavailable.' },
  coingecko_global: { name: 'CoinGecko /global', url: 'https://www.coingecko.com/en/global-charts', frequency: 'intraday', method: 'Total crypto market cap and BTC dominance.' },
  coingecko_markets: { name: 'CoinGecko /coins/markets', url: 'https://www.coingecko.com', frequency: 'intraday', method: 'Top-50 coins by market cap; stablecoins excluded for breadth.' },
  book_coinbase: { name: 'Coinbase BTC-USD order book', url: 'https://exchange.coinbase.com/trade/BTC-USD', frequency: 'snapshot', method: 'Level-2 aggregated book snapshot.' },
  book_kraken: { name: 'Kraken XBT/USD order book', url: 'https://pro.kraken.com', frequency: 'snapshot', method: 'Top 500 levels per side (may not reach ±2%).' },
  book_bitstamp: { name: 'Bitstamp BTC/USD order book', url: 'https://www.bitstamp.net', frequency: 'snapshot', method: 'Full book snapshot.' },
  book_okx: { name: 'OKX BTC-USDT order book', url: 'https://www.okx.com', frequency: 'snapshot', method: 'Up to 5000 levels per side. USDT treated as $1.' },
  book_binance: { name: 'Binance BTC-USDT order book', url: 'https://www.binance.com', frequency: 'snapshot', method: 'Up to 5000 levels via data-api.binance.vision. USDT treated as $1.' },
  book_bybit: { name: 'Bybit BTC-USDT spot order book', url: 'https://www.bybit.com', frequency: 'snapshot', method: 'Top 200 levels. USDT treated as $1.' },
  okx_deriv: { name: 'OKX public derivatives API', url: 'https://www.okx.com/docs-v5/en/', frequency: 'snapshot / 8h funding', method: 'Swap + futures OI (USD), funding, liquidation orders.' },
  okx_rubik: { name: 'OKX Trading Data (Rubik)', url: 'https://www.okx.com/trading-data', frequency: 'daily', method: 'OKX-only aggregate contract OI/volume, long/short account ratio, taker volume.' },
  binance_deriv: { name: 'Binance USDⓈ-M futures API', url: 'https://www.binance.com/en/futures/BTCUSDT', frequency: 'snapshot / 8h funding', method: 'BTCUSDT perpetual OI, funding. Often geo-blocked from US servers.' },
  bybit_deriv: { name: 'Bybit V5 API', url: 'https://www.bybit.com', frequency: 'snapshot / 8h funding', method: 'BTCUSDT linear + BTCUSD inverse perpetual OI and funding. Often geo-blocked from US servers.' },
  deribit_fut: { name: 'Deribit futures', url: 'https://www.deribit.com', frequency: 'snapshot', method: 'Perpetual + dated futures; OI in USD; basis vs Deribit BTC index.' },
  coingecko_deriv: { name: 'CoinGecko derivatives (aggregator)', url: 'https://www.coingecko.com/en/derivatives', frequency: 'intraday', method: 'Per-market BTC perpetual OI (USD) and funding as reported to CoinGecko. Used for venues that geo-block direct access (Binance, Bybit) and for a market-wide total; methodology differs from direct venue APIs and is labelled "via CoinGecko".' },
  bitmex: { name: 'BitMEX XBTUSD', url: 'https://www.bitmex.com', frequency: 'snapshot / 8h funding', method: 'Inverse perpetual; OI in USD contracts.' },
  hyperliquid: { name: 'Hyperliquid', url: 'https://app.hyperliquid.xyz', frequency: 'snapshot / 1h funding', method: 'On-chain perp DEX; OI in BTC × mark; hourly funding scaled to 8h.' },
  cftc_cot: { name: 'CFTC Traders in Financial Futures (CME Bitcoin)', url: 'https://publicreporting.cftc.gov', frequency: 'weekly (Tue positions, Fri release)', method: 'CME Bitcoin futures (5 BTC contract) positioning by trader class.' },
  deribit_opt: { name: 'Deribit options', url: 'https://www.deribit.com/options/BTC', frequency: 'snapshot', method: 'Per-instrument OI and mark IV. Deribit is the majority of listed BTC options OI but excludes CME/IBIT options.' },
  deribit_dvol: { name: 'Deribit DVOL index', url: 'https://www.deribit.com/statistics/BTC/volatility-index', frequency: 'daily', method: '30-day forward implied volatility index.' },
  farside: { name: 'Farside Investors — BTC ETF flows', url: 'https://farside.co.uk/bitcoin-etf-flow-all-data/', frequency: 'daily (US trading days, published evening ET; some funds T+1)', method: 'US$m net creations/redemptions per fund from issuer data.' },
  fred: { name: 'FRED (Federal Reserve Bank of St. Louis)', url: 'https://fred.stlouisfed.org', frequency: 'per series (daily/weekly/monthly)', method: 'Official series: H.4.1 balance sheet, Treasury, rates, spreads, indices.' },
  yahoo: { name: 'Yahoo Finance chart API', url: 'https://finance.yahoo.com', frequency: 'daily close', method: 'Front-month futures (gold, silver), DXY, Nasdaq-100, S&P 500 closes.' },
  coinmetrics: { name: 'Coin Metrics Community API', url: 'https://docs.coinmetrics.io', frequency: 'daily', method: 'On-chain network data (MVRV, realized cap, hash rate, miner revenue, issuance).' },
  mempool: { name: 'mempool.space', url: 'https://mempool.space/mining', frequency: 'per block', method: 'Hash rate, difficulty, next adjustment estimate.' },
  bgeometrics: { name: 'BGeometrics (bitcoin-data.com) free API', url: 'https://bitcoin-data.com', frequency: 'daily; free tier withholds the latest ~7 days on some metrics', method: 'SOPR and BTC supply in profit. Free tier: 15 requests/day — fetched at most once every 20 hours and carried forward between runs.' },
  defillama_stables: { name: 'DefiLlama stablecoins', url: 'https://defillama.com/stablecoins', frequency: 'daily', method: 'Total USD-pegged stablecoin circulation.' },
};

function src(sources, id, status, extra = {}) {
  sources[id] = { ...(SOURCE_META[id] || { name: id }), status, fetchedAt: new Date().toISOString(), ...extra };
}

async function attempt(sources, id, fn) {
  try {
    const out = await fn();
    if (out === null || out === undefined) {
      src(sources, id, 'error', { error: 'empty response' });
      return null;
    }
    src(sources, id, 'ok', { asOf: out.__asOf || new Date().toISOString(), ...(out.note ? { note: out.note } : {}) });
    delete out.__asOf;
    return out;
  } catch (e) {
    src(sources, id, 'error', { error: String(e.message || e).slice(0, 240) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// CoinGecko's free tier rate-limits bursts: serialize calls, space them, retry a 429 once.
let cgChain = Promise.resolve();
function cg(url, timeout) {
  const run = async () => {
    try { return await fetchJSON(url, {}, timeout); }
    catch (e) {
      if (e.status !== 429) throw e;
      await new Promise((r) => setTimeout(r, 15000));
      return fetchJSON(url, {}, timeout);
    }
  };
  const p = cgChain.then(run);
  cgChain = p.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 2500)));
  return p;
}

// ---------------------------------------------------------------------------
// PRICE
async function cgSpot() {
  const j = await cg('https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false');
  const m = j.market_data;
  return {
    spot: num(m.current_price.usd),
    change24h: num(m.price_change_percentage_24h),
    change7d: num(m.price_change_percentage_7d),
    change30d: num(m.price_change_percentage_30d),
    marketCap: num(m.market_cap.usd),
    volume24h: num(m.total_volume.usd),
    circulatingSupply: num(m.circulating_supply),
    ath: num(m.ath?.usd),
    athDate: m.ath_date?.usd ? m.ath_date.usd.slice(0, 10) : null,
    __asOf: j.last_updated || new Date().toISOString(),
  };
}

async function cgHistory() {
  const j = await cg('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily');
  const byDate = new Map();
  j.prices.forEach(([t, p], i) => {
    byDate.set(isoDate(t), [isoDate(t), p, num(j.total_volumes[i]?.[1]), num(j.market_caps[i]?.[1])]);
  });
  const rows = [...byDate.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { rows, __asOf: new Date(j.prices.at(-1)[0]).toISOString() };
}

async function coinbaseHistory() {
  const rows = new Map();
  const end = Date.now();
  for (let k = 0; k < 2; k++) {
    const e = new Date(end - k * 290 * DAY).toISOString();
    const s = new Date(end - (k + 1) * 290 * DAY).toISOString();
    const j = await fetchJSON(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400&start=${s}&end=${e}`, { headers: UA });
    for (const [t, , , , close, vol] of j) rows.set(isoDate(t * 1000), [isoDate(t * 1000), close, vol * close, null]);
  }
  const out = [...rows.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-366);
  return { rows: out, __asOf: new Date().toISOString() };
}

async function cgGlobal() {
  const j = await cg('https://api.coingecko.com/api/v3/global');
  const d = j.data;
  return {
    btcDominance: num(d.market_cap_percentage?.btc),
    ethDominance: num(d.market_cap_percentage?.eth),
    totalMcap: num(d.total_market_cap?.usd),
    totalVolume: num(d.total_volume?.usd),
    mcapChange24h: num(d.market_cap_change_percentage_24h_usd),
    __asOf: new Date((d.updated_at || Date.now() / 1000) * 1000).toISOString(),
  };
}

const STABLES = new Set(['usdt', 'usdc', 'dai', 'usde', 'fdusd', 'tusd', 'usdd', 'pyusd', 'usds', 'busd', 'usd1', 'usdtb', 'rlusd', 'susde', 'gusd', 'usdp', 'frax', 'usdg', 'bfusd']);
async function cgMarkets() {
  const j = await cg('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=60&page=1&price_change_percentage=7d,30d');
  const coins = j
    .filter((c) => !STABLES.has(String(c.symbol).toLowerCase()) && !/usd|wrapped|staked|bridged/i.test(c.name) && !/^(w|st|cb|j)?(btc|eth)$/i.test(c.symbol) || c.id === 'bitcoin' || c.id === 'ethereum')
    .slice(0, 50)
    .map((c) => ({ id: c.id, symbol: c.symbol, mcap: c.market_cap, ch7d: num(c.price_change_percentage_7d_in_currency), ch30d: num(c.price_change_percentage_30d_in_currency) }));
  return { coins };
}

// ---------------------------------------------------------------------------
// ORDER BOOKS
function depthStats(venue, pair, bids, asks) {
  // bids/asks: [[price, qtyBTC]] best-first
  bids = bids.map(([p, q]) => [num(p), num(q)]).filter(([p, q]) => p > 0 && q > 0).sort((a, b) => b[0] - a[0]);
  asks = asks.map(([p, q]) => [num(p), num(q)]).filter(([p, q]) => p > 0 && q > 0).sort((a, b) => a[0] - b[0]);
  if (!bids.length || !asks.length) throw new Error('empty book');
  const mid = (bids[0][0] + asks[0][0]) / 2;
  const spreadBps = ((asks[0][0] - bids[0][0]) / mid) * 1e4;
  const bands = {};
  const deepestBidPct = ((mid - bids.at(-1)[0]) / mid) * 100;
  const deepestAskPct = ((asks.at(-1)[0] - mid) / mid) * 100;
  for (const b of [0.5, 1, 2]) {
    const lo = mid * (1 - b / 100), hi = mid * (1 + b / 100);
    let bidUsd = 0, askUsd = 0;
    for (const [p, q] of bids) if (p >= lo) bidUsd += p * q; else break;
    for (const [p, q] of asks) if (p <= hi) askUsd += p * q; else break;
    bands[b] = { bidUsd, askUsd, bidTruncated: deepestBidPct < b, askTruncated: deepestAskPct < b };
  }
  // keep a compact copy of levels within ±3% for the aggregate impact simulation and liquidity map
  const keepB = bids.filter(([p]) => p >= mid * 0.97);
  const keepA = asks.filter(([p]) => p <= mid * 1.03);
  return { venue, pair, mid, spreadBps, bands, deepestBidPct, deepestAskPct, levels: { bids: keepB, asks: keepA } };
}

const BOOKS = {
  book_coinbase: async () => {
    const j = await fetchJSON('https://api.exchange.coinbase.com/products/BTC-USD/book?level=2', { headers: UA });
    return depthStats('Coinbase', 'BTC-USD', j.bids, j.asks);
  },
  book_kraken: async () => {
    const j = await fetchJSON('https://api.kraken.com/0/public/Depth?pair=XBTUSD&count=500');
    if (j.error && j.error.length) throw new Error(j.error.join(','));
    const k = Object.keys(j.result)[0];
    return depthStats('Kraken', 'XBT/USD', j.result[k].bids, j.result[k].asks);
  },
  book_bitstamp: async () => {
    const j = await fetchJSON('https://www.bitstamp.net/api/v2/order_book/btcusd/');
    return depthStats('Bitstamp', 'BTC/USD', j.bids, j.asks);
  },
  book_okx: async () => {
    let j;
    try {
      j = await fetchJSON('https://www.okx.com/api/v5/market/books-full?instId=BTC-USDT&sz=5000');
    } catch {
      j = await fetchJSON('https://www.okx.com/api/v5/market/books?instId=BTC-USDT&sz=400');
    }
    const d = j.data[0];
    return depthStats('OKX', 'BTC-USDT', d.bids, d.asks);
  },
  book_binance: async () => {
    const j = await fetchJSON('https://data-api.binance.vision/api/v3/depth?symbol=BTCUSDT&limit=5000');
    return depthStats('Binance', 'BTC-USDT', j.bids, j.asks);
  },
  book_bybit: async () => {
    const j = await fetchJSON('https://api.bybit.com/v5/market/orderbook?category=spot&symbol=BTCUSDT&limit=200');
    if (j.retCode !== 0) throw new Error(j.retMsg);
    return depthStats('Bybit', 'BTC-USDT', j.result.b, j.result.a);
  },
};

// Walk a combined cross-venue book to estimate the price impact of an aggressive
// market order. Idealized: assumes perfect routing and that displayed liquidity
// stays put (it usually does not under stress).
export function simulateImpact(venues, sizesUsd = [10e6, 25e6, 50e6, 100e6, 250e6]) {
  const ok = venues.filter((v) => v && v.levels);
  if (!ok.length) return null;
  const mids = ok.map((v) => v.mid).sort((a, b) => a - b);
  const ref = mids[Math.floor(mids.length / 2)];
  const bids = ok.flatMap((v) => v.levels.bids).sort((a, b) => b[0] - a[0]);
  const asks = ok.flatMap((v) => v.levels.asks).sort((a, b) => a[0] - b[0]);
  const walk = (book, usd, side) => {
    let filled = 0, qty = 0, last = null;
    for (const [p, q] of book) {
      const take = Math.min(p * q, usd - filled);
      filled += take;
      qty += take / p;
      last = p;
      if (filled >= usd - 1e-6) break;
    }
    if (filled < usd - 1e-6) return { sizeUsd: usd, exhausted: true, filledUsd: filled, worstPrice: last, worstPct: last ? ((last - ref) / ref) * 100 : null };
    const avg = filled / qty;
    return { sizeUsd: usd, exhausted: false, avgPrice: avg, slippagePct: ((avg - ref) / ref) * 100 * (side === 'sell' ? -1 : 1), worstPrice: last, worstPct: ((last - ref) / ref) * 100 };
  };
  return {
    refMid: ref,
    venues: ok.map((v) => v.venue),
    sell: sizesUsd.map((s) => walk(bids, s, 'sell')),
    buy: sizesUsd.map((s) => walk(asks, s, 'buy')),
  };
}

// ---------------------------------------------------------------------------
// DERIVATIVES
async function okxDeriv() {
  const fam = [['SWAP', 'BTC-USDT'], ['SWAP', 'BTC-USD'], ['FUTURES', 'BTC-USDT'], ['FUTURES', 'BTC-USD'], ['SWAP', 'BTC-USDC']];
  let oiUsd = 0, oiBtc = 0, parts = [];
  for (const [t, f] of fam) {
    try {
      const j = await fetchJSON(`https://www.okx.com/api/v5/public/open-interest?instType=${t}&instFamily=${f}`);
      for (const r of j.data || []) {
        oiUsd += num(r.oiUsd) || 0;
        oiBtc += num(r.oiCcy) || 0;
      }
      parts.push(`${t}:${f}`);
    } catch { /* partial is fine, recorded below */ }
  }
  const fr = await fetchJSON('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP');
  const f = fr.data[0];
  const intervalH = f.nextFundingTime && f.fundingTime ? (num(f.nextFundingTime) - num(f.fundingTime)) / 3600000 : 8;
  const rate = num(f.fundingRate);
  // funding history (≈100 days)
  const hist = [];
  let after = '';
  for (let p = 0; p < 3; p++) {
    const j = await fetchJSON(`https://www.okx.com/api/v5/public/funding-rate-history?instId=BTC-USDT-SWAP&limit=100${after ? '&after=' + after : ''}`);
    if (!j.data?.length) break;
    for (const r of j.data) hist.push([num(r.fundingTime), num(r.realizedRate ?? r.fundingRate)]);
    after = j.data.at(-1).fundingTime;
  }
  hist.sort((a, b) => a[0] - b[0]);
  // liquidations (most recent filled orders, BTC-USDT swap; ctVal 0.01 BTC)
  let liq = null;
  try {
    const j = await fetchJSON('https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&instFamily=BTC-USDT&state=filled&limit=100');
    const det = (j.data || []).flatMap((d) => d.details || []);
    let longUsd = 0, shortUsd = 0, minTs = Infinity, maxTs = 0, largest = 0;
    for (const d of det) {
      const usd = (num(d.sz) || 0) * 0.01 * (num(d.bkPx) || 0);
      const isLong = d.posSide === 'long' || (d.posSide === 'net' && d.side === 'sell');
      if (isLong) longUsd += usd; else shortUsd += usd;
      largest = Math.max(largest, usd);
      minTs = Math.min(minTs, num(d.ts)); maxTs = Math.max(maxTs, num(d.ts));
    }
    if (det.length) liq = { venue: 'OKX BTC-USDT-SWAP', count: det.length, longUsd, shortUsd, largestUsd: largest, from: new Date(minTs).toISOString(), to: new Date(maxTs).toISOString() };
  } catch { /* optional */ }
  return {
    venue: { venue: 'OKX', oiUsd, oiBtc, funding8h: rate !== null ? (rate * 8) / intervalH : null, fundingIntervalH: intervalH, coverage: parts.join(', ') },
    fundingHistory: hist,
    liquidations: liq,
  };
}

async function okxRubik() {
  const out = {};
  const oi = await fetchJSON('https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy=BTC&period=1D');
  out.oiHistory = (oi.data || []).map(([t, o, v]) => [isoDate(num(t)), num(o), num(v)]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  try {
    const ls = await fetchJSON('https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC&period=1D');
    out.longShort = (ls.data || []).map(([t, r]) => [isoDate(num(t)), num(r)]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  } catch { out.longShort = []; }
  for (const it of ['CONTRACTS', 'SPOT']) {
    try {
      const tv = await fetchJSON(`https://www.okx.com/api/v5/rubik/stat/taker-volume?ccy=BTC&instType=${it}&period=1D`);
      out['taker' + it] = (tv.data || []).map(([t, s, b]) => [isoDate(num(t)), num(b), num(s)]).sort((a, b) => (a[0] < b[0] ? -1 : 1)); // [date, buy, sell]
    } catch { out['taker' + it] = []; }
  }
  return out;
}

async function binanceDeriv() {
  const [pi, oi, tk] = await Promise.all([
    fetchJSON('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT'),
    fetchJSON('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT'),
    fetchJSON('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT'),
  ]);
  const mark = num(pi.markPrice);
  let ls = [];
  try {
    const j = await fetchJSON('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1d&limit=30');
    ls = j.map((r) => [isoDate(num(r.timestamp)), num(r.longShortRatio)]);
  } catch { /* optional */ }
  return { venue: 'Binance', oiBtc: num(oi.openInterest), oiUsd: num(oi.openInterest) * mark, funding8h: num(pi.lastFundingRate), mark, volume24hUsd: num(tk.quoteVolume), longShort: ls };
}

async function bybitDeriv() {
  const lin = await fetchJSON('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT');
  if (lin.retCode !== 0) throw new Error(lin.retMsg);
  const l = lin.result.list[0];
  let invOi = 0;
  try {
    const inv = await fetchJSON('https://api.bybit.com/v5/market/tickers?category=inverse&symbol=BTCUSD');
    invOi = num(inv.result.list[0].openInterest) || 0; // USD contracts
  } catch { /* optional */ }
  return { venue: 'Bybit', oiUsd: (num(l.openInterestValue) || 0) + invOi, funding8h: num(l.fundingRate), mark: num(l.markPrice), volume24hUsd: num(l.turnover24h) };
}

function parseDeribitExpiry(code) {
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(code);
  if (!m) return null;
  const mon = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 }[m[2]];
  return Date.UTC(2000 + +m[3], mon, +m[1], 8, 0, 0);
}

async function deribitFutures() {
  const [idx, j] = await Promise.all([
    fetchJSON('https://www.deribit.com/api/v2/public/get_index_price?index_name=btc_usd'),
    fetchJSON('https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=future'),
  ]);
  const index = num(idx.result.index_price);
  let oiUsd = 0, perp = null;
  const curve = [];
  for (const r of j.result) {
    oiUsd += num(r.open_interest) || 0;
    if (r.instrument_name === 'BTC-PERPETUAL') {
      perp = { funding8h: num(r.funding_8h), mark: num(r.mark_price), volume24hUsd: num(r.volume_usd) };
    } else {
      const exp = parseDeribitExpiry(r.instrument_name.split('-')[1]);
      if (!exp) continue;
      const days = (exp - Date.now()) / DAY;
      const mark = num(r.mark_price);
      if (days > 0.5 && mark) curve.push({ instrument: r.instrument_name, expiry: isoDate(exp), days: +days.toFixed(1), mark, basisPct: ((mark - index) / index) * 100, basisAnnPct: ((mark - index) / index) * (365 / days) * 100, oiUsd: num(r.open_interest) });
    }
  }
  curve.sort((a, b) => a.days - b.days);
  return { index, venue: { venue: 'Deribit', oiUsd, funding8h: perp?.funding8h ?? null, volume24hUsd: perp?.volume24hUsd ?? null }, curve };
}

async function bitmex() {
  const j = await fetchJSON('https://www.bitmex.com/api/v1/instrument?symbol=XBTUSD');
  const r = j[0];
  if (!num(r.openInterest) && !num(r.volume24h)) throw new Error('XBTUSD reports zero open interest and volume (inactive) — excluded');
  return { venue: 'BitMEX', oiUsd: num(r.openInterest), funding8h: num(r.fundingRate), mark: num(r.markPrice), volume24hUsd: num(r.volume24h) };
}

async function hyperliquid() {
  const j = await fetchJSON('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' }) });
  const [meta, ctxs] = j;
  const i = meta.universe.findIndex((u) => u.name === 'BTC');
  if (i < 0) throw new Error('BTC not found');
  const c = ctxs[i];
  const mark = num(c.markPx);
  return { venue: 'Hyperliquid', oiBtc: num(c.openInterest), oiUsd: num(c.openInterest) * mark, funding8h: num(c.funding) * 8, mark, volume24hUsd: num(c.dayNtlVlm) };
}

async function cgDerivatives() {
  const j = await cg('https://api.coingecko.com/api/v3/derivatives', 90000);
  const rows = j.filter((t) => String(t.index_id).toUpperCase() === 'BTC' && /perpetual/i.test(t.contract_type || '') && num(t.open_interest));
  const byMarket = new Map();
  for (const t of rows) {
    const m = byMarket.get(t.market) || { market: t.market, oiUsd: 0, w: 0, fw: 0, volume24hUsd: 0 };
    const oi = num(t.open_interest);
    m.oiUsd += oi;
    m.volume24hUsd += num(t.volume_24h) || 0;
    if (num(t.funding_rate) !== null) { m.fw += (num(t.funding_rate) / 100) * oi; m.w += oi; } // CoinGecko funding is in percent per interval (≈8h)
    byMarket.set(t.market, m);
  }
  const markets = [...byMarket.values()].map((m) => ({ market: m.market, oiUsd: m.oiUsd, funding8h: m.w ? m.fw / m.w : null, volume24hUsd: m.volume24hUsd })).sort((a, b) => b.oiUsd - a.oiUsd);
  if (!markets.length) return null;
  return { markets, totalOiUsd: markets.reduce((s, m) => s + m.oiUsd, 0), marketCount: markets.length };
}

async function cftcCot() {
  // Traders in Financial Futures, futures-only. CME Bitcoin = contract market code 133741.
  const url = 'https://publicreporting.cftc.gov/resource/gpe5-46if.json?cftc_contract_market_code=133741&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=60';
  const j = await fetchJSON(url);
  if (!Array.isArray(j) || !j.length) return null;
  const rows = j.map((r) => ({
    date: String(r.report_date_as_yyyy_mm_dd).slice(0, 10),
    oiContracts: num(r.open_interest_all),
    levLong: num(r.lev_money_positions_long), levShort: num(r.lev_money_positions_short),
    amLong: num(r.asset_mgr_positions_long), amShort: num(r.asset_mgr_positions_short),
    dealerLong: num(r.dealer_positions_long_all), dealerShort: num(r.dealer_positions_short_all),
  })).sort((a, b) => (a.date < b.date ? -1 : 1));
  return { rows, contractBtc: 5, __asOf: rows.at(-1).date };
}

// ---------------------------------------------------------------------------
// OPTIONS (Deribit)
async function deribitOptions() {
  const j = await fetchJSON('https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option', {}, 30000);
  const now = Date.now();
  const insts = [];
  for (const r of j.result) {
    const [, exp, strike, cp] = r.instrument_name.split('-');
    const e = parseDeribitExpiry(exp);
    if (!e) continue;
    insts.push({ expiry: isoDate(e), T: Math.max((e - now) / (365 * DAY), 1 / 365 / 24), strike: +strike, call: cp === 'C', oi: num(r.open_interest) || 0, iv: (num(r.mark_iv) || 0) / 100, S: num(r.underlying_price), volume: num(r.volume) || 0 });
  }
  if (!insts.length) return null;
  const S = insts.find((x) => x.S)?.S;
  let callOi = 0, putOi = 0;
  const byStrike = new Map(), byExpiry = new Map();
  for (const x of insts) {
    const { delta, gamma } = bsGreeks(x.S || S, x.strike, x.T, x.iv, x.call);
    x.delta = delta; x.gamma = gamma;
    if (x.call) callOi += x.oi; else putOi += x.oi;
    const s = byStrike.get(x.strike) || { strike: x.strike, callOi: 0, putOi: 0, gammaUsd: 0, nearGammaUsd: 0 };
    // gamma notional: $ change in hedge for a 1% move = gamma * OI * S^2 * 0.01
    const g = gamma ? gamma * x.oi * (x.S || S) ** 2 * 0.01 : 0;
    s.gammaUsd += g;
    if (x.T <= 35 / 365) s.nearGammaUsd += g;
    if (x.call) s.callOi += x.oi; else s.putOi += x.oi;
    byStrike.set(x.strike, s);
    const e = byExpiry.get(x.expiry) || { expiry: x.expiry, days: +(x.T * 365).toFixed(1), callOi: 0, putOi: 0, strikes: new Map(), atm: [] };
    if (x.call) e.callOi += x.oi; else e.putOi += x.oi;
    const es = e.strikes.get(x.strike) || { c: 0, p: 0 };
    if (x.call) es.c += x.oi; else es.p += x.oi;
    e.strikes.set(x.strike, es);
    if (x.iv > 0) e.atm.push(x);
    byExpiry.set(x.expiry, e);
  }
  const expiries = [...byExpiry.values()].sort((a, b) => a.days - b.days).map((e) => {
    // max pain: strike minimizing total intrinsic value paid to option holders
    const strikes = [...e.strikes.keys()].sort((a, b) => a - b);
    let best = null, bestVal = Infinity;
    for (const k of strikes) {
      let v = 0;
      for (const [s, { c, p }] of e.strikes) v += c * Math.max(0, k - s) + p * Math.max(0, s - k);
      if (v < bestVal) { bestVal = v; best = k; }
    }
    const atmOpt = e.atm.slice().sort((a, b) => Math.abs(a.strike - S) - Math.abs(b.strike - S))[0];
    const c25 = e.atm.filter((x) => x.call && x.delta).sort((a, b) => Math.abs(a.delta - 0.25) - Math.abs(b.delta - 0.25))[0];
    const p25 = e.atm.filter((x) => !x.call && x.delta).sort((a, b) => Math.abs(a.delta + 0.25) - Math.abs(b.delta + 0.25))[0];
    return {
      expiry: e.expiry, days: e.days, callOi: e.callOi, putOi: e.putOi, notionalUsd: (e.callOi + e.putOi) * S,
      maxPain: best, atmIv: atmOpt ? atmOpt.iv * 100 : null,
      skew25: c25 && p25 ? (c25.iv - p25.iv) * 100 : null, // call IV − put IV (vol points); negative = puts richer
      topStrikes: [...e.strikes.entries()].map(([k, v]) => ({ strike: k, oi: v.c + v.p, c: v.c, p: v.p })).sort((a, b) => b.oi - a.oi).slice(0, 4),
    };
  });
  // ~30d interpolation
  const near30 = expiries.filter((e) => e.atmIv !== null).sort((a, b) => Math.abs(a.days - 30) - Math.abs(b.days - 30))[0];
  const strikes = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  return {
    underlying: S, callOi, putOi, pcRatio: callOi ? putOi / callOi : null, notionalUsd: (callOi + putOi) * S,
    atmIv30: near30?.atmIv ?? null, skew25_30: near30?.skew25 ?? null, ref30Expiry: near30?.expiry ?? null,
    expiries: expiries.slice(0, 12),
    byStrike: strikes.filter((s) => s.callOi + s.putOi > 0),
  };
}

async function deribitDvol() {
  const end = Date.now(), start = end - 400 * DAY;
  const j = await fetchJSON(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&start_timestamp=${start}&end_timestamp=${end}&resolution=1D`);
  const pts = (j.result?.data || []).map(([t, , , , c]) => [isoDate(t), num(c)]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { history: pts };
}

// ---------------------------------------------------------------------------
// ETF FLOWS (Farside)
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseFarsideDate(s) {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mo = MONTHS[m[2].toLowerCase()];
  if (mo === undefined) return null;
  return isoDate(Date.UTC(+m[3], mo, +m[1]));
}
function cellText(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
function parseFlowValue(s) {
  if (!s || s === '-' || s === '–') return 0;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  const v = parseFloat(s.replace(/[(),\s$-]/g, ''));
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}
export function parseFarside(html) {
  // Farside's table may split fund names and tickers over two header rows, and
  // put "Total" in a different header row than the tickers. Align from cells:
  // data row = [date, fund1..fundN, total].
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const t of tables) {
    const rows = (t.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((r) => (r.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || []).map(cellText));
    const hdrIdx = rows.findIndex((r) => r.some((c) => /^IBIT$/i.test(c)));
    if (hdrIdx < 0) continue;
    const tickers = rows[hdrIdx].filter((c) => /^[A-Z]{2,5}$/.test(c) && !/^TOTAL$/i.test(c));
    const out = [];
    for (const r of rows.slice(hdrIdx + 1)) {
      const d = parseFarsideDate(r[0] || '');
      if (!d) continue;
      const vals = r.slice(1);
      if (vals.length < 2) continue;
      const totalCell = vals[vals.length - 1];
      // A blank or dash total = day not yet reported.
      if (!totalCell || /^[-–]$/.test(totalCell)) continue;
      const total = parseFlowValue(totalCell);
      if (total === null) continue;
      // Farside pre-fills the current day with zeros before issuers report: an all-zero row is pending, not a $0 day.
      if (total === 0 && vals.slice(0, -1).every((c) => !c || /^[-–]$/.test(c) || parseFlowValue(c) === 0)) continue;
      const funds = {};
      const fv = vals.slice(0, -1);
      const off = Math.max(0, fv.length - tickers.length);
      tickers.forEach((tk, i) => { const v = parseFlowValue(fv[i + off]); if (v !== null) funds[tk] = v; });
      out.push({ date: d, totalUsdM: total, funds });
    }
    if (out.length) return out.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || 'no title';
  throw new Error(`ETF flow table not found — page "${cellText(title).slice(0, 60)}", ${html.length} bytes, ${tables.length} table(s), IBIT ${/IBIT/.test(html) ? 'present' : 'absent'}`);
}
async function farside() {
  const H = { headers: { ...UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-GB,en;q=0.9' } };
  let daily, page = 'all-data', note = null;
  try {
    daily = parseFarside(await fetchText('https://farside.co.uk/bitcoin-etf-flow-all-data/', H, 45000));
  } catch (e) {
    note = `full-history page failed (${String(e.message).slice(0, 120)}); used recent-days page`;
    page = 'recent';
    daily = parseFarside(await fetchText('https://farside.co.uk/btc/', H, 30000));
  }
  return { daily, page, note, __asOf: daily.at(-1).date };
}

// ---------------------------------------------------------------------------
// MACRO
export const FRED_SERIES = {
  WALCL: { label: 'Fed total assets', unit: 'USD bn', scale: 1e-3, freq: 'weekly (Wed)' },
  WTREGEN: { label: 'Treasury General Account', unit: 'USD bn', scale: 'auto', freq: 'weekly' },
  RRPONTSYD: { label: 'Overnight reverse repo', unit: 'USD bn', scale: 1, freq: 'daily' },
  WRESBAL: { label: 'Bank reserves', unit: 'USD bn', scale: 1e-3, freq: 'weekly' },
  DFF: { label: 'Effective fed funds', unit: '%', scale: 1, freq: 'daily' },
  DGS2: { label: 'UST 2y', unit: '%', scale: 1, freq: 'daily' },
  DGS10: { label: 'UST 10y', unit: '%', scale: 1, freq: 'daily' },
  DFII10: { label: '10y real yield (TIPS)', unit: '%', scale: 1, freq: 'daily' },
  T10YIE: { label: '10y breakeven inflation', unit: '%', scale: 1, freq: 'daily' },
  DTWEXBGS: { label: 'Broad trade-weighted dollar', unit: 'index', scale: 1, freq: 'daily (lagged ~1w)' },
  BAMLH0A0HYM2: { label: 'US high-yield OAS', unit: '%', scale: 1, freq: 'daily' },
  VIXCLS: { label: 'VIX', unit: 'index', scale: 1, freq: 'daily' },
  NASDAQCOM: { label: 'Nasdaq Composite', unit: 'index', scale: 1, freq: 'daily' },
  SP500: { label: 'S&P 500', unit: 'index', scale: 1, freq: 'daily' },
  ECBASSETSW: { label: 'ECB total assets', unit: 'EUR bn', scale: 1e-3, freq: 'weekly' },
  JPNASSETS: { label: 'BoJ total assets', unit: 'JPY 100m', scale: 1, freq: 'monthly' },
  DEXUSEU: { label: 'USD per EUR', unit: 'rate', scale: 1, freq: 'daily' },
  DEXJPUS: { label: 'JPY per USD', unit: 'rate', scale: 1, freq: 'daily' },
};

export function parseFredCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const pts = [];
  for (const l of lines.slice(1)) {
    const [d, v] = l.split(',');
    const n = num(v);
    if (d && n !== null) pts.push([d, n]);
  }
  return pts;
}
async function fred() {
  const since = isoDate(Date.now() - 420 * DAY);
  const series = {};
  const errors = [];
  await Promise.all(Object.entries(FRED_SERIES).map(async ([id, meta]) => {
    try {
      const t = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${since}`, { headers: UA }, 30000);
      let pts = parseFredCsv(t);
      let scale = meta.scale;
      if (scale === 'auto') scale = pts.length && pts.at(-1)[1] > 1e5 ? 1e-3 : 1; // millions → billions
      pts = pts.map(([d, v]) => [d, v * scale]);
      series[id] = { ...meta, scale: undefined, points: pts };
    } catch (e) {
      errors.push(`${id}: ${e.message}`.slice(0, 80));
    }
  }));
  if (!Object.keys(series).length) throw new Error(errors.join('; '));
  const last = Object.values(series).map((s) => s.points.at(-1)?.[0]).filter(Boolean).sort().at(-1);
  return { series, errors, __asOf: last };
}

export const YAHOO = { GOLD: 'GC=F', SILVER: 'SI=F', DXY: 'DX-Y.NYB', NDX: '^NDX', SPX: '^GSPC', VIX: '^VIX', TNX: '^TNX' };
async function yahoo() {
  const out = {};
  const errors = [];
  await Promise.all(Object.entries(YAHOO).map(async ([k, sym]) => {
    for (const host of ['query1', 'query2']) {
      try {
        const j = await fetchJSON(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d`, { headers: UA });
        const r = j.chart.result[0];
        const closes = r.indicators.quote[0].close;
        out[k] = r.timestamp.map((t, i) => [isoDate(t * 1000), num(closes[i])]).filter(([, v]) => v !== null);
        return;
      } catch (e) { if (host === 'query2') errors.push(`${k}: ${e.message}`.slice(0, 80)); }
    }
  }));
  if (!Object.keys(out).length) throw new Error(errors.join('; '));
  return { series: out, errors };
}

// ---------------------------------------------------------------------------
// ON-CHAIN
const CM_METRICS = ['CapMVRVCur', 'CapRealUSD', 'SplyCur', 'HashRate', 'RevUSD', 'IssTotNtv', 'AdrActCnt', 'TxTfrValAdjUSD', 'FlowInExNtv', 'FlowOutExNtv', 'SplyExNtv', 'PriceUSD'];
// Fetched with full history in one request: MVRV for cycle context since 2011; issuance,
// price and hash rate for the Puell Multiple (needs a 365-day average) and Hash Ribbons.
const CM_LONG = ['CapMVRVCur', 'PriceUSD', 'IssTotNtv', 'HashRate'];
const CM_KEEP_DAYS = 800;
async function coinmetrics() {
  const start = isoDate(Date.now() - 400 * DAY);
  const series = {}, unavailable = [];
  let mvrvWeekly = null;
  try {
    const j = await fetchJSON(`https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=${CM_LONG.join(',')}&frequency=1d&start_time=2011-01-01&page_size=10000`, {}, 60000);
    const rows = j.data || [];
    for (const m of CM_LONG) {
      const pts = rows.map((r) => [String(r.time).slice(0, 10), num(r[m])]).filter(([, v]) => v !== null);
      if (pts.length) series[m] = pts.slice(-CM_KEEP_DAYS);
      if (m === 'CapMVRVCur' && pts.length) mvrvWeekly = pts.filter((_, i) => i % 7 === (pts.length - 1) % 7);
    }
  } catch { /* fall back to the 400-day requests below */ }
  await Promise.all(CM_METRICS.filter((m) => !series[m]).map(async (m) => {
    try {
      const j = await fetchJSON(`https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=${m}&frequency=1d&start_time=${start}&page_size=1000`);
      const pts = (j.data || []).map((r) => [String(r.time).slice(0, 10), num(r[m])]).filter(([, v]) => v !== null);
      if (pts.length) series[m] = pts; else unavailable.push(m);
    } catch { unavailable.push(m); }
  }));
  if (!Object.keys(series).length) throw new Error('no metrics returned');
  return { series, unavailable, mvrvWeekly };
}
// BGeometrics free tier: 15 requests/day, 10/hour. Two requests per refresh, at most once
// every 20 hours; between refreshes the previous values are carried forward unchanged
// (status stays 'ok' with a note, because the data itself is daily and not yet due).
const BG_MIN_HOURS = 20;
async function bgeometrics(prev) {
  const p = prev?.onchain?.bgeo;
  if (p?.fetchedAt && (Date.now() - new Date(p.fetchedAt)) / 3600e3 < BG_MIN_HOURS) {
    const { note, ...rest } = p;
    return { ...rest, __asOf: p.asOf, note: `cached from ${p.fetchedAt.slice(0, 16).replace('T', ' ')} UTC (free tier: refreshed at most every ${BG_MIN_HOURS}h)` };
  }
  const startday = isoDate(Date.now() - 120 * DAY);
  const get = async (path, key) => {
    const j = await fetchJSON(`https://bitcoin-data.com/v1/${path}?startday=${startday}`, {}, 40000);
    const arr = Array.isArray(j) ? j : j && j[key] !== undefined ? [j] : [];
    const pts = arr.map((r) => [String(r.d).slice(0, 10), num(r[key])]).filter(([d, v]) => d && v !== null).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (!pts.length) throw new Error(`${path}: ${String(j?.message || j?.error || 'no data').slice(0, 120)}`);
    return { pts, delayedFlag: arr.some((r) => r.delayed) };
  };
  const out = { fetchedAt: new Date().toISOString() };
  const errs = [];
  for (const [k, path, key] of [['sopr', 'sopr', 'sopr'], ['supplyProfit', 'supply-profit', 'supplyProfitBtc']]) {
    try { const r = await get(path, key); out[k] = r.pts; out[k + 'Delayed'] = r.delayedFlag; } catch (e) { errs.push(e.message); }
  }
  if (!out.sopr && !out.supplyProfit) throw new Error(errs.join('; ') || 'no data');
  // carry forward any metric that failed this time
  for (const k of ['sopr', 'supplyProfit']) if (!out[k] && p?.[k]) { out[k] = p[k]; out[k + 'Carried'] = true; }
  out.asOf = [out.sopr?.at(-1)?.[0], out.supplyProfit?.at(-1)?.[0]].filter(Boolean).sort().at(-1);
  return { ...out, __asOf: out.asOf, ...(errs.length ? { note: errs.join('; ') } : {}) };
}
async function mempool() {
  const [adj, hr] = await Promise.all([
    fetchJSON('https://mempool.space/api/v1/difficulty-adjustment'),
    fetchJSON('https://mempool.space/api/v1/mining/hashrate/3m'),
  ]);
  return {
    nextAdjPct: num(adj.difficultyChange), progressPct: num(adj.progressPercent), remainingBlocks: num(adj.remainingBlocks), estRetarget: adj.estimatedRetargetDate ? new Date(adj.estimatedRetargetDate).toISOString() : null,
    hashrateEhs: num(hr.currentHashrate) / 1e18, difficulty: num(hr.currentDifficulty),
    hashrateHistory: (hr.hashrates || []).map((h) => [isoDate(h.timestamp * 1000), h.avgHashrate / 1e18]),
  };
}
async function stables() {
  const j = await fetchJSON('https://stablecoins.llama.fi/stablecoincharts/all');
  const pts = j.map((r) => [isoDate(num(r.date) * 1000), num(r.totalCirculatingUSD?.peggedUSD ?? r.totalCirculating?.peggedUSD)]).filter(([, v]) => v);
  return { history: pts.slice(-400), __asOf: pts.at(-1)[0] };
}

// ---------------------------------------------------------------------------
// ORCHESTRATION
// `scope` = 'server' collects everything; 'browser' skips sources that never
// allow cross-origin requests (FRED, Yahoo, Farside, CFTC) — those keep their
// last server values and are labelled with their own timestamps.
export async function collectAll({ scope = 'server', log = () => {}, prev = null } = {}) {
  const sources = {};
  const snap = { collectedAt: new Date().toISOString(), scope, sources };
  const browser = scope === 'browser';

  const tasks = {
    spot: attempt(sources, 'coingecko', cgSpot),
    hist: attempt(sources, 'coingecko_hist', cgHistory),
    global: attempt(sources, 'coingecko_global', cgGlobal),
    markets: attempt(sources, 'coingecko_markets', cgMarkets),
    books: Promise.all(Object.entries(BOOKS).map(([id, fn]) => attempt(sources, id, fn))),
    okx: attempt(sources, 'okx_deriv', okxDeriv),
    rubik: attempt(sources, 'okx_rubik', okxRubik),
    binance: attempt(sources, 'binance_deriv', binanceDeriv),
    bybit: attempt(sources, 'bybit_deriv', bybitDeriv),
    deribitF: attempt(sources, 'deribit_fut', deribitFutures),
    bitmex: attempt(sources, 'bitmex', bitmex),
    cgd: attempt(sources, 'coingecko_deriv', cgDerivatives),
    hl: attempt(sources, 'hyperliquid', hyperliquid),
    opts: attempt(sources, 'deribit_opt', deribitOptions),
    dvol: attempt(sources, 'deribit_dvol', deribitDvol),
    cm: attempt(sources, 'coinmetrics', coinmetrics),
    mempool: attempt(sources, 'mempool', mempool),
    stables: attempt(sources, 'defillama_stables', stables),
  };
  if (!browser) {
    tasks.cot = attempt(sources, 'cftc_cot', cftcCot);
    tasks.etf = attempt(sources, 'farside', farside);
    tasks.fred = attempt(sources, 'fred', fred);
    tasks.yahoo = attempt(sources, 'yahoo', yahoo);
    tasks.bgeo = attempt(sources, 'bgeometrics', () => bgeometrics(prev));
  }
  const r = {};
  for (const [k, p] of Object.entries(tasks)) r[k] = await p;

  let hist = r.hist;
  if (!hist) hist = await attempt(sources, 'coinbase_hist', coinbaseHistory);

  snap.price = r.spot ? { ...r.spot } : null;
  snap.priceHistory = hist ? hist.rows : null;
  snap.global = r.global;
  snap.breadth = r.markets;
  const venues = (r.books || []).filter(Boolean);
  snap.books = venues.length ? { venues, impact: simulateImpact(venues) } : null;

  const dv = [r.okx?.venue, r.binance, r.bybit, r.deribitF?.venue, r.bitmex, r.hl].filter(Boolean)
    .map(({ longShort, mark, ...v }) => v);
  // Venues that block direct access: fill from the CoinGecko aggregator, labelled.
  if (r.cgd) {
    for (const [name, rx] of [['Binance', /^Binance \(Futures\)$/i], ['Bybit', /^Bybit \(Futures\)$/i]]) {
      if (dv.some((v) => v.venue === name)) continue;
      const m = r.cgd.markets.find((x) => rx.test(x.market));
      if (m) dv.push({ venue: name, oiUsd: m.oiUsd, funding8h: m.funding8h, volume24hUsd: m.volume24hUsd, via: 'CoinGecko' });
    }
  }
  snap.derivs = dv.length || r.rubik ? {
    venues: dv,
    okxFundingHistory: r.okx?.fundingHistory || null,
    okxOiHistory: r.rubik?.oiHistory || null,
    okxLongShort: r.rubik?.longShort || null,
    binanceLongShort: r.binance?.longShort || null,
    takerContracts: r.rubik?.takerCONTRACTS || null,
    takerSpot: r.rubik?.takerSPOT || null,
    curve: r.deribitF?.curve || null,
    deribitIndex: r.deribitF?.index || null,
    cot: r.cot || null,
    marketWide: r.cgd ? { totalOiUsd: r.cgd.totalOiUsd, marketCount: r.cgd.marketCount, top: r.cgd.markets.slice(0, 12) } : null,
  } : null;
  snap.liquidations = r.okx?.liquidations || null;
  snap.options = r.opts ? { ...r.opts, dvolHistory: r.dvol?.history || null } : null;
  snap.etf = r.etf || null;
  snap.macro = r.fred || r.yahoo ? { fred: r.fred?.series || null, markets: r.yahoo?.series || null } : null;
  snap.onchain = { coinmetrics: r.cm || null, mempool: r.mempool || null, stablecoins: r.stables?.history || null, bgeo: r.bgeo || null };
  // fill spot fallback from books if CoinGecko spot failed
  if (!snap.price && snap.books) {
    snap.price = { spot: snap.books.impact.refMid, change24h: null, change7d: null, change30d: null, marketCap: null, volume24h: null, derivedFrom: 'order-book mid (CoinGecko unavailable)' };
  }
  log(`collected: ${Object.values(sources).filter((s) => s.status === 'ok').length}/${Object.keys(sources).length} sources ok`);
  return snap;
}

// Carry forward any section that failed this run from the previous snapshot,
// marking its sources STALE with the original timestamp. Never silently
// presents old data as fresh.
const SECTION_SOURCES = {
  price: ['coingecko'], priceHistory: ['coingecko_hist', 'coinbase_hist'], global: ['coingecko_global'], breadth: ['coingecko_markets'],
  books: Object.keys(BOOKS), derivs: ['okx_deriv', 'okx_rubik', 'binance_deriv', 'bybit_deriv', 'deribit_fut', 'bitmex', 'hyperliquid', 'cftc_cot', 'coingecko_deriv'],
  liquidations: ['okx_deriv'], options: ['deribit_opt', 'deribit_dvol'], etf: ['farside'], macro: ['fred', 'yahoo'], onchain: ['coinmetrics', 'mempool', 'defillama_stables', 'bgeometrics'],
};
export function mergeWithPrevious(snap, prev) {
  if (!prev) return snap;
  const markStale = (ids) => {
    for (const id of ids) {
      const p = prev.sources?.[id];
      const now = snap.sources[id];
      if (p && (p.status === 'ok' || p.status === 'stale') && (!now || now.status !== 'ok')) {
        snap.sources[id] = { ...p, status: 'stale', staleSince: snap.collectedAt, lastError: now?.error || 'not refreshed in this run' };
      }
    }
  };
  for (const [sec, ids] of Object.entries(SECTION_SOURCES)) {
    const missing = snap[sec] === null || snap[sec] === undefined;
    if (missing && prev[sec]) {
      snap[sec] = prev[sec];
      markStale(ids);
    }
  }
  // section-level fields that are individually optional
  if (snap.macro && prev.macro) {
    if (!snap.macro.fred && prev.macro.fred) { snap.macro.fred = prev.macro.fred; markStale(['fred']); }
    if (!snap.macro.markets && prev.macro.markets) { snap.macro.markets = prev.macro.markets; markStale(['yahoo']); }
  }
  if (snap.onchain && prev.onchain) {
    for (const [k, id] of [['coinmetrics', 'coinmetrics'], ['mempool', 'mempool'], ['stablecoins', 'defillama_stables'], ['bgeo', 'bgeometrics']]) {
      if (!snap.onchain[k] && prev.onchain[k]) { snap.onchain[k] = prev.onchain[k]; markStale([id]); }
    }
  }
  if (snap.derivs && prev.derivs) {
    for (const k of ['okxOiHistory', 'okxFundingHistory', 'cot', 'curve', 'takerContracts', 'takerSpot', 'okxLongShort', 'marketWide']) {
      if (!snap.derivs[k] && prev.derivs[k]) snap.derivs[k] = prev.derivs[k];
    }
    if (!snap.derivs.cot && prev.derivs.cot) markStale(['cftc_cot']);
    // venues that dropped out: keep last values but flag them
    const have = new Set(snap.derivs.venues.map((v) => v.venue));
    for (const v of prev.derivs.venues || []) if (!have.has(v.venue) && v.oiUsd) snap.derivs.venues.push({ ...v, stale: true });
  }
  if (snap.options && !snap.options.dvolHistory && prev.options?.dvolHistory) snap.options.dvolHistory = prev.options.dvolHistory;
  // ETF history is cumulative: merge old rows with new (new wins on same date)
  if (prev.etf?.daily) {
    const m = new Map(prev.etf.daily.filter((r) => !(r.totalUsdM === 0 && Object.values(r.funds || {}).every((v) => !v))).map((r) => [r.date, r]));
    for (const r of snap.etf?.daily || []) m.set(r.date, r);
    snap.etf = { ...(snap.etf || prev.etf), daily: [...m.values()].sort((a, b) => (a.date < b.date ? -1 : 1)) };
  }
  return snap;
}
