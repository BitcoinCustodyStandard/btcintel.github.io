// BTC Dashboard — the landing tab. Everything here comes from free public sources:
// live tickers (live.js), mempool.space (network.js), exchange WebSockets (moves.js),
// CoinGecko in the browser, and the server files data/dash.json (15-min feed),
// data/latest.json (agent snapshot) and data/pi_cycle.json. Values that cannot be
// obtained free are shown as such, never estimated.

import { startNetwork, seedNetwork, refreshNetwork, N, issuedSupply, subsidyBtc, nextHalving, hashprice, HALVING_INTERVAL } from './network.js?v=20261003p';
import { startMoves, MIN_TRADE, MIN_LIQ, MIN_TX_BTC } from './moves.js?v=20261003p';
import { priceCardHtml, envelopeNow } from './pricechart.js?v=20261003p';
import { marketReadHtml } from './intelui.js?v=20261003p';

// ---------- formatting ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ok = (v) => v !== null && v !== undefined && Number.isFinite(+v);
const num = (v, d = 0) => (ok(v) ? (+v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const usd = (v, d) => (ok(v) ? '$' + num(v, d ?? (Math.abs(v) >= 100 ? 0 : 2)) : '—');
const big = (v) => { if (!ok(v)) return '—'; const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e12 ? `${s}$${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${s}$${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(0)}K` : `${s}$${a.toFixed(0)}`; };
const pct = (v, d = 1, sign = true) => (ok(v) ? `${sign && v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%` : '—');
const cls = (v) => (!ok(v) || v === 0 ? '' : v > 0 ? 'up' : 'down');
const btcF = (v, d = 0) => (ok(v) ? `${num(v, d)} BTC` : '—');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dShort = (d) => { const x = typeof d === 'string' && d.length === 10 ? new Date(d + 'T00:00:00Z') : new Date(d); return isNaN(x) ? '—' : `${MON[x.getUTCMonth()]} ${x.getUTCDate()}, ${x.getUTCFullYear()}`; };
const hhmm = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const hms = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function ago(t, now = Date.now()) {
  if (!t) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
const relShort = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };

// ---------- state ----------
const S = { a: null, dash: null, pi: null, live: null, cg: null, cgAt: null, glob: null, moves: [], moveStatus: {}, newsFilter: 'all', newsTone: 'all', newsAll: false, pmIdx: 0, pmAll: false, etfSort: 'assets', etfDir: 'desc', etfFlows: null, moveFilter: 'all', info: () => '' };
const price = () => S.live?.price ?? S.a?.metrics?.price?.spot ?? null;
const supplyNow = () => (N.height ? issuedSupply(N.height) : null);
const cyM = (id) => S.a?.cycle?.metrics?.find((x) => x.id === id);
const srcQ = (id) => S.a?.quality?.find((q) => q.id === id);
const H = 3600e3, DAY = 864e5;
// freshness: 'ok' within the expected update interval, 'stale' beyond it, 'na' missing
const fresh = (at, maxAge) => (!at ? 'na' : Date.now() - (typeof at === 'number' ? at : Date.parse(at.length === 10 ? at + 'T23:59:59Z' : at)) <= maxAge ? 'ok' : 'stale');

// ---------- metric cards ----------
// get() → { v, sub?, src, at?, max?, na? } or null (shown as "not available")
const mpSrc = (extra = '') => (N.live ? `mempool.space${extra}` : `mempool.space snapshot${extra}`);
const fee = (v) => (ok(v) ? (v >= 10 ? Math.round(v) : +(+v).toFixed(1)) : '—');
const NA = (why, src = 'No free source') => ({ na: true, v: 'Not available from free sources', sub: why, src });
// daily series helpers: rows are [date, value]
const lastN = (rows, n) => (rows || []).filter((r) => ok(r[1])).slice(-n);
const avgOf = (rows) => (rows.length ? rows.reduce((a, r) => a + r[1], 0) / rows.length : null);
const col = (block, i) => (block?.rows || []).map((r) => [r[0], r[i]]).filter((r) => ok(r[1]));
const vsAvg = (v, a) => (ok(v) && ok(a) && a ? `<span class="${cls(v - a)}">${pct((v / a - 1) * 100)}</span> vs 30-day average` : '');
const actCard = (k, label, info, i, fmtV, unit) => ({ k, label, info, get: () => {
  const rows = col(S.dash?.activity, i); if (!rows.length) return null;
  const v = rows.at(-1)[1], a30 = avgOf(lastN(rows, 30));
  return { v: `${fmtV(v)}${unit ? ` <small>${unit}</small>` : ''}`, sub: `${dShort(rows.at(-1)[0])} · 30-day average ${fmtV(a30)} · ${vsAvg(v, a30)}`, spark: lastN(rows, 90), sfmt: fmtV, src: 'Coin Metrics Community', at: rows.at(-1)[0], max: 3 * DAY };
} });
const kNum = (v) => (!ok(v) ? '—' : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}K` : num(v));
const hasH = () => ok(S.dash?.hashpower?.hashpriceUsdPh) && !S.dash.hashpower.error;
const ownHashprice = () => (N.reward && N.hash ? hashprice(N.reward.total / 1e8 / (N.reward.end - N.reward.start + 1), price(), N.hash.difficulty) : null);
const cohortCard = (k, label, info, key, who) => ({ k, label, info, get: () => {
  const C = S.dash?.cohorts, rows = lastN(C?.[key], 400); if (!rows.length) return C?.error ? NA('BGeometrics free tier could not be reached; retried every few hours.', 'BGeometrics') : null;
  const v = rows.at(-1)[1], x = (price() / v - 1) * 100;
  return { v: usd(v), sub: `price <span class="${cls(x)}">${pct(x)}</span> ${x >= 0 ? 'above' : 'below'} · ${who} · value for ${dShort(rows.at(-1)[0])} (free tier is delayed)`, spark: lastN(rows, 180), sfmt: (y) => usd(y), src: 'BGeometrics free API', at: rows.at(-1)[0], max: 12 * DAY };
} });
// display order: market-facing sections first (they corroborate the Market read),
// network fundamentals after, address distribution last
const GROUP_ORDER = ['sentiment', 'market', 'onchain', 'derivs', 'holders', 'corr', 'network', 'fees', 'mining', 'supply'];
const FUNDAMENTALS_FROM = 'network';
const GROUPS = [
  { id: 'market', title: 'Price & market', cards: [
    { k: 'price', label: 'Price', info: 'd_price', get: () => S.live ? { v: usd(S.live.price), sub: `<span class="${cls(S.live.ch24)}">${pct(S.live.ch24, 2)}</span> 24h`, src: `${S.live.source}${S.live.note ? ' (USDT)' : ''} · live`, at: S.live.at, max: 60e3 } : { v: usd(S.a?.metrics.price.spot), sub: 'server snapshot', src: 'CoinGecko', at: srcQ('coingecko')?.asOf, max: 2 * H } },
    { k: 'mcap', label: 'Market cap', info: 'd_mcap', get: () => supplyNow() ? { v: big(price() * supplyNow()), sub: `${usd(price())} × ${num(supplyNow())} BTC`, src: 'Live price × issued supply', at: S.live?.at ?? N.at, max: 5 * 60e3 } : { v: big(S.a?.metrics.price.marketCap), sub: 'server snapshot', src: 'CoinGecko', at: srcQ('coingecko')?.asOf, max: 2 * H } },
    { k: 'vol', label: '24h volume (all exchanges)', info: 'd_vol24', get: () => { const v = S.cg?.total_volume?.usd ?? S.a?.metrics.structure?.spotVolume24h; return ok(v) ? { v: big(v), sub: 'aggregate spot volume', src: 'CoinGecko', at: S.cg ? S.cgAt : srcQ('coingecko_markets')?.asOf, max: 30 * 60e3 } : null; } },
    { k: 'dom', label: 'Bitcoin dominance', info: 'd_dom', get: () => { const v = S.glob?.market_cap_percentage?.btc ?? S.a?.metrics.structure?.dominance; return ok(v) ? { v: `${v.toFixed(1)}%`, sub: 'share of total crypto market cap', src: 'CoinGecko /global', at: S.glob ? S.cgAt : srcQ('coingecko_global')?.asOf, max: 30 * 60e3 } : null; } },
    { k: 'ath', label: 'From all-time high', info: 'd_ath', get: () => { const ath = S.cg?.ath?.usd ?? S.a?.metrics.price.ath, d = S.cg?.ath_date?.usd ?? S.a?.metrics.price.athDate; if (!ok(ath) || !price()) return null; const x = (price() / ath - 1) * 100; return { v: `<span class="${cls(x)}">${pct(x)}</span>`, sub: `ATH ${usd(ath)} on ${dShort(d)}`, src: 'CoinGecko ATH · live price', at: S.cg ? S.cgAt : srcQ('coingecko')?.asOf, max: 2 * H }; } },
    { k: 'ma200', label: '200-day average', info: 'd_ma200', get: () => { const m = S.a?.metrics.price.ma200; if (!ok(m)) return null; const x = (price() / m - 1) * 100; return { v: usd(m), sub: `price <span class="${cls(x)}">${pct(x)}</span> vs average · Mayer ${num(price() / m, 2)}`, src: 'Daily closes (CoinGecko)', at: srcQ('coingecko_hist')?.asOf, max: 36 * H }; } },
    { k: 'range52', label: '52-week range', info: 'd_range52', get: () => { const p = S.a?.metrics.price; if (!ok(p?.low365)) return null; const pos = ((price() - p.low365) / (p.high365 - p.low365)) * 100; return { v: `${usd(p.low365)} – ${usd(p.high365)}`, sub: `<span class="rbar"><i style="left:${Math.max(0, Math.min(100, pos)).toFixed(0)}%"></i></span> price at ${Math.max(0, Math.min(100, pos)).toFixed(0)}% of range`, src: 'Daily closes (CoinGecko)', at: srcQ('coingecko_hist')?.asOf, max: 36 * H }; } },
    { k: 'rv', label: 'Realised volatility (30d)', info: 'd_rv', get: () => { const p = S.a?.metrics.price; return ok(p?.rv30) ? { v: `${p.rv30.toFixed(0)}%`, sub: `7-day ${p.rv7?.toFixed(0) ?? '—'}% · annualised`, src: 'Computed from daily closes', at: srcQ('coingecko_hist')?.asOf, max: 36 * H } : null; } },
  ] },
  { id: 'network', title: 'Network & activity', cards: [
    { k: 'height', label: 'Block height', info: 'd_height', get: () => N.height ? { v: num(N.height), sub: `last block <b data-tick="tip">${ago(N.tipTime)}</b>${N.blocks[0]?.pool ? ` · ${esc(N.blocks[0].pool)}` : ''}`, src: N.live ? `mempool.space · ${N.ws === 'live' ? 'live' : 'polling'}` : 'mempool.space snapshot', at: N.at, max: 5 * 60e3 } : null },
    { k: 'hash', label: 'Hash rate (3-day estimate)', info: 'd_hashrate', get: () => N.hash ? { v: `${num(N.hash.current / 1e18)} EH/s`, sub: ok(S.a?.metrics.onchain?.hashCh30d) ? `<span class="${cls(S.a.metrics.onchain.hashCh30d)}">${pct(S.a.metrics.onchain.hashCh30d)}</span> over 30 days` : '', src: mpSrc(), at: N.at, max: 30 * 60e3 } : null },
    { k: 'diff', label: 'Difficulty', info: 'd_difficulty', get: () => N.hash ? { v: `${(N.hash.difficulty / 1e12).toFixed(1)} T`, sub: N.da ? `last adjustment <span class="${cls(N.da.previousRetarget)}">${pct(N.da.previousRetarget, 2)}</span>` : '', src: mpSrc(), at: N.at, max: 30 * 60e3 } : null },
    { k: 'nextadj', label: 'Next difficulty adjustment', info: 'd_nextadj', get: () => N.da ? { v: `<span class="${cls(N.da.difficultyChange)}">${pct(N.da.difficultyChange, 2)}</span> <small>est.</small>`, sub: `in ${num(N.da.remainingBlocks)} blocks · ~${dShort(N.da.estimatedRetargetDate)}`, src: mpSrc(), at: N.at, max: 30 * 60e3 } : null },
    { k: 'blocktime', label: 'Average block time', info: 'd_blocktime', get: () => N.da ? { v: `${(N.da.timeAvg / 60e3).toFixed(1)} min`, sub: `this difficulty period · target 10 min · ${N.da.progressPercent.toFixed(0)}% through`, src: mpSrc(), at: N.at, max: 30 * 60e3 } : null },
    actCard('active', 'Active addresses', 'd_active', 1, kNum, '/day'),
    actCard('txs', 'Transactions', 'd_txcount', 2, kNum, '/day'),
    actCard('transfers', 'Transfers', 'd_transfers', 3, kNum, '/day'),
    actCard('addrbal', 'Addresses holding BTC', 'd_addrbal', 4, kNum, ''),
    { k: 'ln', label: 'Lightning capacity', info: 'd_lightning', get: () => { const L = S.dash?.lightning; if (!L?.asOf) return NA('Lightning statistics could not be retrieved.'); if (Date.now() - Date.parse(L.asOf) > 14 * DAY) return NA(`mempool.space’s free Lightning statistics stopped updating on ${dShort(L.asOf)}; older figures are not shown.`); return { v: btcF(L.capacityBtc), sub: `${num(L.channels)} channels · ${num(L.nodes)} nodes`, src: L.source, at: L.asOf, max: 3 * DAY }; } },
  ] },
  { id: 'fees', title: 'Fees & mempool', cards: [
    { k: 'fees', label: 'Fee to confirm in ~10 min', info: 'd_fees', get: () => N.fees ? { v: `${fee(N.fees.fastestFee)} sat/vB`, sub: `30 min ${fee(N.fees.halfHourFee)} · 1 h ${fee(N.fees.hourFee)} · economy ${fee(N.fees.economyFee)}`, src: mpSrc(), at: N.at, max: 10 * 60e3 } : null },
    { k: 'txcost', label: 'Simple transaction cost', info: 'd_txcost', get: () => N.fees && price() ? { v: usd((140 * N.fees.halfHourFee * price()) / 1e8, 2), sub: `≈140 vB at ${fee(N.fees.halfHourFee)} sat/vB (30-min rate)`, src: mpSrc(' · live price'), at: N.at, max: 10 * 60e3 } : null },
    { k: 'mempool', label: 'Mempool backlog', info: 'd_mempool', get: () => N.mempool ? { v: `${num(N.mempool.count)} tx`, sub: `${(N.mempool.vsize / 1e6).toFixed(1)} MvB ≈ ${Math.max(1, Math.ceil(N.mempool.vsize / 1e6))} blocks of transactions waiting`, src: mpSrc(), at: N.at, max: 10 * 60e3 } : null },
    { k: 'feesday', label: 'Fees paid per day', info: 'd_feesday', get: () => {
      const rows = col(S.dash?.activity, 5); if (!rows.length) return null;
      const v = rows.at(-1)[1], a30 = avgOf(lastN(rows, 30));
      return { v: `${v.toFixed(2)} BTC`, sub: `≈${usd(v * price())} on ${dShort(rows.at(-1)[0])} · 30-day average ${a30.toFixed(2)} BTC`, spark: lastN(rows, 90), sfmt: (y) => `${y.toFixed(2)} BTC`, src: 'Coin Metrics Community', at: rows.at(-1)[0], max: 3 * DAY };
    } },
  ] },
  { id: 'mining', title: 'Mining', cards: [
    { k: 'hashprice', label: 'Hashprice', info: 'd_hashprice', get: () => {
      const H = S.dash?.hashpower, own = ownHashprice();
      if (hasH()) return { v: `$${H.hashpriceUsdPh.toFixed(2)} <small>/PH/day</small>`, sub: `${(H.hashpriceBtcPh * 1e8).toFixed(0)} sats per PH/s per day${ok(own) ? ` · BTC Intel’s own estimate $${own.toFixed(2)}` : ''}`, spark: lastN(H.daily, 90), sfmt: (y) => `$${y.toFixed(2)}`, src: 'CloudMineCrypto', at: H.asOf, max: 3 * 3600e3 };
      return ok(own) ? { v: `$${own.toFixed(2)} <small>/PH/day</small>`, sub: 'last 144 blocks’ rewards ÷ difficulty', src: 'Computed from mempool.space', at: N.at, max: 60 * 60e3 } : null;
    } },
    { k: 'feeshare', label: 'Fees share of miner revenue', info: 'd_feeshare', get: () => {
      const H = S.dash?.hashpower;
      if (hasH() && ok(H.feeSharePct)) return { v: pct(H.feeSharePct, 2, false), sub: `${N.reward ? `last 144 blocks ${pct((N.reward.fees / N.reward.total) * 100, 2, false)} (mempool.space) · ` : ''}90-day average ${pct(avgOf(H.daily.map((r) => [r[0], r[2]]).filter((r) => ok(r[1]))), 2, false)}`, spark: lastN(H.daily.map((r) => [r[0], r[2]]), 90), sfmt: (y) => `${y.toFixed(2)}%`, src: 'CloudMineCrypto', at: H.asOf, max: 3 * 3600e3 };
      return N.reward ? { v: pct((N.reward.fees / N.reward.total) * 100, 2, false), sub: `${btcF(N.reward.fees / 1e8, 2)} in fees over the last 144 blocks`, src: mpSrc(' reward stats'), at: N.at, max: 60 * 60e3 } : null;
    } },
    { k: 'minerrev', label: 'Miner revenue (last 144 blocks)', info: 'd_minerrev', get: () => N.reward && price() ? { v: big((N.reward.total / 1e8) * price()), sub: `${btcF(N.reward.total / 1e8, 1)} · subsidy plus fees · ≈1 day of blocks`, src: mpSrc(' reward stats'), at: N.at, max: 60 * 60e3 } : null },
    { k: 'subsidy', label: 'Block reward', info: 'd_halving', get: () => N.height ? { v: `${subsidyBtc(N.height)} BTC`, sub: N.reward ? `+ ${(N.reward.fees / 1e8 / (N.reward.end - N.reward.start + 1)).toFixed(3)} BTC fees per block (last 144)` : 'new coins per block', src: 'Protocol schedule · mempool.space', at: N.at, max: 60 * 60e3 } : null },
    cycleCard('puell', 'Puell Multiple', 'puell'),
    cycleCard('hashribbons', 'Hash Ribbons', 'hashribbons'),
    { k: 'pools', wide: true, label: 'Mining pool concentration (7 days)', info: 'd_pools', get: () => {
      const P = S.dash?.pools; if (!P?.top?.length) return null;
      const top3 = P.top.slice(0, 3).reduce((a, x) => a + x.share, 0);
      return { v: `${pct(P.top[0].share, 1, false)} <small>largest pool</small> · ${pct(top3, 0, false)} <small>top 3</small>`, sub: `<ol class="plist">${P.top.slice(0, 6).map((x) => `<li><span>${esc(x.name)}</span><i style="width:${x.share.toFixed(1)}%"></i><b class="num">${x.share.toFixed(1)}%</b></li>`).join('')}</ol>${num(P.blocks)} blocks by ${P.count} pools`, src: P.source, at: P.fetchedAt, max: 3 * 3600e3 };
    } },
  ] },
  { id: 'supply', title: 'Supply & halving', cards: [
    { k: 'supply', label: 'Issued supply', info: 'd_supply', get: () => supplyNow() ? { v: btcF(supplyNow()), sub: `${((supplyNow() / 21e6) * 100).toFixed(2)}% of 21,000,000 · ${btcF(21e6 - supplyNow())} left to issue`, src: 'Computed from block height', at: N.at, max: 60 * 60e3 } : null },
    { k: 'infl', label: 'Annual issuance rate', info: 'd_inflation', get: () => supplyNow() ? { v: pct(((subsidyBtc(N.height) * 52560) / supplyNow()) * 100, 2, false), sub: `≈${num(subsidyBtc(N.height) * 144)} new BTC per day (${usd(subsidyBtc(N.height) * 144 * price() / 1e6, 1)}M)`, src: 'Computed from block reward', at: N.at, max: 60 * 60e3 } : null },
    { k: 'exsup', label: 'Coins on exchanges', info: 'd_exsupply', get: () => { const r = S.dash?.flows?.rows?.at(-1), v = r?.[3] ?? S.a?.metrics.onchain?.exSupply; if (!ok(v)) return null; return { v: btcF(v), sub: `${supplyNow() ? ((v / supplyNow()) * 100).toFixed(1) + '% of supply · ' : ''}30d <span>${pct(S.a?.metrics.onchain?.exSupply30d)}</span>`, src: 'Coin Metrics (entity heuristics)', at: S.dash?.flows?.asOf ?? S.a?.metrics.onchain?.mvrvDate, max: 3 * DAY }; } },
    { k: 'halving', label: 'Next halving', info: 'd_halving', get: () => {
      if (!N.height) return null;
      const next = nextHalving(N.height), left = next - N.height, done = HALVING_INTERVAL - left, avg = N.da?.timeAvg || 600e3, eta = Date.now() + left * avg;
      return { v: `${num(left)} blocks`, sub: `block ${num(next)} · est. ${dShort(eta)} · reward ${subsidyBtc(N.height)} → ${subsidyBtc(next)} BTC<span class="hbar"><i style="width:${((done / HALVING_INTERVAL) * 100).toFixed(1)}%"></i></span>${((done / HALVING_INTERVAL) * 100).toFixed(1)}% of this era complete`, src: 'Protocol schedule · date estimated from recent block times', at: N.at, max: 60 * 60e3 };
    } },
  ] },
  { id: 'onchain', title: 'On-chain valuation', cards: [
    cycleCard('mvrv', 'MVRV ratio', 'mvrv'),
    cycleCard('nupl', 'NUPL', 'nupl'),
    { k: 'rprice', label: 'Realised price', info: 'realized', get: () => { const r = S.a?.metrics.onchain?.realizedPrice; if (!ok(r)) return null; const x = (price() / r - 1) * 100; return { v: usd(r), sub: `price <span class="${cls(x)}">${pct(x)}</span> above · average cost basis of all coins`, src: 'Coin Metrics (price ÷ MVRV)', at: S.a.metrics.onchain.mvrvDate, max: 3 * DAY }; } },
    cycleCard('profit', 'Supply in profit', 'profit'),
    cycleCard('sopr', 'SOPR', 'sopr'),
    cohortCard('sth', 'Short-term holder realised price', 'd_sthrp', 'sth', 'average cost of coins moved in the last ~155 days'),
    cohortCard('lth', 'Long-term holder realised price', 'd_lthrp', 'lth', 'average cost of coins held longer'),
    { k: 'stables', label: 'Stablecoin supply', info: 'stables', get: () => { const o = S.a?.metrics.onchain; return ok(o?.stables) ? { v: big(o.stables), sub: `30d <span class="${cls(o.stables30d)}">${o.stables30d >= 0 ? '+' : '−'}${big(Math.abs(o.stables30d))}</span> · 7d ${o.stables7d >= 0 ? '+' : '−'}${big(Math.abs(o.stables7d))}`, src: 'DefiLlama', at: srcQ('defillama_stables')?.asOf, max: 3 * DAY } : null; } },
    { k: 'exflow', full: true, label: 'Exchange net flow', info: 'd_exflow', get: () => {
      const rows = S.dash?.flows?.rows; if (!rows?.length) return null;
      const net = rows.map((r) => [r[0], r[1] - r[2]]), n7 = net.slice(-7).reduce((s, r) => s + r[1], 0), n30 = net.slice(-30).reduce((s, r) => s + r[1], 0);
      return { v: `<span>${n7 > 0 ? '+' : '−'}${btcF(Math.abs(n7))}</span> <small>7d</small>`, sub: `${n7 > 0 ? 'net into' : 'net out of'} exchanges · 30d ${n30 > 0 ? '+' : '−'}${btcF(Math.abs(n30))} · latest day ${net.at(-1)[1] > 0 ? '+' : '−'}${btcF(Math.abs(net.at(-1)[1]))}${flowBars(net.slice(-90))}`, src: 'Coin Metrics FlowInExNtv − FlowOutExNtv (recent days are early estimates)', at: S.dash.flows.asOf, max: 3 * DAY };
    } },
  ] },
  { id: 'derivs', title: 'Derivatives', cards: [
    { k: 'oi', label: 'Futures open interest', info: 'd_oi', get: () => { const d = S.a?.metrics.derivs; return ok(d?.totalOi) ? { v: big(d.totalOi), sub: `${esc(d.coverage.replaceAll(',', ', '))}${d.marketWide?.totalOiUsd ? ` · all ${d.marketWide.marketCount} markets ${big(d.marketWide.totalOiUsd)} (CoinGecko)` : ''}`, src: 'Exchange APIs · CoinGecko', at: srcQ('okx_deriv')?.asOf, max: 26 * H } : null; } },
    { k: 'funding', label: 'Funding rate (annualised)', info: 'd_funding', get: () => { const d = S.a?.metrics.derivs; return ok(d?.fundingAnn) ? { v: `<span class="${cls(d.fundingAnn)}">${pct(d.fundingAnn)}</span>`, sub: `average across venues · ${(d.funding8h * 100).toFixed(4)}% per 8h`, src: 'Exchange APIs', at: srcQ('okx_deriv')?.asOf, max: 26 * H } : null; } },
    { k: 'opts', label: 'Options open interest', info: 'd_options', get: () => { const o = S.a?.metrics.options; return ok(o?.notionalUsd) ? { v: big(o.notionalUsd), sub: `DVOL ${num(o.dvol, 1)} · put/call ${num(o.pcRatio, 2)}`, src: 'Deribit', at: srcQ('deribit_opt')?.asOf, max: 26 * H } : null; } },
    { k: 'liqs', label: 'Liquidations (OKX sample)', info: 'd_liqsample', get: () => { const l = S.a?.metrics.liq; return ok(l?.longUsd) ? { v: `${big(l.longUsd)} <small>longs</small> · ${big(l.shortUsd)} <small>shorts</small>`, sub: `last ${l.count} orders, ${hhmm.format(new Date(l.from))}–${hhmm.format(new Date(l.to))} · market-wide totals need paid data`, src: l.venue, at: l.to, max: 26 * H } : null; } },
    { k: 'basis', label: 'Futures basis (annualised)', info: 'd_basis', get: () => { const b = S.a?.metrics.derivs?.basis; return ok(b?.annPct) ? { v: `<span class="${cls(b.annPct)}">${pct(b.annPct)}</span>`, sub: `${esc(b.instrument)}, ${Math.round(b.days)} days to expiry · premium of futures over spot`, src: 'Deribit', at: srcQ('deribit_fut')?.asOf, max: 26 * H } : null; } },
    { k: 'dvol', label: 'Implied volatility (DVOL)', info: 'd_dvol', get: () => { const o = S.a?.metrics.options; return ok(o?.dvol) ? { v: num(o.dvol, 1), sub: `${ok(o.dvolPctile) ? `${Math.round(o.dvolPctile)}th percentile of the past year · ` : ''}week ago ${num(o.dvol7dAgo, 1)}`, spark: lastN(o.dvolSeries, 120), sfmt: (y) => num(y, 1), src: 'Deribit DVOL', at: srcQ('deribit_dvol')?.asOf, max: 26 * H } : null; } },
    { k: 'ivrv', label: 'Implied minus realised volatility', info: 'd_ivrv', get: () => { const o = S.a?.metrics.options, p = S.a?.metrics.price; return ok(o?.ivRvSpread) ? { v: `<span class="${cls(o.ivRvSpread)}">${o.ivRvSpread > 0 ? '+' : '−'}${Math.abs(o.ivRvSpread).toFixed(1)}</span> <small>vol pts</small>`, sub: `30-day implied ${num(o.atmIv30, 1)}% vs realised ${num(p?.rv30, 1)}%`, src: 'Deribit · daily closes', at: srcQ('deribit_opt')?.asOf, max: 26 * H } : null; } },
    { k: 'dvs', label: 'Derivatives vs spot volume', info: 'd_dvs', get: () => { const st = S.a?.metrics.structure; return ok(st?.derivToSpot) ? { v: `${st.derivToSpot.toFixed(2)}×`, sub: `perpetual/futures ${big(st.derivVolume24h)} vs spot ${big(st.spotVolume24h)} (24h, covered venues)`, src: 'Exchange APIs · CoinGecko', at: srcQ('coingecko_markets')?.asOf, max: 26 * H } : null; } },
  ] },
  { id: 'holders', title: 'ETFs & treasuries', cards: [
    { k: 'etf', label: 'Spot ETF net flow', info: 'd_etf', get: () => { const e = S.a?.metrics.etf; return ok(e?.last) ? { v: `<span class="${cls(e.last)}">${e.last >= 0 ? '+' : '−'}$${num(Math.abs(e.last), 1)}M</span>`, sub: `${dShort(e.lastDate)} · 5 days ${e.s5 >= 0 ? '+' : '−'}$${num(Math.abs(e.s5))}M · 20 days ${e.s20 >= 0 ? '+' : '−'}$${num(Math.abs(e.s20))}M`, src: 'Farside Investors', at: e.lastDate, max: 4 * DAY } : null; } },
    { k: 'etftot', label: 'US spot Bitcoin ETFs: total', info: 'd_etfs', get: () => {
      const E = S.dash?.etfs?.funds?.filter((f) => f.assets > 0); if (!E?.length) return null;
      const tot = E.reduce((a, f) => a + f.assets, 0), btc = price() ? tot / price() : null, fl = etfFlowSums();
      return { v: big(tot), sub: `${E.length} funds · ≈${btcF(btc)} held${supplyNow() && btc ? ` (${((btc / supplyNow()) * 100).toFixed(2)}% of supply)` : ''}${fl ? ` · flows 1d ${sgnM(fl.d1)} · 5d ${sgnM(fl.d5)} · 20d ${fl.n >= 20 ? sgnM(fl.d20) : '—'}` : ''}`, src: 'Yahoo Finance · Farside', at: S.dash.etfs.fetchedAt, max: 2 * DAY };
    } },
    { k: 'treas', label: 'Public companies: total BTC', info: 'd_treasury', get: () => {
      const T = S.dash?.treasuries; if (!ok(T?.totalBtc)) return null;
      return { v: btcF(T.totalBtc), sub: `${T.companies} listed companies${supplyNow() ? ` · ${((T.totalBtc / supplyNow()) * 100).toFixed(2)}% of issued supply` : ''} · worth ${big(T.totalBtc * price())}`, src: 'CoinGecko treasuries', at: T.fetchedAt, max: 2 * DAY };
    } },
    { k: 'treasconc', label: 'Treasury concentration', info: 'd_treasconc', get: () => {
      const T = S.dash?.treasuries; if (!T?.top?.length) return null;
      const t1 = T.top[0], s1 = (t1.btc / T.totalBtc) * 100, s5 = (T.top.slice(0, 5).reduce((a, c) => a + c.btc, 0) / T.totalBtc) * 100;
      return { v: pct(s1, 1, false), sub: `held by ${esc(t1.name)} alone · top 5 hold ${pct(s5, 0, false)} of all company BTC`, src: 'CoinGecko treasuries', at: T.fetchedAt, max: 2 * DAY };
    } },
    { k: 'etftable', full: true, label: 'US spot Bitcoin ETFs — ranked', info: 'd_etfs', get: () => etfTable() },
    { k: 'treaslist', full: true, label: 'Largest public company holders', info: 'd_treasury', get: () => {
      const T = S.dash?.treasuries; if (!T?.top?.length) return null;
      const n = S.treasAll ? T.top.length : 12, sup = supplyNow();
      return { v: '', sub: `<table class="ttable"><thead><tr><th>#</th><th>Company</th><th>Ticker</th><th>Country</th><th class="r">BTC</th><th class="r">Value</th><th class="r">% of supply</th></tr></thead><tbody>${T.top.slice(0, n).map((c, i) => `<tr><td class="dim">${i + 1}</td><td>${esc(c.name)}</td><td class="dim">${esc(c.symbol)}</td><td class="dim">${esc(c.country || '')}</td><td class="r num">${num(c.btc)}</td><td class="r num">${big(c.btc * price())}</td><td class="r num">${sup ? ((c.btc / sup) * 100).toFixed(3) + '%' : '—'}</td></tr>`).join('')}</tbody></table>${T.top.length > 12 ? `<button type="button" class="linkbtn" data-treas-more>${S.treasAll ? 'Show top 12' : `Show top ${T.top.length}`}</button>` : ''}`, src: `${T.source} · holdings as last disclosed by each company`, at: T.fetchedAt, max: 2 * DAY };
    } },
  ] },
  { id: 'corr', title: 'Correlations', note: 'Rolling correlation of daily returns between Bitcoin and other markets — co-movement, not causation. +1 means they moved together, −1 opposite, 0 unrelated.', cards: [
    corrCard('SPX', 'BTC vs S&P 500'), corrCard('GOLD', 'BTC vs gold'), corrCard('DXY', 'BTC vs US dollar index'),
  ] },
  { id: 'sentiment', title: 'Sentiment & positioning', cards: [
    { k: 'fngc', label: 'Fear & Greed (90 days)', info: 'd_fng', get: () => { const F = S.dash?.fng; return ok(F?.value) ? { v: `${F.value} <small>${esc(F.label)}</small>`, sub: `7-day average ${F.avg7 ?? '—'} · 30-day average ${F.avg30 ?? '—'} · 30 days ago ${F.d30 ?? '—'}`, spark: lastN(F.series, 90), sfmt: (y) => String(y), src: 'alternative.me (third-party)', at: F.asOf, max: 2 * DAY } : null; } },
    { k: 'ls', label: 'Long/short account ratio', info: 'd_ls', get: () => { const L = S.a?.metrics.derivs?.longShort; return ok(L?.okx) ? { v: num(L.okx, 2), sub: `${L.okx >= 1 ? 'more' : 'fewer'} accounts long than short · a week ago ${num(L.okx7dAgo, 2)}${ok(L.binance) ? ` · Binance ${num(L.binance, 2)}` : ''}`, src: 'OKX trading data', at: srcQ('okx_rubik')?.asOf, max: 26 * H } : null; } },
    { k: 'cbprem', label: 'Coinbase premium', info: 'd_cbprem', get: () => { const v = S.a?.metrics.depth?.coinbasePremiumPct; return ok(v) ? { v: `<span class="${cls(v)}">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(3)}%</span>`, sub: 'Coinbase BTC-USD vs the average of USDT-quoted venues', src: 'Exchange order books', at: srcQ('book_coinbase')?.asOf, max: 26 * H } : null; } },
    { k: 'pcr', label: 'Options put/call ratio', info: 'd_pcr', get: () => { const o = S.a?.metrics.options; return ok(o?.pcRatio) ? { v: num(o.pcRatio, 2), sub: `open puts per open call · ${o.pcRatio < 0.7 ? 'calls dominate' : o.pcRatio > 1 ? 'puts dominate' : 'balanced'}`, src: 'Deribit', at: srcQ('deribit_opt')?.asOf, max: 26 * H } : null; } },
    { k: 'skew', label: '25-delta options skew', info: 'd_skew', get: () => { const o = S.a?.metrics.options; return ok(o?.skew25) ? { v: `${o.skew25 > 0 ? '+' : o.skew25 < 0 ? '−' : ''}${Math.abs(o.skew25).toFixed(1)} <small>vol pts</small>`, sub: `${o.skew25 < 0 ? 'puts priced richer than calls' : 'calls priced richer than puts'} · ~30-day expiry (${esc(o.refExpiry || '')})`, src: 'Deribit', at: srcQ('deribit_opt')?.asOf, max: 26 * H } : null; } },
    { k: 'breadth', label: 'Altcoin breadth vs BTC (7d)', info: 'd_breadth', get: () => { const st = S.a?.metrics.structure; return ok(st?.breadth7) ? { v: pct(st.breadth7, 0, false), sub: `of top coins beat Bitcoin over 7 days · ${pct(st.altsUp7, 0, false)} rose in dollar terms`, src: 'CoinGecko top 50 (stablecoins excluded)', at: srcQ('coingecko_markets')?.asOf, max: 26 * H } : null; } },
    { k: 'newstone', label: 'News tone (24 hours)', info: 'd_news', get: () => {
      const day = (S.dash?.news?.items || []).filter((i) => !i.macro && Date.now() - Date.parse(i.t) < DAY); if (!day.length) return null;
      const c = { bullish: 0, bearish: 0, neutral: 0 }; day.forEach((i) => c[i.tag]++);
      return { v: `<button type="button" class="tone up" data-tone="bullish" title="Read only bullish headlines">${c.bullish}▲</button> <button type="button" class="tone down" data-tone="bearish" title="Read only bearish headlines">${c.bearish}▼</button> <button type="button" class="tone dim" data-tone="neutral" title="Read only neutral headlines"><small>${c.neutral} neutral</small></button>`, sub: `of ${day.length} headlines · click a count to read only those · keyword tags, not a judgement of the stories`, src: 'News feed (keyword rules)', at: S.dash.updated, max: 45 * 60e3 };
    } },
  ] },
];
function corrCard(k, label) {
  return { k: 'corr-' + k, label, info: 'd_corr', get: () => {
    const P = S.dash?.correlations?.pairs?.[k]; if (!ok(P?.c30)) return null;
    const words = (c) => `${Math.abs(c) < 0.2 ? 'little co-movement' : `${Math.abs(c) < 0.5 ? 'moderate' : 'strong'} ${c > 0 ? 'co-movement' : 'opposite movement'}`}`;
    const sg = (c) => (ok(c) ? `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c).toFixed(2)}` : '—');
    return { v: `${sg(P.c30)} <small>30-day</small>`, sub: `${words(P.c30)} · 90-day ${sg(P.c90)} · a month ago ${sg(P.c30MonthAgo)}`, spark: lastN(P.s30, 180), sfmt: sg, src: 'Computed by BTC Intel · Coin Metrics + Yahoo Finance closes', at: P.asOf, max: 5 * DAY };
  } };
}
function cycleCard(id, label, info) {
  return { k: 'cy-' + id, label, info, get: () => { const x = cyM(id); if (!x) return null; if (x.value === null) return NA(x.unavailableWhy || 'Not available from free sources.'); return { v: esc(x.display), sub: `${x.zone ? `<b class="z-${x.zone.tone || 'neu'}">${esc(x.zone.label)}</b> · ` : ''}${esc(String(x.meaning || '').split(/(?<!\d)\.(?!\d)| — /)[0])}`, src: x.source, at: x.asOf, max: 4 * DAY }; } };
}
function flowBars(net) {
  if (net.length < 5) return '';
  const W = 300, Hh = 46, m = Math.max(...net.map((r) => Math.abs(r[1]))) || 1, bw = W / net.length;
  return `<svg class="fbars" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" role="img" aria-label="Daily exchange net flow, last ${net.length} days">${net.map(([d, v], i) => { const hh = (Math.abs(v) / m) * (Hh / 2 - 1); return `<rect class="${v > 0 ? 'in' : 'out'}" x="${(i * bw + 0.5).toFixed(1)}" width="${Math.max(0.8, bw - 1).toFixed(1)}" y="${(v > 0 ? Hh / 2 - hh : Hh / 2).toFixed(1)}" height="${Math.max(0.5, hh).toFixed(1)}"><title>${d}: ${v > 0 ? '+' : '−'}${num(Math.abs(v))} BTC</title></rect>`; }).join('')}<line x1="0" x2="${W}" y1="${Hh / 2}" y2="${Hh / 2}"/></svg><span class="fleg"><i class="in"></i>into exchanges <i class="out"></i>out of exchanges · ${net.length} days</span>`;
}
// small trend line under a card value; hover shows first and latest points
function sparkSvg(rows, f = (v) => num(v)) {
  if (!rows || rows.length < 5) return '';
  const W = 240, Hh = 34, vs = rows.map((r) => r[1]), lo = Math.min(...vs), hi = Math.max(...vs), sp = hi - lo || 1;
  const X = (i) => (i / (rows.length - 1)) * (W - 4) + 2, Y = (v) => Hh - 3 - ((v - lo) / sp) * (Hh - 6);
  const d = rows.map((r, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(r[1]).toFixed(1)}`).join('');
  return `<svg class="spk" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" role="img" aria-label="Trend from ${rows[0][0]} to ${rows.at(-1)[0]}"><title>${rows[0][0]}: ${f(rows[0][1])} → ${rows.at(-1)[0]}: ${f(rows.at(-1)[1])} (range ${f(lo)}–${f(hi)})</title><path d="${d}"/><circle cx="${X(rows.length - 1).toFixed(1)}" cy="${Y(rows.at(-1)[1]).toFixed(1)}" r="2.2"/></svg><span class="spk-l"><span>${shortD(rows[0][0])}</span><span>${rows.length} days</span><span>${shortD(rows.at(-1)[0])}</span></span>`;
}
const shortD = (d) => { const x = new Date(d + 'T00:00:00Z'); return isNaN(x) ? '' : `${MON[x.getUTCMonth()]} ${x.getUTCDate()}`; };
const cardShell = (c) => `<div class="dkcard${c.wide ? ' wide' : ''}${c.full ? ' full' : ''}" data-k="${c.k}"><div class="mc-h"><span class="mc-l">${esc(c.label)}</span>${S.info(c.info)}</div><div class="mc-v num"></div><div class="mc-s"></div><div class="mc-sp"></div><div class="mc-m"><i class="fd"></i><span></span></div></div>`;
const freshLabel = { ok: 'up to date', stale: 'older than its usual update interval', na: 'not available' };
export function paintCards(root = document) {
  for (const g of GROUPS) { const hidden = []; for (const c of g.cards) {
    const el = root.querySelector(`.dkcard[data-k="${c.k}"]`);
    if (!el) continue;
    let r; try { r = c.get(); } catch { r = null; }
    if (!r) r = { na: true, v: 'Waiting for data…', sub: '', src: '' };
    const f = r.na ? 'na' : fresh(r.at, r.max ?? DAY);
    el.classList.toggle('na', !!r.na);
    // a card with no free data is hidden and named in the group's footnote instead of leaving an empty slot
    el.hidden = !!r.na && r.v !== 'Waiting for data…';
    el.querySelector('.mc-v').innerHTML = r.v;
    el.querySelector('.mc-s').innerHTML = r.sub || '';
    el.querySelector('.mc-sp').innerHTML = r.spark ? sparkSvg(r.spark, r.sfmt) : '';
    const m = el.querySelector('.mc-m');
    m.querySelector('.fd').className = 'fd ' + f;
    m.title = `Freshness: ${freshLabel[f]}`;
    m.querySelector('span').textContent = r.src ? `${r.src}${r.at ? ' · ' + (typeof r.at === 'number' || r.at.length > 10 ? (Date.now() - new Date(r.at) < DAY ? hhmm.format(new Date(r.at)) : dShort(r.at)) : dShort(r.at)) : ''}` : '';
    if (el.hidden) hidden.push(`<b>${esc(c.label)}</b> — ${r.sub}`);
  }
  const gn = root.querySelector(`#g-${g.id} .gnote`); if (gn) { gn.innerHTML = hidden.length ? `Not shown (no current free source): ${hidden.join(' · ')}` : ''; gn.hidden = !hidden.length; }
  }
}

// ---------- side cards ----------
function fngHtml() {
  const F = S.dash?.fng;
  if (!ok(F?.value)) return `<section class="dcard fng"><div class="dc-h"><h2>Fear &amp; Greed${S.info('d_fng')}</h2></div><p class="muted small">Not available right now.</p></section>`;
  const a = Math.PI * (1 - F.value / 100), x = 60 + 46 * Math.cos(a), y = 58 - 46 * Math.sin(a);
  const tone = F.value <= 25 ? 'down' : F.value <= 45 ? 'warnc' : F.value < 55 ? '' : 'up';
  const cmp = (k, l) => (ok(F[k]) ? `<span>${l} <b class="num">${F[k]}</b></span>` : '');
  return `<section class="dcard fng"><div class="dc-h"><h2>Fear &amp; Greed${S.info('d_fng')}</h2><span class="tag3">third-party</span></div>
    <div class="fng-row"><svg viewBox="0 0 120 66" class="fgauge" aria-hidden="true"><path class="tr" d="M14 58 A46 46 0 0 1 106 58"/><path class="fl ${tone}" d="M14 58 A46 46 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"/></svg>
    <div><div class="fv num ${tone}">${F.value}</div><div class="fl2">${esc(F.label)}</div></div>
    <div class="fcmp">${cmp('d1', 'Yesterday')}${cmp('d7', 'Week ago')}${cmp('d30', 'Month ago')}</div></div>
    ${F.series?.length > 5 ? `<div class="fhist">${sparkSvg(lastN(F.series, 90), (y) => String(y))}<div class="fav"><span>7-day avg <b class="num">${F.avg7 ?? '—'}</b></span><span>30-day avg <b class="num">${F.avg30 ?? '—'}</b></span></div></div>` : ''}
    <p class="srcl"><i class="fd ${F.stale ? 'stale' : fresh(F.asOf, 2 * DAY)}"></i>${esc(F.source)} · ${dShort(F.asOf)} · <a href="${esc(F.url)}" target="_blank" rel="noopener">method</a></p></section>`;
}
function newsHtml() {
  const NW = S.dash?.news;
  return `<section class="dcard news" id="d-news"><div class="dc-h"><h2>News &amp; sentiment${S.info('d_news')}</h2>
    <div class="seg" role="group" aria-label="Filter news">${[['all', 'All'], ['btc', 'Bitcoin'], ['macro', 'Fed']].map(([k, l]) => `<button type="button" data-nf="${k}" aria-pressed="${S.newsFilter === k}">${l}</button>`).join('')}</div></div>
    <div class="ntally" id="d-ntally"></div>
    <ul class="nlist" id="d-nlist"></ul>
    <p class="srcl">${NW ? `<i class="fd ${fresh(S.dash.updated, 45 * 60e3)}"></i>${NW.sources.filter((s) => s.ok).length} of ${NW.sources.length} feeds · checked ${ago(Date.parse(S.dash.updated))} · tags are keyword rules, not a judgement` : 'News feed not yet available.'}</p></section>`;
}
function paintNews() {
  const list = document.getElementById('d-nlist'); if (!list) return;
  const items = (S.dash?.news?.items || []).filter((i) => (S.newsFilter === 'all' ? true : S.newsFilter === 'macro' ? i.macro : !i.macro) && (S.newsTone === 'all' || (!i.macro && i.tag === S.newsTone)));
  const shown = S.newsAll ? items.slice(0, 60) : items.slice(0, 14);
  const icon = { bullish: '▲', bearish: '▼', neutral: '•' };
  list.innerHTML = shown.length ? shown.map((i) => `<li><span class="ntag ${i.tag}" title="${i.macro ? 'Central-bank release — not tagged' : i.words.length ? `Keyword tag “${i.tag}” from: ${esc(i.words.join(', '))}` : 'No tag keywords found'}">${i.macro ? 'FED' : icon[i.tag]}</span><div><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a><span class="nmeta">${esc(i.source)}${i.via ? ` <span class="via">via ${esc(i.via)}</span>` : ''} · ${relShort(Date.parse(i.t))}</span></div></li>`).join('') + (items.length > 14 ? `<li class="nmore"><button type="button" id="d-nmore">${S.newsAll ? 'Show fewer' : `Show ${Math.min(60, items.length) - 14} more`}</button></li>` : '') : `<li class="muted small">No ${S.newsTone !== 'all' ? S.newsTone + ' ' : ''}headlines in this filter.</li>`;
  // counts cover the same window as the list (the feed keeps 72 hours), so a count matches what a click shows
  const day = (S.dash?.news?.items || []).filter((i) => !i.macro), c = { bullish: 0, bearish: 0, neutral: 0 };
  day.forEach((i) => c[i.tag]++);
  const tal = document.getElementById('d-ntally');
  const tb = (k, cl, label) => `<button type="button" class="tone ${cl}" data-tone="${k}" aria-pressed="${S.newsTone === k}" title="${S.newsTone === k ? 'Show all headlines' : `Show only ${k} headlines`}">${label}</button>`;
  if (tal) tal.innerHTML = day.length ? `<span>Last 3 days, ${day.length} headlines:</span>${tb('bullish', 'up', `▲ ${c.bullish} bullish`)}${tb('bearish', 'down', `▼ ${c.bearish} bearish`)}${tb('neutral', 'dim', `• ${c.neutral} neutral`)}${S.newsTone !== 'all' ? `<button type="button" class="tone clear" data-tone="all">Show all</button>` : ''}<span class="tbar"><i class="up" style="width:${(c.bullish / day.length) * 100}%"></i><i class="down" style="width:${(c.bearish / day.length) * 100}%"></i></span>` : '';
  document.getElementById('d-nmore')?.addEventListener('click', () => { S.newsAll = !S.newsAll; paintNews(); });
}
function movesHtml() {
  return `<section class="dcard moves" id="d-moves"><div class="dc-h"><h2>Large moves${S.info('d_moves')}</h2>
    <div class="seg" role="group" aria-label="Filter moves">${[['all', 'All'], ['trade', 'Trades ≥$1M'], ['liq', 'Liquidations ≥$100K'], ['tx', 'On-chain ≥500 BTC']].map(([k, l]) => `<button type="button" data-mf="${k}" aria-pressed="${S.moveFilter === k}">${l}</button>`).join('')}</div></div>
    <div class="msum" id="d-msum"></div>
    <div class="mtable-wrap"><table class="mtable"><thead><tr><th>Time</th><th>Type</th><th>Venue</th><th>Side</th><th class="r">Size</th></tr></thead><tbody id="d-mlist"></tbody></table></div>
    <p class="srcl" id="d-mstat"></p></section>`;
}
const SIDE = { buy: ['Buy', 'up', 'taker bought'], sell: ['Sell', 'down', 'taker sold'], long: ['Long liq.', 'down', 'a long position was force-closed (forced selling)'], short: ['Short liq.', 'up', 'a short position was force-closed (forced buying)'] };
function paintMoves() {
  const tb = document.getElementById('d-mlist'); if (!tb) return;
  const rows = S.moves.filter((m) => S.moveFilter === 'all' || m.kind === S.moveFilter).slice(0, 40);
  tb.innerHTML = rows.length ? rows.map((m) => {
    const s = SIDE[m.side];
    const type = m.kind === 'trade' ? 'Trade' : m.kind === 'liq' ? 'Liquidation' : 'On-chain';
    const side = m.kind === 'tx' ? `<span class="dim" title="Total outputs incl. change; ${m.ins ?? '?'} inputs → ${m.outs} outputs">${m.ins ?? '?'}→${m.outs}</span>` : `<span class="${s[1]}" title="${s[2]}">${s[0]}</span>`;
    const size = `${m.usd ? big(m.usd) : ''} <span class="dim">${num(m.btc, m.btc >= 100 ? 0 : 2)} BTC</span>`;
    return `<tr class="k-${m.kind}"><td class="num">${hms.format(new Date(m.t))}</td><td><span class="mk ${m.kind}">${type}</span></td><td>${esc(m.venue)}${m.kind === 'tx' && /^[0-9a-f]{64}$/.test(m.hash) ? ` <a href="https://mempool.space/tx/${m.hash}" target="_blank" rel="noopener" title="Open on mempool.space">↗</a>` : ''}</td><td>${side}</td><td class="r num">${size}</td></tr>`;
  }).join('') : `<tr><td colspan="5" class="muted small empty"><b>All quiet so far.</b> Nothing above the thresholds (trades ≥ $1M, liquidations ≥ $100K, on-chain ≥ 500 BTC) has printed since this page opened${Object.values(S.moveStatus).includes('live') ? ` — ${Object.values(S.moveStatus).filter((v) => v === 'live').length} feeds are connected and watching` : ''}. Large prints come in bursts, often around big price moves; quiet stretches of an hour or more are normal.</td></tr>`;
  const hr = S.moves.filter((m) => Date.now() - m.t < H), t = hr.filter((m) => m.kind === 'trade'), l = hr.filter((m) => m.kind === 'liq'), x = hr.filter((m) => m.kind === 'tx');
  const sum = (a, f) => a.filter(f).reduce((s, m) => s + (m.usd || 0), 0);
  const ms = document.getElementById('d-msum');
  if (ms) ms.innerHTML = `<span class="k">Last hour</span><span>Trades ${t.length} · <b class="up">${big(sum(t, (m) => m.side === 'buy'))}</b> bought / <b class="down">${big(sum(t, (m) => m.side === 'sell'))}</b> sold</span><span>Liquidations ${l.length} · longs ${big(sum(l, (m) => m.side === 'long'))} / shorts ${big(sum(l, (m) => m.side === 'short'))}</span><span>On-chain ${x.length} · ${btcF(x.reduce((s, m) => s + m.btc, 0))}</span>`;
}
const STAT_LABEL = { live: 'live', connecting: 'connecting', reconnecting: 'reconnecting', down: 'offline', unavailable: 'unavailable here' };
function paintMoveStatus() {
  const el = document.getElementById('d-mstat'); if (!el) return;
  const names = { 'Coinbase-trade': 'Coinbase', 'Binance-trade': 'Binance', 'Kraken-trade': 'Kraken', 'OKX-liq': 'OKX liq.', 'Bybit-liq': 'Bybit liq.', 'Binance-liq': 'Binance liq.', 'On-chain-tx': 'blockchain.info mempool' };
  el.innerHTML = Object.entries(S.moveStatus).map(([k, v]) => `<span class="mst"><i class="fd ${v === 'live' ? 'ok' : v === 'down' || v === 'unavailable' ? 'na' : 'stale'}"></i>${names[k] || k} <span class="dim">${STAT_LABEL[v] || v}</span></span>`).join('') + `<span class="dim"> · shown only while this page is open; kept in this browser for 24 h</span>`;
}

// ---------- today's read ----------
// Up to three short, factual observations picked from the figures on this page by fixed rules.
function readBullets() {
  const out = [], p = price(), E = envelopeNow(S.pi, p), a = S.a?.metrics;
  if (E) out.push({ w: 10, t: `Price is <b>${esc(E.label)}</b> of its 20-day volatility envelope (${usd(E.lo)} – ${usd(E.up)}).${E.widthPct < 8 ? ' The envelope is unusually narrow, meaning recent daily moves have been small.' : E.widthPct > 25 ? ' The envelope is wide, reflecting large recent swings.' : ''}` });
  if (E?.sma200 && E?.sma50) { const x = (p / E.sma200 - 1) * 100; out.push({ w: 6 + Math.min(4, Math.abs(x) / 10), t: `Price is ${pct(Math.abs(x), 0, false)} ${x >= 0 ? 'above' : 'below'} its 200-day average (${usd(E.sma200)}), and the 50-day average is ${E.sma50 >= E.sma200 ? 'above' : 'below'} the 200-day — the longer-term trend is ${E.sma50 >= E.sma200 && x >= 0 ? 'up' : E.sma50 < E.sma200 && x < 0 ? 'down' : 'mixed'}.` }); }
  const F = S.dash?.fng; if (ok(F?.value)) { const ext = F.value <= 25 || F.value >= 75; out.push({ w: ext ? 9 : 3, t: `The Fear &amp; Greed Index reads <b>${F.value} (${esc(F.label)})</b>${ok(F.avg30) ? `, against a 30-day average of ${F.avg30}` : ''}.` }); }
  const e = a?.etf; if (ok(e?.s5) && Math.abs(e.s5) > 300) out.push({ w: 5 + Math.min(4, Math.abs(e.s5) / 500), t: `US spot ETFs saw <b>${e.s5 >= 0 ? 'net inflows' : 'net outflows'} of $${num(Math.abs(e.s5))}M</b> over the last five trading days.` });
  const f = a?.derivs?.fundingAnn; if (ok(f) && (f > 15 || f < 0)) out.push({ w: 7, t: `Perpetual funding is <b>${pct(f)}</b> annualised — ${f < 0 ? 'shorts are paying longs, which is uncommon' : 'longs are paying a high rate to hold leverage'}.` });
  const pm = S.dash?.polymarket?.events?.find((x) => /in 20\d\d/i.test(x.title)), up = pm?.markets?.filter((m) => m.dir === 'up' && m.strike > (p || 0)).sort((x, y) => x.strike - y.strike)[0];
  if (up) out.push({ w: 4, t: `Polymarket traders currently price about a <b>${Math.round(up.yes * 100)}%</b> chance of Bitcoin reaching ${usd(up.strike)} by the end of the year (market-implied, not our forecast).` });
  return out.sort((x, y) => y.w - x.w).slice(0, 3);
}
function paintRead() {
  const el = document.getElementById('d-read'); if (!el) return;
  const b = readBullets(); if (!b.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<div class="tr-h"><h2>Today’s read</h2>${S.info('d_read')}</div><ul>${b.map((x) => `<li>${x.t}</li>`).join('')}</ul><p class="tr-n">Picked from the figures on this page by fixed rules; context, not a forecast or advice.</p>`;
}

// ---------- Polymarket ----------
function pmHtml() {
  const P = S.dash?.polymarket;
  if (!P?.events?.length) return '';
  return `<section class="dcard pm" id="d-pm"><div class="dc-h"><h2>Prediction markets: Bitcoin price${S.info('d_polymarket')}</h2><div class="seg" role="group" aria-label="Market">${P.events.map((e, i) => `<button type="button" data-pm="${i}" aria-pressed="${i === S.pmIdx}">${esc(pmShort(e))}</button>`).join('')}</div></div>
    <p class="pm-note">These are market-implied probabilities from Polymarket prediction markets, not forecasts from us. A price of 38¢ on “Yes” means traders collectively price about a 38% chance.</p>
    <div class="pm-body" id="d-pm-body"></div>
    <p class="srcl"><i class="fd ${P.stale ? 'stale' : fresh(P.fetchedAt, 4 * H)}"></i>Polymarket public API · refreshed every 3 hours · fetched ${hhmm.format(new Date(P.fetchedAt))}</p></section>`;
}
const pmShort = (e) => { const t = e.title.replace(/^What price will Bitcoin hit /i, '').replace(/\?$/, ''); return /^bitcoin above/i.test(e.title) ? `Above … on ${e.title.replace(/^Bitcoin above ___ on /i, '').replace(/\?$/, '')}` : t.charAt(0).toUpperCase() + t.slice(1); };
function paintPm() {
  const body = document.getElementById('d-pm-body'), E = S.dash?.polymarket?.events?.[S.pmIdx]; if (!body || !E) return;
  const p = price();
  let rows = E.markets.filter((m) => m.yes > 0.005 && m.yes < 0.995);
  if (!S.pmAll && rows.length > 12 && p) rows = rows.sort((x, y) => Math.abs(x.strike - p) - Math.abs(y.strike - p)).slice(0, 12).sort((x, y) => y.strike - x.strike);
  const kind = (m) => (m.dir === 'up' ? 'reach' : m.dir === 'down' ? 'dip to' : 'above');
  body.innerHTML = `<p class="pm-q"><a href="${esc(E.url)}" target="_blank" rel="noopener">${esc(E.title)} ↗</a> <span class="dim">· resolves ${dShort(E.end)} · total volume ${big(E.vol)}</span></p>
    <div class="pm-wrap"><table class="pmt"><thead><tr><th>Outcome</th><th class="r">Yes</th><th class="pmbar-h"></th><th class="r">24h</th><th class="r">24h vol.</th><th class="r">Volume</th></tr></thead><tbody>${rows.map((m) => `<tr><td>${m.dir === 'up' ? '↑' : m.dir === 'down' ? '↓' : '≥'} ${kind(m)} <b class="num">${m.strike ? usd(m.strike) : esc(m.label)}</b></td><td class="r num"><b>${(m.yes * 100).toFixed(m.yes < 0.1 ? 1 : 0)}%</b></td><td class="pmbar"><i style="width:${(m.yes * 100).toFixed(1)}%"></i></td><td class="r num ${cls(m.ch)}">${ok(m.ch) && m.ch !== 0 ? `${m.ch > 0 ? '+' : '−'}${Math.abs(m.ch * 100).toFixed(1)} pts` : '<span class="dim">—</span>'}</td><td class="r num">${big(m.v24)}</td><td class="r num">${big(m.vol)}</td></tr>`).join('')}</tbody></table></div>
    ${E.markets.length > rows.length || S.pmAll ? `<button type="button" class="linkbtn" data-pm-all>${S.pmAll ? 'Show strikes nearest the price' : `Show all ${E.markets.filter((m) => m.yes > 0.005 && m.yes < 0.995).length} open strikes`}</button>` : ''}`;
}

// ---------- address & coin distribution ----------
const COH = [['shrimp', '🦐', 'Shrimp', '< 1 BTC'], ['crab', '🦀', 'Crab', '1–10 BTC'], ['fish', '🐟', 'Fish', '10–100 BTC'], ['shark', '🦈', 'Shark', '100–1K BTC'], ['whale', '🐳', 'Whale', '1K–10K BTC'], ['humpback', '🐋', 'Humpback', '> 10K BTC']];
function distHtml() {
  return `<section class="mgroup" id="g-dist"><h2>Address &amp; coin distribution${S.info('d_dist')}</h2><p class="gintro">How many addresses fall into each balance band, and how many coins they hold. Addresses are not people: exchanges hold millions of users’ coins in a few large addresses, and one person can use many small ones.</p><div class="dcard dist" id="d-dist"></div></section>`;
}
function paintDist() {
  const el = document.getElementById('d-dist'); if (!el) return;
  const D = S.dash?.distribution;
  if (!D?.cohorts) { el.innerHTML = '<p class="muted small">Distribution data is not available yet; it is fetched once a day.</p>'; return; }
  const hist = D.history || [], cur = D.cohorts;
  const ago = (n) => { const t = new Date(Date.parse(D.asOf) - n * DAY).toISOString().slice(0, 10); return [...hist].reverse().find((h) => h.date <= t) || null; };
  const H1 = ago(1), H7 = ago(7), H30 = ago(30);
  const chg = (h, k, i) => { if (!h?.c?.[k]) return '<span class="dim">—</span>'; const d = cur[k][i] - h.c[k][i]; return d === 0 ? '<span class="dim">0</span>' : `<span class="${cls(d)}">${d > 0 ? '+' : '−'}${num(Math.abs(d))}</span>`; };
  const tot = [Object.values(cur).reduce((a, c) => a + c[0], 0), Object.values(cur).reduce((a, c) => a + c[1], 0)];
  const row = (k, ic, nm, rg) => `<tr><td><span class="coh">${ic}</span> <b>${nm}</b> <span class="dim">${rg}</span></td><td class="r num">${num(cur[k][0])}</td><td class="r num">${chg(H1, k, 0)}</td><td class="r num">${chg(H7, k, 0)}</td><td class="r num">${chg(H30, k, 0)}</td><td class="r num">${num(cur[k][1])}</td><td class="r num">${((cur[k][1] / tot[1]) * 100).toFixed(1)}%</td><td class="r num">${chg(H1, k, 1)}</td><td class="r num">${chg(H7, k, 1)}</td><td class="r num">${chg(H30, k, 1)}</td></tr>`;
  const days = hist.length;
  el.innerHTML = `<div class="dist-wrap"><table class="distt"><thead><tr><th rowspan="2">Cohort</th><th class="r grp" colspan="4">Addresses</th><th class="r grp" colspan="6">Coins held (BTC)</th></tr><tr><th class="r">Count</th><th class="r">1d</th><th class="r">7d</th><th class="r">30d</th><th class="r">BTC</th><th class="r">Share</th><th class="r">1d</th><th class="r">7d</th><th class="r">30d</th></tr></thead><tbody>${COH.map((c) => row(...c)).join('')}<tr class="tot"><td><b>Total</b> <span class="dim">addresses with a balance</span></td><td class="r num">${num(tot[0])}</td><td></td><td></td><td></td><td class="r num">${num(tot[1])}</td><td class="r num">100%</td><td></td><td></td><td></td></tr></tbody></table></div>
    <p class="srcl"><i class="fd ${D.stale ? 'stale' : fresh(D.asOf, 2 * DAY)}"></i>${esc(D.source)} · as of ${dShort(D.asOf)} · changes are computed from BTC Intel’s own daily snapshots${days < 31 ? ` (${days} day${days === 1 ? '' : 's'} collected so far; 7- and 30-day changes appear once enough snapshots exist)` : ''} · <a href="${esc(D.url)}" target="_blank" rel="noopener">source table</a></p>`;
}

// ---------- hero ----------
function heroHtml() {
  return `<section class="dh-main" aria-label="Bitcoin right now">
      <div class="dh-top"><h1>Bitcoin right now</h1><span class="livebadge snap" data-live="badge"><i></i><span>Connecting to live price…</span></span></div>
      <div class="dh-px"><span class="px num" data-live="px">${usd(price())}</span><span data-live="ch"></span>${S.info('d_price')}</div>
      <dl class="dh-stats" id="dh-stats"></dl>
      <div class="dh-since" id="dh-since" hidden></div>
      <section class="tread" id="d-read" aria-label="Today’s read"></section>
  </section>`;
}
export function paintHero() {
  const L = S.live, p = price();
  const st = document.getElementById('dh-stats');
  if (st) {
    const cgv = S.cg?.total_volume?.usd;
    const row = (k, v, t) => `<div title="${esc(t || '')}"><dt>${k}</dt><dd class="num">${v}</dd></div>`;
    st.innerHTML = [
      row('24h high', L?.high ? usd(L.high) : usd(S.cg?.high_24h?.usd), L?.high ? `${L.source}` : 'CoinGecko'),
      row('24h low', L?.low ? usd(L.low) : usd(S.cg?.low_24h?.usd), L?.low ? `${L.source}` : 'CoinGecko'),
      row('24h volume', L?.volBtc ? big(L.volBtc * p) : big(cgv), L?.volBtc ? `${num(L.volBtc)} BTC on ${L.source}` : 'CoinGecko aggregate'),
      row('Market cap', supplyNow() ? big(p * supplyNow()) : big(S.a?.metrics.price.marketCap), 'live price × issued supply'),
      row('Dominance', ok(S.glob?.market_cap_percentage?.btc ?? S.a?.metrics.structure?.dominance) ? `${(S.glob?.market_cap_percentage?.btc ?? S.a.metrics.structure.dominance).toFixed(1)}%` : '—', 'CoinGecko'),
      row('From ATH', (() => { const ath = S.cg?.ath?.usd ?? S.a?.metrics.price.ath; return ok(ath) && p ? `<span class="${cls(p / ath - 1)}">${pct((p / ath - 1) * 100)}</span>` : '—'; })(), 'vs CoinGecko all-time high'),
    ].join('');
  }
  paintConverter(false);
}
let clockKey = '';
function paintClock() {
  const n = document.getElementById('bc-n'); if (!n || !N.height) return;
  const b0 = N.blocks[0], tip = N.tipTime, mins = (Date.now() - tip) / 60e3;
  const blockUrl = (b) => `https://mempool.space/block/${b.id || b.height}`;
  // links are rebuilt only when the block data changes, so they stay clickable between ticks
  const key = `${N.height}|${b0?.id}|${b0?.pool}|${b0?.tx}|${N.blocks.length}`;
  if (key !== clockKey) {
    clockKey = key;
    n.textContent = '#' + num(N.height); n.href = blockUrl(b0 || { height: N.height }); n.title = 'Open this block on mempool.space';
    const pool = b0?.pool ? (b0.poolSlug ? ` · mined by <a href="https://mempool.space/mining/pool/${encodeURIComponent(b0.poolSlug)}" target="_blank" rel="noopener">${esc(b0.pool)}</a>` : ` · mined by ${esc(b0.pool)}`) : '';
    document.getElementById('bc-s').innerHTML = `found <b data-tick="tip"></b>${b0?.tx ? ` · ${num(b0.tx)} transactions` : ''}${pool}<span class="bc-bar"><i id="bc-bar"></i></span><span class="dim small" id="bc-gap"></span>`;
    document.getElementById('bc-blocks').innerHTML = N.blocks.slice(0, 10).map((b, i) => `<a href="${blockUrl(b)}" target="_blank" rel="noopener" title="Block #${num(b.height)}${b.tx ? ` · ${num(b.tx)} tx` : ''}${b.pool ? ` · ${esc(b.pool)}` : ''} · ${hhmm.format(new Date(b.t))} — open on mempool.space" style="opacity:${1 - i * 0.07}"><b>${num(b.height)}</b><small>${hhmm.format(new Date(b.t))}</small></a>`).join('');
  }
  const bar = document.getElementById('bc-bar'); if (bar) { bar.style.width = `${Math.min(100, (mins / 10) * 100).toFixed(0)}%`; bar.className = mins > 20 ? 'long' : ''; }
  const gap = document.getElementById('bc-gap'); if (gap) gap.textContent = mins > 20 ? 'a longer gap than the 10-minute average — normal from time to time' : 'blocks arrive every 10 minutes on average';
  const src = document.getElementById('bc-src');
  if (src) {
    const live = N.live && N.lastLive && Date.now() - N.lastLive < 90e3;
    src.innerHTML = live ? `<i class="fd ok"></i>Live · ${esc(N.tipSource || 'mempool.space')} · checked ${ago(N.lastLive)}` : `<i class="fd stale"></i>Snapshot · ${N.lastLive ? `last live success ${ago(N.lastLive)}` : 'no live connection yet'}${N.seeded ? ` · server snapshot from ${ago(N.seeded)}` : ''} · retrying every 20 s`;
  }
  document.querySelectorAll('[data-tick="tip"]').forEach((e) => { e.textContent = ago(tip); });
}
let cvSource = 'usd';
function paintConverter(fromInput) {
  const u = document.getElementById('cv-usd'), s = document.getElementById('cv-sats'), note = document.getElementById('cv-note'), p = price();
  if (!u || !s || !p) return;
  const parse = (v) => +String(v).replace(/[^0-9.]/g, '');
  if (cvSource === 'usd') { const v = parse(u.value); if (document.activeElement !== s) s.value = ok(v) ? Math.round((v / p) * 1e8).toLocaleString('en-US') : ''; }
  else { const v = parse(s.value); if (document.activeElement !== u) u.value = ok(v) ? ((v / 1e8) * p).toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''; }
  note.textContent = `$1 = ${num(1e8 / p)} sats · 1 BTC = 100,000,000 sats · at ${usd(p)}`;
}

// ---------- spot ETF table ----------
const sgnM = (v) => (!ok(v) ? '—' : v === 0 ? '$0' : `${v > 0 ? '+' : '−'}$${num(Math.abs(v), Math.abs(v) < 10 ? 1 : 0)}M`);
function etfFlowSums(sym) {
  const rows = S.etfFlows?.rows; if (!rows?.length) return null;
  if (sym && !rows.some((r) => r.funds && sym in r.funds)) return null; // fund not tracked by Farside
  const v = (r) => (sym ? r.funds?.[sym] ?? 0 : r.total ?? 0), sum = (n) => rows.slice(-n).reduce((a, r) => a + v(r), 0);
  return { d1: v(rows.at(-1)), d5: sum(5), d20: sum(20), all: sum(rows.length), n: rows.length, asOf: rows.at(-1).date, first: rows[0].date };
}
// issuer logo (stored in assets/etf/, fetched once from Google's favicon service) with a lettered
// badge underneath that shows if the image is missing
const ISSUER_SHORT = { BlackRock: 'BlackRock', 'ARK / 21Shares': 'ARK Invest', 'Invesco / Galaxy': 'Invesco / Galaxy', 'Franklin Templeton': 'Franklin Templeton' };
const etfFund = (f) => {
  const name = ISSUER_SHORT[f.issuer] || f.issuer, mono = name.replace(/[^A-Za-z ]/g, '').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return `<span class="ef"><span class="elogo" aria-hidden="true">${mono}<img src="assets/etf/${f.sym.toLowerCase()}.png" alt="" width="22" height="22" loading="lazy" onerror="this.remove()"></span><b class="ef-n" title="${esc(f.name)}">${esc(name)}${f.sym === 'BTC' ? ' <span class="dim">Mini</span>' : ''}</b><span class="ef-t">${esc(f.sym)}</span><a class="ef-x" href="https://finance.yahoo.com/quote/${encodeURIComponent(f.sym)}" target="_blank" rel="noopener" title="${esc(f.name)} on Yahoo Finance">↗</a>${f.sym === 'DEFI' ? '<span class="dim small"> not in Farside’s flow table</span>' : ''}</span>`;
};
const ETF_SORT = [['assets', 'Market value'], ['d1', '1-day flow'], ['d5', '5-day flow'], ['d20', '20-day flow'], ['all', 'Since start']];
// value used for sorting each column (flows come from the stored Farside history)
const ETF_KEY = { assets: (f) => f.assets, d1: (f) => f.fl.d1, d5: (f) => f.fl.d5, d20: (f) => f.fl.d20, all: (f) => f.fl.all, fee: (f) => f.feePct, vol: (f) => f.dollarVolume, ytd: (f) => f.ytdPct };
function etfTable() {
  const E = S.dash?.etfs?.funds; if (!E?.length) return null;
  const p = price(), tot = E.reduce((a, f) => a + (f.assets || 0), 0);
  const T = etfFlowSums(), n = T?.n || 0;
  if (S.etfSort === 'd20' && n < 20) S.etfSort = 'all';
  const key = ETF_KEY[S.etfSort] || ETF_KEY.assets, dir = S.etfDir === 'asc' ? 1 : -1;
  // funds without a value for the chosen column (e.g. DEFI has no Farside flows) always sort last
  const rows = E.map((f) => ({ ...f, fl: etfFlowSums(f.sym) || {} })).sort((a, b) => { const x = key(a), y = key(b); if (!ok(x) && !ok(y)) return (b.assets || 0) - (a.assets || 0); if (!ok(x)) return 1; if (!ok(y)) return -1; return (x - y) * dir; });
  const th = (k, label, title) => `<th class="r"><button type="button" class="th-sort${S.etfSort === k ? ' on' : ''}" data-etfsort="${k}" title="Sort by ${title || label}">${label}${S.etfSort === k ? (S.etfDir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>`;
  const flowCell = (v) => `<td class="r num ${cls(v)}">${ok(v) ? sgnM(v) : '<span class="dim">—</span>'}</td>`;
  const sortBtns = ETF_SORT.filter(([k]) => k !== 'd20' || n >= 20).map(([k, l]) => `<button type="button" data-etfsort="${k}" aria-pressed="${S.etfSort === k}">${k === 'all' ? `${n} days` : l}</button>`).join('');
  return { v: '', sub: `<div class="etf-tools"><span class="dim small">Rank by</span><div class="seg">${sortBtns}</div></div>
    <div class="etf-wrap"><table class="pmt etft"><thead><tr><th>#</th><th>Fund</th>${th('assets', 'Market value')}<th class="r">Share</th><th class="r">≈ BTC held</th>${th('d1', 'Flow 1d', '1-day flow')}${th('d5', '5d', '5-day flow')}${n >= 20 ? th('d20', '20d', '20-day flow') : ''}${th('all', n >= 20 ? `Since ${dShort(T?.first)}` : `${n}d`, `flows over the ${n} trading days stored since ${dShort(T?.first)}`)}${th('fee', 'Fee')}${th('vol', '$ volume', 'dollar trading volume')}${th('ytd', 'YTD')}</tr></thead><tbody>
    ${rows.map((f, i) => `<tr><td class="dim">${i + 1}</td><td>${etfFund(f)}</td><td class="r num">${big(f.assets)}${f.assetsSrc && f.assetsSrc !== 'Yahoo Finance' ? '<sup title="from stockanalysis.com">*</sup>' : ''}</td><td class="r num">${f.assets ? ((f.assets / tot) * 100).toFixed(1) + '%' : '—'}</td><td class="r num">${f.assets && p ? num(f.assets / p) : '—'}</td>${flowCell(f.fl.d1)}${flowCell(f.fl.d5)}${n >= 20 ? flowCell(f.fl.d20) : ''}${flowCell(f.fl.all)}<td class="r num">${ok(f.feePct) ? f.feePct.toFixed(2) + '%' : '—'}</td><td class="r num">${big(f.dollarVolume)}</td><td class="r num ${cls(f.ytdPct)}">${pct(f.ytdPct)}</td></tr>`).join('')}
    <tr class="tot"><td></td><td><span class="ef"><span class="elogo tot">Σ</span><b class="ef-n">Total · all ${E.length} funds</b></span></td><td class="r num"><b>${big(tot)}</b></td><td class="r num">100%</td><td class="r num"><b>${p ? num(tot / p) : '—'}</b></td>${flowCell(T?.d1)}${flowCell(T?.d5)}${n >= 20 ? flowCell(T?.d20) : ''}${flowCell(T?.all)}<td></td><td class="r num">${big(E.reduce((a, f) => a + (f.dollarVolume || 0), 0))}</td><td></td></tr></tbody></table></div>
    <p class="dim small etf-note">Market value is each fund’s reported net assets (Yahoo Finance${E.some((f) => f.assetsSrc === 'stockanalysis.com') ? '; * stockanalysis.com where Yahoo had none' : ''}) and can lag by a day or more. ≈ BTC held = market value ÷ live price, an estimate. Flows are Farside’s daily creations/redemptions in US$ millions${T ? `, latest ${dShort(T.asOf)}; history held: ${n} trading days since ${dShort(T.first)}${n < 20 ? `. A 20-day column appears automatically once 20 trading days are stored (${20 - n} to go): Farside’s full-history page blocks automated access, so history builds up one day at a time` : ''}` : ''}.</p>`, src: 'Yahoo Finance · Farside Investors', at: S.dash.etfs.fetchedAt, max: 2 * DAY };
}

// ---------- market posture ----------
// Fixed, published rules over data already on this page. Each signal scores +1, 0 or −1;
// the total picks the label: ≥ +3 Constructive, ≤ −2 Cautious, otherwise Neutral.
// Market read: the Market Intelligence Engine's synthesis (engine/intel.js), computed in
// app.js from all published data and handed over with setIntel().
function paintPosture() {
  const el = document.getElementById('d-posture'); if (!el) return;
  el.innerHTML = marketReadHtml(S.intel, S.info);
}
export function setIntel(I) { S.intel = I; paintPosture(); }
export const getDash = () => S.dash;

// ---------- latest block strip ----------
function blockStripHtml() {
  return `<div class="dcard bstrip" id="d-block"><div class="bs-main"><div class="bc-h"><span class="k">Latest block</span>${S.info('d_height')}</div><a class="bc-n num" id="bc-n" target="_blank" rel="noopener">—</a><div class="bc-s" id="bc-s">Connecting to mempool.space…</div></div><div class="bs-chips"><span class="k">Recent blocks</span><div class="bc-blocks" id="bc-blocks"></div></div><p class="bs-src" id="bc-src"></p></div>`;
}

// ---------- since your last visit ----------
const VISIT = 'btcintel-visit';
let prevVisit = null;
function readVisit() { try { prevVisit = JSON.parse(localStorage.getItem(VISIT) || 'null'); } catch { prevVisit = null; } }
function saveVisit() {
  const p = price(); if (!p) return;
  try { localStorage.setItem(VISIT, JSON.stringify({ t: Date.now(), price: p, height: N.height, fng: S.dash?.fng?.value ?? null, mvrv: S.a?.metrics.onchain?.mvrv ?? null, diff: N.hash?.difficulty ?? null })); } catch {}
}
function paintSince() {
  const el = document.getElementById('dh-since'); if (!el) return;
  const v = prevVisit;
  if (!v?.t || Date.now() - v.t < 30 * 60e3 || !price()) { el.hidden = true; return; }
  const chips = [];
  const pc = (price() / v.price - 1) * 100;
  chips.push(`Price <b class="${cls(pc)}">${pct(pc)}</b> <span class="dim">from ${usd(v.price)}</span>`);
  if (v.height && N.height > v.height) chips.push(`<b>${num(N.height - v.height)}</b> blocks mined`);
  if (ok(v.fng) && ok(S.dash?.fng?.value) && v.fng !== S.dash.fng.value) chips.push(`Fear & Greed <b>${v.fng} → ${S.dash.fng.value}</b>`);
  if (ok(v.diff) && N.hash?.difficulty && Math.abs(N.hash.difficulty / v.diff - 1) > 0.001) chips.push(`Difficulty <b class="${cls(N.hash.difficulty - v.diff)}">${pct((N.hash.difficulty / v.diff - 1) * 100, 2)}</b>`);
  if (ok(v.mvrv) && ok(S.a?.metrics.onchain?.mvrv) && Math.abs(S.a.metrics.onchain.mvrv - v.mvrv) >= 0.01) chips.push(`MVRV <b>${num(v.mvrv, 2)} → ${num(S.a.metrics.onchain.mvrv, 2)}</b>`);
  el.innerHTML = `<span class="k">Since your last visit <span class="dim">(${ago(v.t).replace(' ago', '')} ago)</span>${S.info('d_lastvisit')}</span>${chips.map((c) => `<span class="schip">${c}</span>`).join('')}`;
  el.hidden = false;
}

// ---------- page ----------
const DEEPER = [
  ['#overview', 'Intelligence', 'Daily forces, regime, scenarios and what changed'],
  ['#analysis/regime', 'Market regime', 'Regime, on-chain positioning and historical context on Analysis'],
  ['#analysis/liquidity', 'Liquidity Detail', 'Order-book depth, liquidation map and options levels'],
  ['#analysis/macro-liquidity', 'Macro & Liquidity', 'Central banks, M2, rates, dollar, financial conditions'],
  ['#reports', 'Reports', 'The 07:00 morning report and the archive'],
  ['https://mempool.space', 'mempool.space ↗', 'Blocks, fees and mining, live'],
  ['https://farside.co.uk/bitcoin-etf-flow-all-data/', 'Farside ETF flows ↗', 'Daily flows per fund'],
  ['https://charts.coinmetrics.io/crypto-data/', 'Coin Metrics charts ↗', 'Free on-chain network data'],
  ['https://www.coingecko.com/en/treasuries/bitcoin', 'Company treasuries ↗', 'Full list of public holders'],
];
export function dashTab({ a, pi, dash, info }) {
  S.a = a; S.pi = pi; S.dash = dash; S.info = (k) => info(k).s;
  return `<div class="dtop">
    <div class="dcol dleft">${heroHtml()}${priceCardHtml(S.info)}${movesHtml()}</div>
    <aside class="dcol dright"><section class="dcard posture" id="d-posture" aria-label="Market read"></section>${fngHtml()}${newsHtml()}</aside>
  </div>
  ${pmHtml()}
  ${GROUP_ORDER.map((id) => GROUPS.find((g) => g.id === id)).map((g) => `${g.id === FUNDAMENTALS_FROM ? '<div class="gdivider"><span>Network fundamentals</span><p>Chain, fee, mining and supply data. These describe the network itself rather than market positioning.</p></div>' : ''}<section class="mgroup" id="g-${g.id}"><h2>${g.title}</h2>${g.note ? `<p class="gintro">${g.note}</p>` : ''}${g.id === 'network' ? blockStripHtml() : ''}<div class="dkcards">${g.cards.map(cardShell).join('')}</div><p class="gnote" hidden></p></section>`).join('')}
  ${distHtml()}
  <section class="mgroup" id="g-tools"><h2>Sats converter${S.info('d_converter')}</h2><div class="dcard conv tools-conv">
    <div class="conv-row"><label><span>USD</span><input type="text" inputmode="decimal" id="cv-usd" value="100" autocomplete="off"></label><span class="conv-eq">=</span><label><span>sats</span><input type="text" inputmode="numeric" id="cv-sats" autocomplete="off"></label></div>
    <div class="conv-s dim" id="cv-note"></div><p class="tr-n">For a full backtest of regular purchases, open the <a href="#dca">DCA backtest</a>.</p></div></section>
  <section class="deeper"><h2>Go deeper</h2><div class="dlinks">${DEEPER.map(([u, t, d]) => `<a href="${u}"${u.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}><b>${t}</b><span>${d}</span></a>`).join('')}</div></section>
  <details class="about"><summary>About this dashboard</summary>
    <p><b>All data on this page comes from free public sources. We do not paywall any of these metrics. Some advanced on-chain or entity-adjusted metrics require paid providers and are therefore not shown here.</b></p>
    <p>Each card shows its source and when the figure was last updated. The dot is green when the figure is within its normal update interval, amber when it is older than that, and grey when it is unavailable. Nothing is filled in or estimated when a source fails; the last good value is kept and marked.</p>
    <h3>Not shown, and why</h3>
    <ul>
      <li><b>Exact ETF bitcoin holdings</b> — issuers publish them separately; the dashboard estimates holdings from each fund’s reported net assets (Yahoo Finance) and the live price.</li>
      <li><b>Most entity-adjusted and holder-cohort metrics</b> (long- vs short-term holder supply, entity-adjusted SOPR, cohort MVRV bands) — paid providers only. Short- and long-term holder realised prices are shown from BGeometrics’ free tier, which runs about a week behind.</li>
      <li><b>NVT, supply active in the last year, USD fee averages</b> — not in Coin Metrics’ free tier.</li>
      <li><b>Market-wide liquidation totals</b> — paid aggregators only. We show a one-venue sample from the last server run and a live stream of large liquidations from OKX and Bybit.</li>
      <li><b>Exchange-specific whale tracking</b> — attributing on-chain transactions to named entities requires paid labelling. Large on-chain transactions are shown unlabelled.</li>
      <li><b>Lightning Network statistics</b> — shown only while mempool.space’s free statistics are current.</li>
    </ul>
    <h3>Sources</h3>
    <p class="small muted">Live price: Coinbase, Binance (USDT, ≈USD), CoinGecko, Kraken · Network, fees, mining: mempool.space · Large trades: Coinbase, Binance, Kraken public WebSockets · Liquidations: OKX, Bybit public WebSockets · On-chain transactions: blockchain.info public WebSocket · Market cap, dominance, ATH, treasuries, volume: CoinGecko · On-chain valuation and exchange flows: Coin Metrics Community API, BGeometrics free tier · Stablecoins: DefiLlama · Derivatives: OKX, Deribit, Hyperliquid, CoinGecko · ETF flows: Farside Investors · Fear &amp; Greed: alternative.me · Hashprice and fee share: CloudMineCrypto · Pool shares: mempool.space · Network activity: Coin Metrics Community · Holder-cohort realised prices: BGeometrics free tier (fetched at most once a day) · News: CoinDesk, Cointelegraph, Bitcoin Magazine, Decrypt, The Block, Federal Reserve (RSS) · Price history for the Pi Cycle chart: Coin Metrics.</p>
    <p class="small muted">Market-structure research, not investment advice. No price targets or probabilities.</p>
  </details>
  <div class="toast" id="d-toast" role="status" aria-live="polite" hidden></div>`;
}

// wiring that must run after every render; live feeds start only once per page load
let started = false, tickT = null, cgT = null;
document.addEventListener('click', (e) => {
  if (e.target.closest?.('[data-treas-more]')) { S.treasAll = !S.treasAll; paintCards(); return; }
  const es = e.target.closest?.('[data-etfsort]'); if (es) { const k = es.dataset.etfsort; S.etfDir = S.etfSort === k && S.etfDir !== 'asc' ? 'asc' : 'desc'; S.etfSort = k; paintCards(); return; }
  const pmb = e.target.closest?.('[data-pm]');
  if (pmb) { S.pmIdx = +pmb.dataset.pm; S.pmAll = false; document.querySelectorAll('[data-pm]').forEach((x) => x.setAttribute('aria-pressed', String(x === pmb))); paintPm(); return; }
  if (e.target.closest?.('[data-pm-all]')) { S.pmAll = !S.pmAll; paintPm(); return; }
  const t = e.target.closest?.('[data-tone]');
  if (t) {
    const k = t.dataset.tone;
    S.newsTone = k === 'all' || S.newsTone === k ? 'all' : k;
    S.newsAll = false;
    paintNews();
    if (t.closest('.dkcard')) { paintCards(); document.getElementById('d-news')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
});
export function mountDash({ dash, getLive }) {
  S.dash = dash;
  S.live = getLive();
  readVisitOnce();
  document.querySelectorAll('[data-nf]').forEach((b) => b.addEventListener('click', () => { S.newsFilter = b.dataset.nf; document.querySelectorAll('[data-nf]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.nf === S.newsFilter))); paintNews(); }));
  document.querySelectorAll('[data-mf]').forEach((b) => b.addEventListener('click', () => { S.moveFilter = b.dataset.mf; document.querySelectorAll('[data-mf]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.mf === S.moveFilter))); paintMoves(); }));
  const u = document.getElementById('cv-usd'), s = document.getElementById('cv-sats');
  u?.addEventListener('input', () => { cvSource = 'usd'; paintConverter(true); });
  s?.addEventListener('input', () => { cvSource = 'sats'; paintConverter(true); });
  seedNetwork(dash?.network);
  paintNews(); paintMoves(); paintMoveStatus(); paintHero(); paintCards(); paintClock(); paintSince(); paintRead(); paintPm(); paintDist(); paintPosture();
  if (started) return;
  started = true;
  loadEtfFlows();
  startNetwork({ onUpdate: () => { paintCards(); paintClock(); paintHero(); paintSince(); }, onBlock: toastBlock });
  startMoves({ onEvent: (list) => { S.moves = list; paintMoves(); }, onStatus: (st) => { S.moveStatus = st; paintMoveStatus(); }, priceNow: price });
  fetchCg(); cgT = setInterval(fetchCg, 5 * 60e3);
  tickT = setInterval(() => { if (!document.hidden) paintClock(); }, 1000);
  setInterval(() => { if (!document.hidden) paintCards(); }, 30e3);
  addEventListener('pagehide', saveVisit);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveVisit(); });
  // the 15-minute feed: re-read data/dash.json every 10 minutes
  setInterval(async () => { try { const r = await fetch('data/dash.json', { cache: 'no-store' }); if (r.ok) { S.dash = await r.json(); refreshSide(); paintCards(); } } catch {} }, 10 * 60e3);
}
let visitRead = false;
function readVisitOnce() { if (!visitRead) { visitRead = true; readVisit(); } }
function refreshSide() {
  paintRead(); paintPm(); paintDist(); paintPosture();
  const f = document.querySelector('.dcard.fng'); if (f) f.outerHTML = fngHtml();
  const n = document.getElementById('d-news'); if (n) { n.outerHTML = newsHtml(); document.querySelectorAll('[data-nf]').forEach((b) => b.addEventListener('click', () => { S.newsFilter = b.dataset.nf; document.querySelectorAll('[data-nf]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.nf === S.newsFilter))); paintNews(); })); paintNews(); }
}
let readT = 0;
export function dashLive(live) { S.live = live; paintHero(); paintCards(); paintSince(); if (Date.now() - readT > 60e3) { readT = Date.now(); paintRead(); paintPosture(); } }
// Automatic refresh: network data, CoinGecko market stats and the 15-minute feed file, now
async function loadEtfFlows() { try { const r = await fetch('data/etf_flows.json', { cache: 'no-store' }); if (r.ok) { S.etfFlows = await r.json(); paintCards(); } } catch {} }
export async function refreshDash() {
  loadEtfFlows();
  const feed = fetch('data/dash.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) { S.dash = j; refreshSide(); paintCards(); } }).catch(() => {});
  await Promise.allSettled([refreshNetwork(), fetchCg(true), feed]);
  paintHero(); paintCards(); paintClock(); paintRead();
}
async function fetchCg(force) {
  if (!force && document.hidden && S.cg) return;
  try {
    const [c, g] = await Promise.all([
      fetch('https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false').then((r) => (r.ok ? r.json() : null)),
      fetch('https://api.coingecko.com/api/v3/global').then((r) => (r.ok ? r.json() : null)),
    ]);
    if (c?.market_data) S.cg = c.market_data;
    if (g?.data) S.glob = g.data;
    if (c || g) S.cgAt = Date.now();
    paintHero(); paintCards();
  } catch {}
}
let toastT = null;
function toastBlock(b) {
  const t = document.getElementById('d-toast'); if (!t || document.hidden) return;
  t.innerHTML = `<b>New block #${num(b.height)}</b> · ${num(b.tx)} transactions${b.pool ? ` · ${esc(b.pool)}` : ''}${ok(b.fees) ? ` · ${(b.fees / 1e8).toFixed(3)} BTC fees` : ''}`;
  t.hidden = false; t.classList.remove('out');
  clearTimeout(toastT); toastT = setTimeout(() => { t.classList.add('out'); setTimeout(() => { t.hidden = true; }, 400); }, 7000);
}
