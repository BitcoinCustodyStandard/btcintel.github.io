// BTC Dashboard — the landing tab. Everything here comes from free public sources:
// live tickers (live.js), mempool.space (network.js), exchange WebSockets (moves.js),
// CoinGecko in the browser, and the server files data/dash.json (15-min feed),
// data/latest.json (agent snapshot) and data/pi_cycle.json. Values that cannot be
// obtained free are shown as such, never estimated.

import { startNetwork, seedNetwork, N, issuedSupply, subsidyBtc, nextHalving, hashprice, HALVING_INTERVAL } from './network.js';
import { startMoves, MIN_TRADE, MIN_LIQ, MIN_TX_BTC } from './moves.js';
import { piCardHtml } from './pichart.js';

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
const S = { a: null, dash: null, pi: null, live: null, cg: null, cgAt: null, glob: null, moves: [], moveStatus: {}, newsFilter: 'all', newsAll: false, moveFilter: 'all', info: () => '' };
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
const NA = (why) => ({ na: true, v: 'Not available from free sources', sub: why });
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
  { id: 'network', title: 'Network', cards: [
    { k: 'height', label: 'Block height', info: 'd_height', get: () => N.height ? { v: num(N.height), sub: `last block <b data-tick="tip">${ago(N.tipTime)}</b>${N.blocks[0]?.pool ? ` · ${esc(N.blocks[0].pool)}` : ''}`, src: N.live ? `mempool.space · ${N.ws === 'live' ? 'live' : 'polling'}` : 'mempool.space snapshot', at: N.at, max: 5 * 60e3 } : null },
    { k: 'hash', label: 'Hash rate (3-day estimate)', info: 'd_hashrate', get: () => N.hash ? { v: `${num(N.hash.current / 1e18)} EH/s`, sub: ok(S.a?.metrics.onchain?.hashCh30d) ? `<span class="${cls(S.a.metrics.onchain.hashCh30d)}">${pct(S.a.metrics.onchain.hashCh30d)}</span> over 30 days` : '', src: mpSrc(), at: N.at, max: 30 * 60e3 } : null },
    { k: 'diff', label: 'Difficulty', info: 'd_difficulty', get: () => N.hash ? { v: `${(N.hash.difficulty / 1e12).toFixed(1)} T`, sub: N.da ? `last adjustment <span class="${cls(N.da.previousRetarget)}">${pct(N.da.previousRetarget, 2)}</span>` : '', src: mpSrc(), at: N.at, max: 30 * 60e3 } : null },
    { k: 'nextadj', label: 'Next difficulty adjustment', info: 'd_nextadj', get: () => N.da ? { v: `<span class="${cls(N.da.difficultyChange)}">${pct(N.da.difficultyChange, 2)}</span> <small>est.</small>`, sub: `in ${num(N.da.remainingBlocks)} blocks · ~${dShort(N.da.estimatedRetargetDate)}`, src: mpSrc(), at: N.at, max: 30 * 60e3 } : null },
    { k: 'blocktime', label: 'Average block time', info: 'd_blocktime', get: () => N.da ? { v: `${(N.da.timeAvg / 60e3).toFixed(1)} min`, sub: `this difficulty period · target 10 min · ${N.da.progressPercent.toFixed(0)}% through`, src: mpSrc(), at: N.at, max: 30 * 60e3 } : null },
    { k: 'ln', label: 'Lightning capacity', info: 'd_lightning', get: () => { const L = S.dash?.lightning; if (!L?.asOf) return NA('Lightning statistics could not be retrieved.'); if (Date.now() - Date.parse(L.asOf) > 14 * DAY) return NA(`mempool.space’s free Lightning statistics stopped updating on ${dShort(L.asOf)}; older figures are not shown.`); return { v: btcF(L.capacityBtc), sub: `${num(L.channels)} channels · ${num(L.nodes)} nodes`, src: L.source, at: L.asOf, max: 3 * DAY }; } },
  ] },
  { id: 'fees', title: 'Fees & mempool', cards: [
    { k: 'fees', label: 'Fee to confirm in ~10 min', info: 'd_fees', get: () => N.fees ? { v: `${N.fees.fastestFee} sat/vB`, sub: `30 min ${N.fees.halfHourFee} · 1 h ${N.fees.hourFee} · economy ${N.fees.economyFee}`, src: mpSrc(), at: N.at, max: 10 * 60e3 } : null },
    { k: 'txcost', label: 'Simple transaction cost', info: 'd_txcost', get: () => N.fees && price() ? { v: usd((140 * N.fees.halfHourFee * price()) / 1e8, 2), sub: `≈140 vB at ${N.fees.halfHourFee} sat/vB (30-min rate)`, src: mpSrc(' · live price'), at: N.at, max: 10 * 60e3 } : null },
    { k: 'mempool', label: 'Mempool backlog', info: 'd_mempool', get: () => N.mempool ? { v: `${num(N.mempool.count)} tx`, sub: `${(N.mempool.vsize / 1e6).toFixed(1)} MvB ≈ ${Math.max(1, Math.ceil(N.mempool.vsize / 1e6))} blocks of transactions waiting`, src: mpSrc(), at: N.at, max: 10 * 60e3 } : null },
    { k: 'feeshare', label: 'Fees share of miner revenue', info: 'd_feeshare', get: () => N.reward ? { v: pct((N.reward.fees / N.reward.total) * 100, 2, false), sub: `${btcF(N.reward.fees / 1e8, 2)} in fees over the last 144 blocks`, src: mpSrc(' reward stats'), at: N.at, max: 60 * 60e3 } : null },
  ] },
  { id: 'mining', title: 'Mining', cards: [
    { k: 'hashprice', label: 'Hashprice', info: 'd_hashprice', get: () => { const hp = N.reward && N.hash ? hashprice(N.reward.total / 1e8 / (N.reward.end - N.reward.start + 1), price(), N.hash.difficulty) : null; return ok(hp) ? { v: `$${hp.toFixed(2)}`, sub: 'per PH/s per day · last 144 blocks’ rewards ÷ difficulty', src: 'Computed from mempool.space', at: N.at, max: 60 * 60e3 } : null; } },
    { k: 'subsidy', label: 'Block reward', info: 'd_halving', get: () => N.height ? { v: `${subsidyBtc(N.height)} BTC`, sub: N.reward ? `+ ${(N.reward.fees / 1e8 / (N.reward.end - N.reward.start + 1)).toFixed(3)} BTC fees per block (last 144)` : 'new coins per block', src: 'Protocol schedule · mempool.space', at: N.at, max: 60 * 60e3 } : null },
    cycleCard('puell', 'Puell Multiple', 'puell'),
    cycleCard('hashribbons', 'Hash Ribbons', 'hashribbons'),
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
    { k: 'stables', label: 'Stablecoin supply', info: 'stables', get: () => { const o = S.a?.metrics.onchain; return ok(o?.stables) ? { v: big(o.stables), sub: `30d <span class="${cls(o.stables30d)}">${o.stables30d >= 0 ? '+' : '−'}${big(Math.abs(o.stables30d))}</span> · 7d ${o.stables7d >= 0 ? '+' : '−'}${big(Math.abs(o.stables7d))}`, src: 'DefiLlama', at: srcQ('defillama_stables')?.asOf, max: 3 * DAY } : null; } },
    { k: 'exflow', wide: true, label: 'Exchange net flow', info: 'd_exflow', get: () => {
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
  ] },
  { id: 'holders', title: 'ETFs & treasuries', cards: [
    { k: 'etf', label: 'Spot ETF net flow', info: 'd_etf', get: () => { const e = S.a?.metrics.etf; return ok(e?.last) ? { v: `<span class="${cls(e.last)}">${e.last >= 0 ? '+' : '−'}$${num(Math.abs(e.last), 1)}M</span>`, sub: `${dShort(e.lastDate)} · 5 days ${e.s5 >= 0 ? '+' : '−'}$${num(Math.abs(e.s5))}M · 20 days ${e.s20 >= 0 ? '+' : '−'}$${num(Math.abs(e.s20))}M`, src: 'Farside Investors', at: e.lastDate, max: 4 * DAY } : null; } },
    { k: 'etfhold', label: 'Total ETF holdings', info: 'd_etf', get: () => NA('No free source publishes reliable daily holdings for all US spot ETFs; flows are shown instead.') },
    { k: 'treas', wide: true, label: 'Public company treasuries', info: 'd_treasury', get: () => {
      const T = S.dash?.treasuries; if (!ok(T?.totalBtc)) return null;
      return { v: btcF(T.totalBtc), sub: `${T.companies} companies${supplyNow() ? ` · ${((T.totalBtc / supplyNow()) * 100).toFixed(2)}% of supply` : ''} · ${big(T.totalBtc * price())}<ol class="tlist">${T.top.map((c) => `<li><span>${esc(c.name)} <span class="dim">${esc(c.symbol)}</span></span><b class="num">${num(c.btc)}</b></li>`).join('')}</ol>`, src: T.source, at: T.fetchedAt, max: 2 * DAY };
    } },
  ] },
];
function cycleCard(id, label, info) {
  return { k: 'cy-' + id, label, info, get: () => { const x = cyM(id); if (!x) return null; if (x.value === null) return NA(x.unavailableWhy || 'Not available from free sources.'); return { v: esc(x.display), sub: `${x.zone ? `<b class="z-${x.zone.tone || 'neu'}">${esc(x.zone.label)}</b> · ` : ''}${esc(String(x.meaning || '').split(/(?<!\d)\.(?!\d)| — /)[0])}`, src: x.source, at: x.asOf, max: 4 * DAY }; } };
}
function flowBars(net) {
  if (net.length < 5) return '';
  const W = 300, Hh = 46, m = Math.max(...net.map((r) => Math.abs(r[1]))) || 1, bw = W / net.length;
  return `<svg class="fbars" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" role="img" aria-label="Daily exchange net flow, last ${net.length} days">${net.map(([d, v], i) => { const hh = (Math.abs(v) / m) * (Hh / 2 - 1); return `<rect class="${v > 0 ? 'in' : 'out'}" x="${(i * bw + 0.5).toFixed(1)}" width="${Math.max(0.8, bw - 1).toFixed(1)}" y="${(v > 0 ? Hh / 2 - hh : Hh / 2).toFixed(1)}" height="${Math.max(0.5, hh).toFixed(1)}"><title>${d}: ${v > 0 ? '+' : '−'}${num(Math.abs(v))} BTC</title></rect>`; }).join('')}<line x1="0" x2="${W}" y1="${Hh / 2}" y2="${Hh / 2}"/></svg><span class="fleg"><i class="in"></i>into exchanges <i class="out"></i>out of exchanges · ${net.length} days</span>`;
}
const cardShell = (c) => `<div class="dkcard${c.wide ? ' wide' : ''}" data-k="${c.k}"><div class="mc-h"><span class="mc-l">${esc(c.label)}</span>${S.info(c.info)}</div><div class="mc-v num"></div><div class="mc-s"></div><div class="mc-m"><i class="fd"></i><span></span></div></div>`;
const freshLabel = { ok: 'up to date', stale: 'older than its usual update interval', na: 'not available' };
export function paintCards(root = document) {
  for (const g of GROUPS) for (const c of g.cards) {
    const el = root.querySelector(`.dkcard[data-k="${c.k}"]`);
    if (!el) continue;
    let r; try { r = c.get(); } catch { r = null; }
    if (!r) r = { na: true, v: 'Waiting for data…', sub: '', src: '' };
    const f = r.na ? 'na' : fresh(r.at, r.max ?? DAY);
    el.classList.toggle('na', !!r.na);
    el.querySelector('.mc-v').innerHTML = r.v;
    el.querySelector('.mc-s').innerHTML = r.sub || '';
    const m = el.querySelector('.mc-m');
    m.querySelector('.fd').className = 'fd ' + f;
    m.title = `Freshness: ${freshLabel[f]}`;
    m.querySelector('span').textContent = r.src ? `${r.src}${r.at ? ' · ' + (typeof r.at === 'number' || r.at.length > 10 ? (Date.now() - new Date(r.at) < DAY ? hhmm.format(new Date(r.at)) : dShort(r.at)) : dShort(r.at)) : ''}` : '';
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
  const items = (S.dash?.news?.items || []).filter((i) => (S.newsFilter === 'all' ? true : S.newsFilter === 'macro' ? i.macro : !i.macro));
  const shown = S.newsAll ? items.slice(0, 60) : items.slice(0, 14);
  const icon = { bullish: '▲', bearish: '▼', neutral: '•' };
  list.innerHTML = shown.length ? shown.map((i) => `<li><span class="ntag ${i.tag}" title="${i.macro ? 'Central-bank release — not tagged' : i.words.length ? `Keyword tag “${i.tag}” from: ${esc(i.words.join(', '))}` : 'No tag keywords found'}">${i.macro ? 'FED' : icon[i.tag]}</span><div><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a><span class="nmeta">${esc(i.source)} · ${relShort(Date.parse(i.t))}</span></div></li>`).join('') + (items.length > 14 ? `<li class="nmore"><button type="button" id="d-nmore">${S.newsAll ? 'Show fewer' : `Show ${Math.min(60, items.length) - 14} more`}</button></li>` : '') : '<li class="muted small">No headlines in this filter.</li>';
  const day = (S.dash?.news?.items || []).filter((i) => !i.macro && Date.now() - Date.parse(i.t) < DAY), c = { bullish: 0, bearish: 0, neutral: 0 };
  day.forEach((i) => c[i.tag]++);
  const tal = document.getElementById('d-ntally');
  if (tal) tal.innerHTML = day.length ? `<span>Last 24h, ${day.length} headlines:</span><span class="up">▲ ${c.bullish} bullish</span><span class="down">▼ ${c.bearish} bearish</span><span class="dim">• ${c.neutral} neutral</span><span class="tbar"><i class="up" style="width:${(c.bullish / day.length) * 100}%"></i><i class="down" style="width:${(c.bearish / day.length) * 100}%"></i></span>` : '';
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
  }).join('') : `<tr><td colspan="5" class="muted small empty">Watching… nothing above the thresholds yet in this browser. Large prints are irregular; this fills as they happen.</td></tr>`;
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

// ---------- hero ----------
function heroHtml() {
  return `<section class="dhero" aria-label="Bitcoin right now">
    <div class="dh-main">
      <div class="dh-top"><h1>Bitcoin right now</h1><span class="livebadge snap" data-live="badge"><i></i><span>Connecting to live price…</span></span></div>
      <div class="dh-px"><span class="px num" data-live="px">${usd(price())}</span><span data-live="ch"></span>${S.info('d_price')}</div>
      <dl class="dh-stats" id="dh-stats"></dl>
      <div class="dh-since" id="dh-since" hidden></div>
    </div>
    <div class="dh-side">
      <div class="bclock"><div class="bc-h"><span class="k">Latest block</span>${S.info('d_height')}</div><div class="bc-n num" id="bc-n">—</div><div class="bc-s" id="bc-s">Connecting to mempool.space…</div><div class="bc-blocks" id="bc-blocks" aria-hidden="true"></div></div>
      <div class="conv"><div class="bc-h"><span class="k">Sats converter</span>${S.info('d_converter')}</div>
        <div class="conv-row"><label><span>USD</span><input type="text" inputmode="decimal" id="cv-usd" value="100" autocomplete="off"></label><span class="conv-eq">=</span><label><span>sats</span><input type="text" inputmode="numeric" id="cv-sats" autocomplete="off"></label></div>
        <div class="conv-s dim" id="cv-note"></div></div>
    </div>
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
function paintClock() {
  const n = document.getElementById('bc-n'); if (!n || !N.height) return;
  n.textContent = '#' + num(N.height);
  const tip = N.tipTime, mins = (Date.now() - tip) / 60e3;
  document.getElementById('bc-s').innerHTML = `found <b>${ago(tip)}</b>${N.blocks[0]?.tx ? ` · ${num(N.blocks[0].tx)} tx` : ''}${N.blocks[0]?.pool ? ` · ${esc(N.blocks[0].pool)}` : ''}<span class="bc-bar"><i style="width:${Math.min(100, (mins / 10) * 100).toFixed(0)}%" class="${mins > 20 ? 'long' : ''}"></i></span><span class="dim small">${!N.live ? 'server snapshot · live feed unreachable' : N.ws === 'live' ? 'live' : 'polling'} · 10-min target</span>`;
  document.getElementById('bc-blocks').innerHTML = N.blocks.slice(0, 8).map((b, i) => `<span title="#${b.height} · ${num(b.tx)} tx · ${hhmm.format(new Date(b.t))}" style="opacity:${1 - i * 0.1}">${String(b.height).slice(-3)}</span>`).join('');
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
  ['#cycle', 'On-chain cycle', 'MVRV, NUPL, SOPR and the cycle composite in depth'],
  ['#liquidity', 'Liquidity detail', 'Order-book depth, liquidation map and options levels'],
  ['#report', 'Morning report', 'The full written 07:00 report'],
  ['https://mempool.space', 'mempool.space ↗', 'Blocks, fees and mining, live'],
  ['https://farside.co.uk/bitcoin-etf-flow-all-data/', 'Farside ETF flows ↗', 'Daily flows per fund'],
  ['https://charts.coinmetrics.io/crypto-data/', 'Coin Metrics charts ↗', 'Free on-chain network data'],
  ['https://www.coingecko.com/en/treasuries/bitcoin', 'Company treasuries ↗', 'Full list of public holders'],
];
export function dashTab({ a, pi, dash, info }) {
  S.a = a; S.pi = pi; S.dash = dash; S.info = (k) => info(k).s;
  return `${heroHtml()}
  <div class="dgrid">
    <div class="dmain">${piCardHtml(pi, S.info('picycle'))}${movesHtml()}</div>
    <aside class="dside">${fngHtml()}${newsHtml()}</aside>
  </div>
  ${GROUPS.map((g) => `<section class="mgroup" id="g-${g.id}"><h2>${g.title}</h2><div class="dkcards">${g.cards.map(cardShell).join('')}</div></section>`).join('')}
  <section class="deeper"><h2>Go deeper</h2><div class="dlinks">${DEEPER.map(([u, t, d]) => `<a href="${u}"${u.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}><b>${t}</b><span>${d}</span></a>`).join('')}</div></section>
  <details class="about"><summary>About this dashboard</summary>
    <p><b>All data on this page comes from free public sources. We do not paywall any of these metrics. Some advanced on-chain or entity-adjusted metrics require paid providers and are therefore not shown here.</b></p>
    <p>Each card shows its source and when the figure was last updated. The dot is green when the figure is within its normal update interval, amber when it is older than that, and grey when it is unavailable. Nothing is filled in or estimated when a source fails; the last good value is kept and marked.</p>
    <h3>Not shown, and why</h3>
    <ul>
      <li><b>Total spot ETF holdings</b> — no free source publishes reliable daily holdings for every fund. Daily flows (Farside) are shown instead.</li>
      <li><b>Entity-adjusted and holder-cohort metrics</b> (long- vs short-term holder supply, entity-adjusted SOPR, realised cap by cohort) — available only from paid on-chain providers.</li>
      <li><b>Market-wide liquidation totals</b> — paid aggregators only. We show a one-venue sample from the last server run and a live stream of large liquidations from OKX and Bybit.</li>
      <li><b>Exchange-specific whale tracking</b> — attributing on-chain transactions to named entities requires paid labelling. Large on-chain transactions are shown unlabelled.</li>
      <li><b>Lightning Network statistics</b> — shown only while mempool.space’s free statistics are current.</li>
    </ul>
    <h3>Sources</h3>
    <p class="small muted">Live price: Coinbase, Binance (USDT, ≈USD), CoinGecko, Kraken · Network, fees, mining: mempool.space · Large trades: Coinbase, Binance, Kraken public WebSockets · Liquidations: OKX, Bybit public WebSockets · On-chain transactions: blockchain.info public WebSocket · Market cap, dominance, ATH, treasuries, volume: CoinGecko · On-chain valuation and exchange flows: Coin Metrics Community API, BGeometrics free tier · Stablecoins: DefiLlama · Derivatives: OKX, Deribit, Hyperliquid, CoinGecko · ETF flows: Farside Investors · Fear &amp; Greed: alternative.me · News: CoinDesk, Cointelegraph, Bitcoin Magazine, Decrypt, The Block, Federal Reserve (RSS) · Price history for the Pi Cycle chart: Coin Metrics.</p>
    <p class="small muted">Market-structure research, not investment advice. No price targets or probabilities.</p>
  </details>
  <div class="toast" id="d-toast" role="status" aria-live="polite" hidden></div>`;
}

// wiring that must run after every render; live feeds start only once per page load
let started = false, tickT = null, cgT = null;
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
  paintNews(); paintMoves(); paintMoveStatus(); paintHero(); paintCards(); paintClock(); paintSince();
  if (started) return;
  started = true;
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
  const f = document.querySelector('.dcard.fng'); if (f) f.outerHTML = fngHtml();
  const n = document.getElementById('d-news'); if (n) { n.outerHTML = newsHtml(); document.querySelectorAll('[data-nf]').forEach((b) => b.addEventListener('click', () => { S.newsFilter = b.dataset.nf; document.querySelectorAll('[data-nf]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.nf === S.newsFilter))); paintNews(); })); paintNews(); }
}
export function dashLive(live) { S.live = live; paintHero(); paintCards(); paintSince(); }
async function fetchCg() {
  if (document.hidden && S.cg) return;
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
