// Analysis engine: turns a snapshot (observed data) + the daily timeseries
// (persisted history) into explained market structure.
//
// Conventions
//  - `obs` fields are observed (with source + timestamp).
//  - `interp` / `mechanism` fields are interpretation and are labelled as such.
//  - Thresholds are explicit constants so every classification is auditable.
//  - When an input is missing, the output says so rather than defaulting.

import {
  mean, std, sum, pct, percentileRank, pearson, alignedReturns, alignedReturnsVsDiff, beta, realizedVol,
  valueAt, lastPoint, shiftDate, isoDate, fmtUsd, fmtUsdSigned, ordinal, fmtPrice, fmtPct, fmtNum, fmtK, clamp, DAY,
} from './util.js';
import { UNAVAILABLE } from './reference.js';
import { computeCycle, cycleWatch } from './cycle.js';

export const ENGINE_VERSION = '1.0.0';

export const T = {
  fundingHotAnn: 15, // % annualized: leverage paying up
  fundingExtremeAnn: 30,
  fundingNegAnn: -2,
  oi7dBuild: 8, // % aggregate OI growth in 7 days counts as a leverage build
  oi7dFlush: -8,
  oi1dBuild: 3,
  oi1dFlush: -4,
  etf5dStrong: 750, // US$m
  etf20dStrong: 2000,
  depthDeteriorate7d: -15, // % change of ±1% depth vs 7 days ago
  corrHigh: 0.5,
  corrLow: 0.15,
  move1d: 3, move7d: 7, cascade1d: 6, cascade7d: 12,
};

const SRC = (snap, id) => {
  const s = snap.sources?.[id];
  return s ? { source: s.name, url: s.url, asOf: s.asOf || s.fetchedAt, frequency: s.frequency, status: s.status } : { source: id, status: 'unavailable' };
};

// ---------------------------------------------------------------------------
// METRICS
export function computeMetrics(snap, rows) {
  const m = { asOf: snap.collectedAt };
  const today = isoDate(snap.collectedAt);
  const prevRows = (rows || []).filter((r) => r.date < today);
  const rowAt = (daysAgo) => {
    const target = shiftDate(today, -daysAgo);
    let best = null;
    for (const r of prevRows) if (r.date <= target) best = r;
    return best;
  };
  m.prev1 = prevRows.at(-1) || null;
  m.prev7 = rowAt(7);
  m.prev30 = rowAt(30);

  // ---- price
  const ph = snap.priceHistory || [];
  const closes = ph.map((r) => r[1]);
  const spot = snap.price?.spot ?? closes.at(-1) ?? null;
  const closeAgo = (n) => (ph.length > n ? ph[ph.length - 1 - n][1] : null);
  m.price = {
    spot,
    ch24h: snap.price?.change24h ?? pct(spot, closeAgo(1)),
    ch7d: snap.price?.change7d ?? pct(spot, closeAgo(7)),
    ch30d: snap.price?.change30d ?? pct(spot, closeAgo(30)),
    marketCap: snap.price?.marketCap ?? (spot && snap.price?.circulatingSupply ? spot * snap.price.circulatingSupply : null),
    high365: closes.length ? Math.max(...closes.slice(-365), spot || 0) : null,
    low365: closes.length ? Math.min(...closes.slice(-365)) : null,
    ma50: closes.length >= 50 ? mean(closes.slice(-50)) : null,
    ma200: closes.length >= 200 ? mean(closes.slice(-200)) : null,
    rv7: realizedVol(closes, 7),
    rv30: realizedVol(closes, 30),
    ath: snap.price?.ath ?? null,
    athDate: snap.price?.athDate ?? null,
  };
  if (!m.price.marketCap && spot) m.price.marketCap = spot * 19.93e6; // fallback supply approximation; flagged below
  m.price.mcapApprox = !snap.price?.marketCap;
  m.price.drawdownPct = m.price.ath ? pct(spot, m.price.ath) : m.price.high365 ? pct(spot, m.price.high365) : null;
  m.price.vsMa200Pct = pct(spot, m.price.ma200);

  // ---- depth
  const venues = snap.books?.venues || [];
  if (venues.length) {
    const band = (b, side) => sum(venues.map((v) => v.bands[b]?.[side] || 0));
    m.depth = {
      venues: venues.map((v) => ({ venue: v.venue, pair: v.pair, mid: v.mid, spreadBps: v.spreadBps, d05: v.bands['0.5'].bidUsd + v.bands['0.5'].askUsd, d1: v.bands['1'].bidUsd + v.bands['1'].askUsd, d2: v.bands['2'].bidUsd + v.bands['2'].askUsd, bid1: v.bands['1'].bidUsd, ask1: v.bands['1'].askUsd, truncated2: v.bands['2'].bidTruncated || v.bands['2'].askTruncated, truncated1: v.bands['1'].bidTruncated || v.bands['1'].askTruncated })),
      bid05: band('0.5', 'bidUsd'), ask05: band('0.5', 'askUsd'),
      bid1: band('1', 'bidUsd'), ask1: band('1', 'askUsd'),
      bid2: band('2', 'bidUsd'), ask2: band('2', 'askUsd'),
    };
    const d = m.depth;
    d.d05 = d.bid05 + d.ask05; d.d1 = d.bid1 + d.ask1; d.d2 = d.bid2 + d.ask2;
    d.imbalance1 = (d.bid1 - d.ask1) / (d.bid1 + d.ask1);
    const shares = d.venues.map((v) => ({ venue: v.venue, share: v.d1 / d.d1 })).sort((a, b) => b.share - a.share);
    d.shares = shares;
    d.top2Share = (shares[0]?.share || 0) + (shares[1]?.share || 0);
    d.hhi = sum(shares.map((s) => (s.share * 100) ** 2));
    d.venueCount = venues.length;
    d.venueSet = venues.map((v) => v.venue).sort().join(',');
    // history comparisons (only like-for-like venue sets are compared)
    const cmp = (r) => (r && r.depth1 && r.depthVenues === d.venueSet ? pct(d.d1, r.depth1) : null);
    d.ch1d = cmp(m.prev1); d.ch7d = cmp(m.prev7); d.ch30d = cmp(m.prev30);
    const histD1 = prevRows.filter((r) => r.depthVenues === d.venueSet && r.depth1).map((r) => r.depth1);
    d.pctile = histD1.length >= 10 ? percentileRank(d.d1, histD1) : null;
    d.historyDays = histD1.length;
    d.stale = venues.some(() => false) || Object.entries(snap.sources || {}).some(([k, s]) => k.startsWith('book_') && s.status === 'stale');
    d.impact = snap.books.impact;
    // Coinbase premium (US spot demand proxy): Coinbase BTC-USD vs offshore BTC-USDT mids
    const cb = venues.find((v) => v.venue === 'Coinbase');
    const off = venues.filter((v) => /USDT/.test(v.pair));
    d.coinbasePremiumPct = cb && off.length ? pct(cb.mid, mean(off.map((v) => v.mid))) : null;
  } else m.depth = null;

  // ---- ETF
  const etfDaily = snap.etf?.daily || [];
  if (etfDaily.length) {
    const priceOn = (date) => valueAt(ph.map((r) => [r[0], r[1]]), date) || spot;
    const last = etfDaily.at(-1);
    const lastN = (n) => etfDaily.slice(-n);
    const s5 = sum(lastN(5).map((r) => r.totalUsdM));
    const s20 = sum(lastN(20).map((r) => r.totalUsdM));
    const prior20 = sum(etfDaily.slice(-40, -20).map((r) => r.totalUsdM));
    let streak = 0;
    const sgn = Math.sign(last.totalUsdM);
    for (let i = etfDaily.length - 1; i >= 0 && Math.sign(etfDaily[i].totalUsdM) === sgn && sgn !== 0; i--) streak++;
    const btcImplied = (rs) => sum(rs.map((r) => (r.totalUsdM * 1e6) / priceOn(r.date)));
    // flow-weighted average entry price of all net flows since launch
    let usd = 0, btc = 0;
    for (const r of etfDaily) { usd += r.totalUsdM * 1e6; btc += (r.totalUsdM * 1e6) / priceOn(r.date); }
    const ytd = etfDaily.filter((r) => r.date >= today.slice(0, 4) + '-01-01');
    const funds = {};
    for (const r of lastN(5)) for (const [k, v] of Object.entries(r.funds || {})) funds[k] = (funds[k] || 0) + (v || 0);
    const pos10 = lastN(10).filter((r) => r.totalUsdM > 0).length;
    m.etf = {
      lastDate: last.date, last: last.totalUsdM, lastFunds: last.funds,
      s5, s20, prior20, avg5: s5 / Math.min(5, etfDaily.length), avg20: s20 / Math.min(20, etfDaily.length),
      accel: s5 / 5 - s20 / 20,
      streak: sgn > 0 ? streak : -streak,
      persistence10: pos10 / Math.min(10, etfDaily.length),
      btc5: btcImplied(lastN(5)), btc20: btcImplied(lastN(20)),
      funds5: Object.entries(funds).map(([k, v]) => ({ fund: k, usdM: v })).sort((a, b) => b.usdM - a.usdM),
      // Only meaningful if the series starts at launch (Jan 2024); otherwise it is the basis of a partial window.
      cumulativeUsdM: usd / 1e6, cumulativeBtc: btc, flowBasis: etfDaily[0].date <= '2024-01-31' && btc > 0 && usd > 0 ? usd / btc : null,
      fullHistory: etfDaily[0].date <= '2024-01-31', firstDate: etfDaily[0].date,
      ytdUsdM: sum(ytd.map((r) => r.totalUsdM)),
      historyDays: etfDaily.length,
      daysOld: Math.round((new Date(today) - new Date(last.date)) / DAY),
      weekly: weeklyEtf(etfDaily).slice(-12),
      series20: lastN(30).map((r) => [r.date, r.totalUsdM]),
    };
    const wk = m.etf.weekly;
    let outWeeks = 0;
    for (let i = wk.length - 1; i >= 0 && wk[i].usdM < 0; i--) outWeeks++;
    let inWeeks = 0;
    for (let i = wk.length - 1; i >= 0 && wk[i].usdM > 0; i--) inWeeks++;
    m.etf.consecOutWeeks = outWeeks; m.etf.consecInWeeks = inWeeks;
  } else m.etf = null;

  // ---- derivatives
  const dv = snap.derivs?.venues || [];
  if (dv.length) {
    const live = dv.filter((v) => !v.stale && v.oiUsd);
    const totalOi = sum(live.map((v) => v.oiUsd));
    const fv = dv.filter((v) => !v.stale && v.funding8h !== null && v.funding8h !== undefined && v.oiUsd);
    const fw = fv.length ? sum(fv.map((v) => v.funding8h * v.oiUsd)) / sum(fv.map((v) => v.oiUsd)) : null;
    const rates = fv.map((v) => v.funding8h);
    m.derivs = {
      venues: dv.map((v) => ({ ...v, fundingAnn: v.funding8h !== null && v.funding8h !== undefined ? v.funding8h * 3 * 365 * 100 : null })),
      coverage: live.map((v) => v.venue).sort().join(','),
      totalOi,
      oiPctMcap: m.price.marketCap ? (totalOi / m.price.marketCap) * 100 : null,
      funding8h: fw,
      fundingAnn: fw !== null ? fw * 3 * 365 * 100 : null,
      fundingDispersionBps: rates.length > 1 ? (Math.max(...rates) - Math.min(...rates)) * 1e4 : null,
      volume24h: sum(dv.filter((v) => !v.stale).map((v) => v.volume24hUsd || 0)),
      marketWide: snap.derivs.marketWide || null,
      viaCg: dv.filter((v) => v.via === 'CoinGecko').map((v) => v.venue),
    };
    const D = m.derivs;
    const cmp = (r) => (r && r.oiTotal && r.oiCoverage === D.coverage ? pct(D.totalOi, r.oiTotal) : null);
    D.ch1d = cmp(m.prev1); D.ch7d = cmp(m.prev7); D.ch30d = cmp(m.prev30);
    // OKX-only daily history (consistent methodology, single venue)
    const oh = snap.derivs.okxOiHistory || [];
    if (oh.length) {
      const lastOi = oh.at(-1)[1];
      const ago = (n) => (oh.length > n ? oh[oh.length - 1 - n][1] : null);
      D.okx = { oi: lastOi, ch1d: pct(lastOi, ago(1)), ch7d: pct(lastOi, ago(7)), ch30d: pct(lastOi, ago(30)), date: oh.at(-1)[0], history: oh.slice(-90) };
    }
    // Best available OI change: aggregate if like-for-like history exists, else OKX proxy
    D.oiCh1d = D.ch1d ?? D.okx?.ch1d ?? null;
    D.oiCh7d = D.ch7d ?? D.okx?.ch7d ?? null;
    D.oiCh30d = D.ch30d ?? D.okx?.ch30d ?? null;
    D.oiChBasis = D.ch7d !== null ? 'aggregate (like-for-like venues)' : D.okx ? 'OKX-only proxy' : 'unavailable';
    // funding history (OKX)
    const fh = snap.derivs.okxFundingHistory || [];
    if (fh.length) {
      const rates8 = fh.map((r) => r[1]);
      const last21 = rates8.slice(-21); // ≈7 days at 8h
      D.okxFunding7dAnn = mean(last21) * 3 * 365 * 100;
      D.okxFundingPrev7dAnn = mean(rates8.slice(-42, -21)) * 3 * 365 * 100;
      D.okxFundingPctile = percentileRank(rates8.at(-1), rates8);
      D.fundingDaily = dailyFunding(fh);
    }
    // basis curve
    const curve = snap.derivs.curve || [];
    if (curve.length) {
      const q = curve.slice().sort((a, b) => Math.abs(a.days - 90) - Math.abs(b.days - 90))[0];
      D.basis = { instrument: q.instrument, days: q.days, annPct: q.basisAnnPct, curve };
      D.curveShape = curve.length >= 2 ? (curve.at(-1).basisAnnPct > curve[0].basisAnnPct ? 'upward-sloping (contango steepening with tenor)' : 'flat / inverted at the long end') : null;
    }
    // long/short ratio
    const ls = snap.derivs.okxLongShort || [];
    if (ls.length) D.longShort = { okx: ls.at(-1)[1], okx7dAgo: ls.length > 7 ? ls.at(-8)[1] : null };
    const bls = snap.derivs.binanceLongShort || [];
    if (bls.length) D.longShort = { ...(D.longShort || {}), binance: bls.at(-1)[1] };
    // taker flow
    const tc = snap.derivs.takerContracts || [], ts = snap.derivs.takerSpot || [];
    const ratio = (arr, n) => { const s = arr.slice(-n); const b = sum(s.map((r) => r[1])), se = sum(s.map((r) => r[2])); return se ? b / se : null; };
    D.takerContracts1d = ratio(tc, 1); D.takerContracts7d = ratio(tc, 7);
    D.takerSpot1d = ratio(ts, 1); D.takerSpot7d = ratio(ts, 7);
    D.okxSpotVol1d = ts.length ? ts.at(-1)[1] + ts.at(-1)[2] : null;
    D.okxContractVol1d = tc.length ? tc.at(-1)[1] + tc.at(-1)[2] : null;
    // CFTC
    const cot = snap.derivs.cot?.rows || [];
    if (cot.length) {
      const c = cot.at(-1), p = cot.length > 1 ? cot.at(-2) : null, p4 = cot.length > 4 ? cot.at(-5) : null;
      const btcPer = snap.derivs.cot.contractBtc || 5;
      const net = (r, a, b) => (r ? (r[a] || 0) - (r[b] || 0) : null);
      D.cot = {
        date: c.date,
        oiBtc: c.oiContracts * btcPer, oiUsd: spot ? c.oiContracts * btcPer * spot : null,
        oiCh1w: p ? pct(c.oiContracts, p.oiContracts) : null, oiCh4w: p4 ? pct(c.oiContracts, p4.oiContracts) : null,
        levNet: net(c, 'levLong', 'levShort'), levNetPrev: net(p, 'levLong', 'levShort'),
        amNet: net(c, 'amLong', 'amShort'), amNetPrev: net(p, 'amLong', 'amShort'),
        dealerNet: net(c, 'dealerLong', 'dealerShort'),
      };
    }
  } else m.derivs = null;

  m.liq = snap.liquidations || null;

  // ---- options
  const o = snap.options;
  if (o) {
    const dvh = o.dvolHistory || [];
    const dvol = dvh.length ? dvh.at(-1)[1] : null;
    const near = (o.byStrike || []).filter((s) => spot && Math.abs(s.strike - spot) / spot < 0.15);
    const topGamma = near.slice().sort((a, b) => b.nearGammaUsd - a.nearGammaUsd).slice(0, 3);
    const bigExp = (o.expiries || []).filter((e) => e.days <= 10).sort((a, b) => b.notionalUsd - a.notionalUsd)[0] || null;
    m.options = {
      totalOiBtc: o.callOi + o.putOi, notionalUsd: o.notionalUsd, pcRatio: o.pcRatio,
      atmIv30: o.atmIv30, skew25: o.skew25_30, refExpiry: o.ref30Expiry,
      dvol, dvol7dAgo: dvh.length > 7 ? dvh.at(-8)[1] : null, dvol30dAgo: dvh.length > 30 ? dvh.at(-31)[1] : null,
      dvolPctile: dvh.length > 30 ? percentileRank(dvol, dvh.map((r) => r[1])) : null,
      ivRvSpread: (o.atmIv30 ?? dvol) !== null && m.price.rv30 !== null ? (o.atmIv30 ?? dvol) - m.price.rv30 : null,
      expiries: o.expiries || [],
      nextBigExpiry: bigExp,
      topGamma,
      maxCallStrike: (o.byStrike || []).slice().sort((a, b) => b.callOi - a.callOi)[0] || null,
      maxPutStrike: (o.byStrike || []).slice().sort((a, b) => b.putOi - a.putOi)[0] || null,
      dvolSeries: dvh.slice(-120),
    };
  } else m.options = null;

  // ---- macro
  const F = snap.macro?.fred || {};
  const Y = snap.macro?.markets || {};
  const pts = (id) => F[id]?.points || null;
  const chg = (series, days, mode = 'pct') => {
    if (!series || series.length < 2) return null;
    const [d, v] = lastPoint(series);
    const old = valueAt(series, shiftDate(d, -days));
    return mode === 'pct' ? pct(v, old) : old !== null ? v - old : null;
  };
  const lvl = (series) => (series ? lastPoint(series) : null);
  // year-on-year % change of a monthly series, `back` observations before the latest
  const yoy = (series, back = 0) => {
    if (!series || series.length < 13 + back) return null;
    const [d, v] = series[series.length - 1 - back];
    const old = valueAt(series, shiftDate(d, -365));
    return old ? [d, pct(v, old)] : null;
  };
  let netLiq = null;
  if (pts('WALCL') && pts('WTREGEN') && pts('RRPONTSYD')) {
    // weekly net liquidity on WALCL dates: Fed assets − TGA − RRP (USD bn)
    netLiq = pts('WALCL').map(([d, v]) => {
      const tga = valueAt(pts('WTREGEN'), d), rrp = valueAt(pts('RRPONTSYD'), d);
      return tga !== null && rrp !== null ? [d, v - tga - rrp] : null;
    }).filter(Boolean);
  }
  const dollar = Y.DXY || pts('DTWEXBGS');
  m.macro = (Object.keys(F).length || Object.keys(Y).length) ? {
    fedAssets: lvl(pts('WALCL')), fedAssets13w: chg(pts('WALCL'), 91, 'abs'),
    tga: lvl(pts('WTREGEN')), tga4w: chg(pts('WTREGEN'), 28, 'abs'),
    rrp: lvl(pts('RRPONTSYD')),
    reserves: lvl(pts('WRESBAL')),
    netLiq: netLiq?.length ? netLiq.at(-1) : null, netLiq4w: chg(netLiq, 28, 'abs'), netLiq13w: chg(netLiq, 91, 'abs'), netLiqSeries: netLiq?.slice(-60) || null,
    ff: lvl(pts('DFF')),
    us2y: lvl(pts('DGS2')), us2y20d: chg(pts('DGS2'), 28, 'abs'),
    us10y: lvl(pts('DGS10')), us10y20d: chg(pts('DGS10'), 28, 'abs'),
    real10y: lvl(pts('DFII10')), real10y20d: chg(pts('DFII10'), 28, 'abs'),
    breakeven: lvl(pts('T10YIE')),
    hy: lvl(pts('BAMLH0A0HYM2')), hy20d: chg(pts('BAMLH0A0HYM2'), 28, 'abs'),
    vix: lvl(Y.VIX || pts('VIXCLS')), vix20d: chg(Y.VIX || pts('VIXCLS'), 28, 'abs'),
    dollar: lvl(dollar), dollarLabel: Y.DXY ? 'DXY' : 'Broad dollar (FRED)', dollar20d: chg(dollar, 28),
    ndx: lvl(Y.NDX || pts('NASDAQCOM')), ndx20d: chg(Y.NDX || pts('NASDAQCOM'), 28),
    spx: lvl(Y.SPX || pts('SP500')), spx20d: chg(Y.SPX || pts('SP500'), 28),
    gold: lvl(Y.GOLD), gold20d: chg(Y.GOLD, 28),
    silver: lvl(Y.SILVER), silver20d: chg(Y.SILVER, 28),
    g3: g3BalanceSheet(F),
    // monthly / quarterly series (year-on-year where the level itself is not meaningful)
    curve: lvl(pts('T10Y2Y')), ff90: chg(pts('DFF'), 91, 'abs'), ff180: chg(pts('DFF'), 182, 'abs'),
    m2: lvl(pts('M2SL')), m2Yoy: yoy(pts('M2SL')), m2Yoy3m: yoy(pts('M2SL'), 1),
    cpiYoy: yoy(pts('CPIAUCSL')), cpiYoy3m: yoy(pts('CPIAUCSL'), 3),
    pceYoy: yoy(pts('PCEPILFE')), pceYoy3m: yoy(pts('PCEPILFE'), 3),
    unrate: lvl(pts('UNRATE')), unrate3m: chg(pts('UNRATE'), 92, 'abs'),
    gdp: lvl(pts('A191RL1Q225SBEA')),
  } : null;

  // ---- correlations
  const btcSeries = ph.map((r) => [r[0], r[1]]);
  const C = {};
  const ret = { NDX: Y.NDX || pts('NASDAQCOM'), SPX: Y.SPX || pts('SP500'), GOLD: Y.GOLD, SILVER: Y.SILVER, DXY: dollar };
  const diff = { US10Y: Y.TNX || pts('DGS10'), VIX: Y.VIX || pts('VIXCLS'), REAL10Y: pts('DFII10') };
  for (const [k, s] of Object.entries(ret)) {
    if (!s || btcSeries.length < 40) continue;
    const a30 = alignedReturns(btcSeries, s, 30), a90 = alignedReturns(btcSeries, s, 90);
    const prevSeries = btcSeries.filter(([d]) => d <= shiftDate(today, -30));
    const p30 = alignedReturns(prevSeries, s, 30);
    C[k] = { c30: pearson(a30.ra, a30.rb), c90: pearson(a90.ra, a90.rb), c30prev: pearson(p30.ra, p30.rb), beta90: beta(a90.ra, a90.rb), n30: a30.ra.length };
  }
  for (const [k, s] of Object.entries(diff)) {
    if (!s || btcSeries.length < 40) continue;
    const a30 = alignedReturnsVsDiff(btcSeries, s, 30), a90 = alignedReturnsVsDiff(btcSeries, s, 90);
    C[k] = { c30: pearson(a30.ra, a30.rb), c90: pearson(a90.ra, a90.rb), n30: a30.ra.length };
  }
  // netliq weekly changes vs BTC weekly
  if (netLiq?.length > 20) {
    const a = alignedReturns(btcSeries, netLiq.map(([d, v]) => [d, v + 1e4]), 26);
    C.NETLIQ = { c30: null, c90: pearson(a.ra, a.rb), note: 'weekly, 26 obs' };
  }
  m.corr = Object.keys(C).length ? C : null;
  if (m.corr) m.corr.behaviour = classifyBehaviour(m);

  // ---- on-chain
  const cm = snap.onchain?.coinmetrics?.series || {};
  const ochg = (s, n) => (s && s.length > n ? pct(s.at(-1)[1], s.at(-1 - n)[1]) : null);
  // Realised price = realised cap / supply; if realised cap is not served, price ÷ MVRV on the same date (identical by definition).
  let realized = cm.CapRealUSD && cm.SplyCur ? cm.CapRealUSD.at(-1)[1] / cm.SplyCur.at(-1)[1] : null;
  if (realized === null && cm.CapMVRVCur?.length) {
    const [d, mv] = cm.CapMVRVCur.at(-1);
    const px = valueAt(ph.map((r) => [r[0], r[1]]), d);
    if (px && mv) realized = px / mv;
  }
  const hashTh = cm.HashRate;
  const hashprice = cm.RevUSD && hashTh ? cm.RevUSD.map(([d, v]) => { const h = valueAt(hashTh, d); return h ? [d, v / (h / 1000)] : null; }).filter(Boolean) : null; // USD / PH/s / day
  const st = snap.onchain?.stablecoins || [];
  m.onchain = {
    mvrv: cm.CapMVRVCur ? cm.CapMVRVCur.at(-1)[1] : null,
    mvrv30dAgo: cm.CapMVRVCur && cm.CapMVRVCur.length > 30 ? cm.CapMVRVCur.at(-31)[1] : null,
    mvrvPctile: cm.CapMVRVCur ? percentileRank(cm.CapMVRVCur.at(-1)[1], cm.CapMVRVCur.map((r) => r[1])) : null,
    mvrvDate: cm.CapMVRVCur ? cm.CapMVRVCur.at(-1)[0] : null,
    realizedPrice: realized,
    hashCh30d: ochg(hashTh, 30) ?? (snap.onchain?.mempool?.hashrateHistory ? ochg(snap.onchain.mempool.hashrateHistory, 30) : null),
    hashrateEhs: snap.onchain?.mempool?.hashrateEhs ?? (hashTh ? hashTh.at(-1)[1] / 1e6 : null),
    nextAdjPct: snap.onchain?.mempool?.nextAdjPct ?? null,
    hashprice: hashprice?.length ? hashprice.at(-1)[1] : null,
    hashprice30d: hashprice ? ochg(hashprice, 30) : null,
    minerRev30d: ochg(cm.RevUSD, 30),
    issuanceBtc: cm.IssTotNtv ? cm.IssTotNtv.at(-1)[1] : null,
    exFlowNet7d: cm.FlowInExNtv && cm.FlowOutExNtv ? sum(cm.FlowInExNtv.slice(-7).map((r) => r[1])) - sum(cm.FlowOutExNtv.slice(-7).map((r) => r[1])) : null,
    exSupply: cm.SplyExNtv ? cm.SplyExNtv.at(-1)[1] : null,
    exSupply30d: ochg(cm.SplyExNtv, 30),
    stables: st.length ? st.at(-1)[1] : null,
    stables7d: st.length > 7 ? st.at(-1)[1] - st.at(-8)[1] : null,
    stables30d: st.length > 30 ? st.at(-1)[1] - st.at(-31)[1] : null,
    unavailable: snap.onchain?.coinmetrics?.unavailable || [],
  };

  // ---- market structure
  const coins = snap.breadth?.coins || [];
  const btcC = coins.find((c) => c.id === 'bitcoin');
  const alts = coins.filter((c) => c.id !== 'bitcoin');
  m.structure = {
    spotVolume24h: snap.price?.volume24h ?? null,
    derivVolume24h: m.derivs?.volume24h ?? null,
    derivToSpot: m.derivs?.volume24h && snap.price?.volume24h ? m.derivs.volume24h / snap.price.volume24h : null,
    okxContractToSpot: m.derivs?.okxContractVol1d && m.derivs?.okxSpotVol1d ? m.derivs.okxContractVol1d / m.derivs.okxSpotVol1d : null,
    dominance: snap.global?.btcDominance ?? null,
    dominancePrev7: m.prev7?.dominance ?? null,
    breadth7: btcC && alts.length ? (alts.filter((c) => c.ch7d !== null && c.ch7d > btcC.ch7d).length / alts.length) * 100 : null,
    breadth30: btcC && alts.length ? (alts.filter((c) => c.ch30d !== null && c.ch30d > btcC.ch30d).length / alts.length) * 100 : null,
    altsUp7: alts.length ? (alts.filter((c) => c.ch7d > 0).length / alts.length) * 100 : null,
  };
  return m;
}

function weeklyEtf(daily) {
  const wk = new Map();
  for (const r of daily) {
    const d = new Date(r.date + 'T00:00:00Z');
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
    const monday = isoDate(d.getTime() - dow * DAY);
    wk.set(monday, (wk.get(monday) || 0) + r.totalUsdM);
  }
  return [...wk.entries()].map(([w, v]) => ({ week: w, usdM: v }));
}
function dailyFunding(fh) {
  const m = new Map();
  for (const [ts, r] of fh) {
    const d = isoDate(ts);
    const a = m.get(d) || [];
    a.push(r);
    m.set(d, a);
  }
  return [...m.entries()].map(([d, a]) => [d, mean(a) * 3 * 365 * 100]);
}
function g3BalanceSheet(F) {
  const fed = F.WALCL?.points, ecb = F.ECBASSETSW?.points, boj = F.JPNASSETS?.points, eur = F.DEXUSEU?.points, jpy = F.DEXJPUS?.points;
  if (!fed || !ecb || !boj || !eur || !jpy) return null;
  const at = (d) => {
    const f = valueAt(fed, d), e = valueAt(ecb, d), b = valueAt(boj, d), fx1 = valueAt(eur, d), fx2 = valueAt(jpy, d);
    if ([f, e, b, fx1, fx2].some((x) => x === null)) return null;
    return f + e * fx1 + (b * 0.1) / fx2; // BoJ: 100m JPY → bn JPY (×0.1) → USD bn
  };
  const d = fed.at(-1)[0];
  const now = at(d), prev = at(shiftDate(d, -91));
  return now ? { usdBn: now, ch13wPct: pct(now, prev), note: 'Fed + ECB + BoJ in USD; BoJ is monthly and lags.' } : null;
}

function classifyBehaviour(m) {
  const c = m.corr;
  const ndx = c.NDX?.c30, gold = c.GOLD?.c30, dxy = c.DXY?.c30;
  const out = [];
  if (ndx === null || ndx === undefined) return { label: 'Insufficient data', detail: [] };
  if (ndx >= T.corrHigh && (c.NDX.beta90 ?? 0) > 1) out.push('high-beta risk asset');
  else if (ndx >= T.corrHigh) out.push('risk asset (equity-linked)');
  if (c.NDX.c30prev !== null && c.NDX.c30prev !== undefined && c.NDX.c30prev >= 0.4 && ndx < T.corrLow) out.push('decoupling from equities');
  if (gold !== null && gold !== undefined && gold >= 0.35 && dxy !== null && dxy !== undefined && dxy <= -0.25) out.push('liquidity-sensitive monetary asset (moving with gold, against the dollar)');
  if (Math.abs(ndx) < T.corrLow && (gold === null || Math.abs(gold) < T.corrLow)) out.push('driven primarily by crypto-specific factors');
  return { label: out.length ? out[0] : 'mixed / weakly linked', detail: out };
}

// ---------------------------------------------------------------------------
// MOVE ATTRIBUTION — which kind of move is this?
export function attributeMove(m, horizon) {
  const P = horizon === '1d' ? m.price.ch24h : m.price.ch7d;
  const OI = horizon === '1d' ? m.derivs?.oiCh1d : m.derivs?.oiCh7d;
  const etf = horizon === '1d' ? m.etf?.last : m.etf?.s5;
  const fundNow = m.derivs?.fundingAnn ?? null;
  const fundPrev = horizon === '1d' ? m.prev1?.fundingAnn ?? null : m.derivs?.okxFundingPrev7dAnn ?? m.prev7?.fundingAnn ?? null;
  const depthCh = horizon === '1d' ? m.depth?.ch1d : m.depth?.ch7d;
  const move = horizon === '1d' ? T.move1d : T.move7d;
  const cascade = horizon === '1d' ? T.cascade1d : T.cascade7d;
  const oiB = horizon === '1d' ? T.oi1dBuild : T.oi7dBuild;
  const oiF = horizon === '1d' ? T.oi1dFlush : T.oi7dFlush;
  const liq = m.liq;
  const ev = [];
  const missing = [];
  const note = (k, v) => (v === null || v === undefined ? missing.push(k) : ev.push(v));
  note('price change', P !== null ? `Price ${fmtPct(P)} (${horizon})` : null);
  note('open-interest change', OI !== null && OI !== undefined ? `OI ${fmtPct(OI)} (${m.derivs.oiChBasis})` : null);
  note('ETF flows', etf !== null && etf !== undefined ? `ETF net ${fmtUsd(etf * 1e6)} (${horizon === '1d' ? 'last reported day' : '5 days'})` : null);
  note('funding', fundNow !== null ? `Funding ${fmtNum(fundNow, 1)}% ann.` : null);
  if (depthCh !== null && depthCh !== undefined) ev.push(`±1% depth ${fmtPct(depthCh)}`);
  if (liq) ev.push(`OKX liquidation sample: longs ${fmtUsd(liq.longUsd)}, shorts ${fmtUsd(liq.shortUsd)}`);

  if (P === null) return { horizon, label: 'Indeterminate', type: 'unknown', explanation: 'Price change unavailable.', evidence: ev, missing, confidence: 'sparse inputs' };
  const has = (x) => x !== null && x !== undefined;
  let label, type, explanation;
  if (Math.abs(P) < move) {
    if (has(OI) && OI > oiB) { label = 'Range with leverage building'; type = 'range-leverage'; explanation = 'Price is contained but open interest is rising: positions are being added at these levels, which increases the fuel for a later directional break in either direction.'; }
    else if (has(OI) && OI < oiF) { label = 'Range with deleveraging'; type = 'range-delever'; explanation = 'Open interest is falling without a large price move: leverage is being reduced in an orderly way, lowering the risk of a forced move.'; }
    else { label = 'Range / no dominant mechanism'; type = 'range'; explanation = 'No price move large enough to attribute; forces are roughly offsetting.'; }
  } else if (P > 0) {
    const shortSq = has(OI) && OI < 0 && ((has(fundPrev) && fundPrev < 3) || (liq && liq.shortUsd > liq.longUsd * 1.5));
    const lev = has(OI) && OI > oiB && has(fundNow) && fundNow > T.fundingHotAnn * 0.66;
    const spotLed = (has(etf) && etf > 0) && (!has(OI) || OI <= oiB) && (!has(fundNow) || fundNow < T.fundingHotAnn);
    if (shortSq) { label = 'Short squeeze'; type = 'short-squeeze'; explanation = 'Price rose while open interest fell and funding had been low/negative: shorts were being forced to buy back. Squeezes are fast but exhaust once short positioning is cleared, unless spot demand takes over.'; }
    else if (lev && !spotLed) { label = 'Leverage-driven rally'; type = 'leverage-up'; explanation = 'Price rose with rising open interest and elevated funding: new leveraged longs, not cash buyers, are the marginal buyer. This structure is fragile — a reversal can liquidate the same positions.'; }
    else if (spotLed) { label = 'Spot-demand-driven rally'; type = 'spot-up'; explanation = 'Price rose with ETF inflows while leverage stayed contained: cash buyers are absorbing supply. These moves are slower but structurally more durable.'; }
    else { label = 'Rally — mixed drivers'; type = 'mixed-up'; explanation = 'The rise is not cleanly attributable; spot and derivative signals point in different directions.'; }
  } else {
    const cascadeC = P <= -cascade && has(OI) && OI < oiF && ((has(depthCh) && depthCh < -10) || (liq && liq.longUsd > 2 * liq.shortUsd) || !has(depthCh));
    const longLiq = has(OI) && OI < oiF / 2 && (!has(fundPrev) || fundPrev > 3);
    const spotDown = (!has(OI) || OI > oiF / 2) && has(etf) && etf < 0;
    if (cascadeC) { label = 'Reflexive liquidation cascade'; type = 'cascade'; explanation = 'A large price fall coincided with a sharp drop in open interest and deteriorating depth/long liquidations: forced selling was moving price, which triggered further forced selling.'; }
    else if (longLiq) { label = 'Leveraged long liquidation'; type = 'long-liq'; explanation = 'Price fell while open interest fell after a period of positive funding: crowded longs were being closed (voluntarily or by liquidation). Once the leverage is gone, selling pressure usually fades.'; }
    else if (spotDown) { label = 'Spot-driven decline'; type = 'spot-down'; explanation = 'Price fell with ETF outflows while open interest held up: the selling is coming from cash holders, not forced deleveraging. These declines can be persistent because they reflect a change in demand rather than positioning.'; }
    else { label = 'Decline — mixed drivers'; type = 'mixed-down'; explanation = 'The fall is not cleanly attributable to spot or leverage on available data.'; }
  }
  const confidence = missing.length >= 2 ? 'sparse inputs' : missing.length === 1 ? 'partial inputs' : 'complete inputs';
  return { horizon, label, type, explanation, evidence: ev, missing, confidence };
}

// ---------------------------------------------------------------------------
// REGIME
export function macroTransmission(m) {
  // How strongly macro moves currently reach BTC: max |90d corr| with Nasdaq / dollar / yields.
  const c = m.corr || {};
  const vals = [c.NDX?.c90, c.DXY?.c90, c.US10Y?.c90, c.REAL10Y?.c90].filter((x) => x !== null && x !== undefined).map(Math.abs);
  if (!vals.length) return { factor: 0.6, link: null };
  const link = Math.max(...vals);
  return { factor: clamp(0.25 + link * 1.5, 0.25, 1), link };
}

export function classifyRegime(m) {
  const s = {};
  const tm = macroTransmission(m);
  const reasons = {};
  const add = (k, w, why) => { s[k] = (s[k] || 0) + w; (reasons[k] ||= []).push(why); };
  const D = m.derivs, E = m.etf, P = m.price;
  if (E) {
    if (Math.abs(E.s5) > T.etf5dStrong) add('spot-led', 2, `ETF 5-day net ${fmtUsd(E.s5 * 1e6)}`);
    else if (Math.abs(E.s5) > T.etf5dStrong / 3) add('spot-led', 1, `ETF 5-day net ${fmtUsd(E.s5 * 1e6)}`);
  }
  if (D?.takerSpot7d && Math.abs(D.takerSpot7d - 1) > 0.08) add('spot-led', 1, `OKX spot taker buy/sell ${fmtNum(D.takerSpot7d)}`);
  if (D) {
    if (D.oiCh7d !== null && Math.abs(D.oiCh7d) > T.oi7dBuild) add('leverage-led', 2, `OI ${fmtPct(D.oiCh7d)} in 7d`);
    if (D.fundingAnn !== null && Math.abs(D.fundingAnn) > T.fundingHotAnn) add('leverage-led', 1.5, `funding ${fmtNum(D.fundingAnn, 1)}% ann.`);
    if (D.oiPctMcap !== null && D.oiPctMcap > 3.5) add('leverage-led', 0.5, `OI ${fmtNum(D.oiPctMcap)}% of market cap`);
  }
  if (m.structure?.derivToSpot && m.structure.derivToSpot > 4) add('derivatives-led', 1.5, `derivatives volume ${fmtNum(m.structure.derivToSpot, 1)}× spot`);
  if (m.options?.nextBigExpiry && m.options.nextBigExpiry.notionalUsd > 3e9 && m.options.nextBigExpiry.days < 4) add('derivatives-led', 1, `${fmtUsd(m.options.nextBigExpiry.notionalUsd)} Deribit expiry in ${m.options.nextBigExpiry.days}d`);
  if (m.corr?.NDX?.c30 !== null && m.corr?.NDX?.c30 !== undefined && m.corr.NDX.c30 > T.corrHigh) add('macro-led', 1.5, `30d correlation with Nasdaq ${fmtNum(m.corr.NDX.c30)}`);
  if (m.macro) {
    const w = tm.factor;
    if (tm.link !== null && tm.link < 0.2) (reasons['macro-led'] ||= []).push(`weak transmission: max 90d correlation with macro assets ${fmtNum(tm.link)}`);
    if (m.macro.dollar20d !== null && Math.abs(m.macro.dollar20d) > 2) add('macro-led', w, `${m.macro.dollarLabel} ${fmtPct(m.macro.dollar20d)} in 4w`);
    if (m.macro.real10y20d !== null && Math.abs(m.macro.real10y20d) > 0.25) add('macro-led', w, `10y real yield ${m.macro.real10y20d > 0 ? '+' : ''}${fmtNum(m.macro.real10y20d * 100, 0)}bp in 4w`);
    if (m.macro.vix !== null && m.macro.vix[1] > 25) add('macro-led', w, `VIX ${fmtNum(m.macro.vix[1], 1)}`);
  }
  if (m.depth) {
    if (m.depth.ch7d !== null && m.depth.ch7d < T.depthDeteriorate7d) add('liquidity-led', 2, `±1% depth ${fmtPct(m.depth.ch7d)} vs 7d ago`);
    if (m.depth.pctile !== null && m.depth.pctile < 15) add('liquidity-led', 1, `depth in the ${ordinal(m.depth.pctile)} percentile of system history`);
    if (P.rv7 !== null && P.rv30 !== null && P.rv7 > P.rv30 * 1.4 && m.depth.ch7d !== null && m.depth.ch7d < 0) add('liquidity-led', 1, 'short-term volatility rising as depth falls');
  }
  const ranked = Object.entries(s).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 1.5) {
    return { primary: 'Balanced / no dominant driver', secondary: null, scores: s, reasons, explanation: 'No single family of forces is clearly dominant on available data. Price is being set by the interaction of moderate signals.' };
  }
  const [p, ps] = ranked[0];
  const sec = ranked[1] && ranked[1][1] >= 1.5 ? ranked[1][0] : null;
  const expl = {
    'spot-led': 'Cash flows (ETF creations/redemptions, spot taker flow) are the marginal price setter.',
    'leverage-led': 'Changes in leveraged positioning (open interest, funding) are the marginal price setter; moves are prone to overshoot and reversal.',
    'derivatives-led': 'Derivatives activity (volume, expiries, hedging) dominates spot activity; price discovery is happening in futures/options.',
    'macro-led': 'BTC is moving with global risk and liquidity variables (equities, dollar, real yields).',
    'liquidity-led': 'Changes in available order-book liquidity are amplifying moves; small flows have outsized impact.',
  };
  return { primary: cap(p), secondary: sec ? cap(sec) : null, scores: s, reasons, explanation: expl[p] + (sec ? ` Secondary: ${expl[sec].charAt(0).toLowerCase() + expl[sec].slice(1)}` : ''), strength: ps };
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// FORCES
function dirWord(x) { return x > 0 ? 'bullish' : x < 0 ? 'bearish' : 'neutral'; }

export function buildForces(snap, m) {
  const F = [];
  const prevF = (r, id) => r?.forces?.[id] || null;
  const changeText = (id, now, fmt) => {
    const a = prevF(m.prev1, id), b = prevF(m.prev7, id);
    const t = (p, lbl) => (p ? `${lbl}: ${p.direction}${p.key !== undefined && p.key !== null ? `, ${fmt ? fmt(p.key) : p.key}` : ''}${p.direction !== now.direction ? ' → direction changed' : ''}` : `${lbl}: no record yet`);
    return { d1: t(a, 'Yesterday'), d7: t(b, '1 week ago') };
  };

  // 1 ETF demand
  if (m.etf) {
    const E = m.etf;
    const dir = E.s5 > 150 ? 1 : E.s5 < -150 ? -1 : 0;
    const persistent = Math.abs(E.streak) >= 4 || E.consecInWeeks >= 2 || E.consecOutWeeks >= 2;
    const imp = clamp(Math.abs(E.s5) / 25 + Math.abs(E.s20) / 120 + (persistent ? 15 : 0), 5, 95);
    const f = {
      id: 'etf', name: 'ETF demand', importance: imp, direction: dirWord(dir),
      confidence: E.daysOld <= 4 ? (persistent ? 'strong' : 'moderate') : 'weak',
      key: E.s5,
      state: `${fmtUsd(E.s5 * 1e6)} net over 5 days (${fmtUsd(E.s20 * 1e6)} over 20). ${E.streak > 0 ? `${E.streak} consecutive inflow days` : E.streak < 0 ? `${-E.streak} consecutive outflow days` : 'no streak'}; flows are ${E.accel > 0 ? 'accelerating' : 'decelerating'} vs the 20-day pace.`,
      evidence: [
        { label: 'Last reported day', value: `${E.lastDate}: ${fmtUsd(E.last * 1e6)}`, ...SRC(snap, 'farside') },
        { label: '5d / 20d net', value: `${fmtUsd(E.s5 * 1e6)} / ${fmtUsd(E.s20 * 1e6)} (prior 20d ${fmtUsd(E.prior20 * 1e6)})`, ...SRC(snap, 'farside') },
        { label: 'BTC implied (5d / 20d)', value: `${fmtNum(E.btc5, 0)} / ${fmtNum(E.btc20, 0)} BTC — compare ≈450 BTC/day new issuance`, derived: true },
        { label: 'Persistence', value: `${Math.round(E.persistence10 * 100)}% of last 10 sessions positive; ${E.consecInWeeks ? E.consecInWeeks + ' consecutive inflow weeks' : E.consecOutWeeks ? E.consecOutWeeks + ' consecutive outflow weeks' : 'weekly sign alternating'}`, derived: true },
        { label: 'Leaders (5d)', value: E.funds5.slice(0, 3).map((x) => `${x.fund} ${fmtUsd(x.usdM * 1e6)}`).join(', ') + (E.funds5.length > 3 ? ` … laggard ${E.funds5.at(-1).fund} ${fmtUsd(E.funds5.at(-1).usdM * 1e6)}` : ''), ...SRC(snap, 'farside') },
      ],
      mechanism: dir >= 0
        ? 'Net creations oblige authorised participants to buy spot BTC (directly or via prime brokers such as Coinbase) → that buying lifts offers on the order book → if depth is thin, each dollar moves price more. Price impact depends on whether sellers (miners, long-term holders, basis traders unwinding) absorb the bid.'
        : 'Net redemptions oblige APs to sell spot BTC → selling hits bids on Coinbase and OTC desks → with thin books the price impact is magnified and can trigger leveraged long liquidations, which add forced selling.',
      interpretation: `${persistent ? 'Flows are persistent rather than a one-day event, which is what historically mattered for trend.' : 'Flows are not (yet) persistent; single-day prints have little lasting price effect.'} ${E.daysOld > 3 ? `Note: latest flow data is ${E.daysOld} days old.` : ''}`,
      invalidation: dir >= 0 ? 'Two or more consecutive outflow days, or 5-day net turning negative, would undercut the ETF-demand interpretation.' : 'A run of inflow days large enough to turn the 5-day sum positive would invalidate the outflow-pressure reading.',
      watch: `Tonight's Farside print (US close). IBIT share of flows. Whether 5-day net stays ${dir >= 0 ? `above +$${T.etf5dStrong}M` : 'negative'}.`,
    };
    Object.assign(f, changeText('etf', f, (v) => fmtUsd(v * 1e6) + ' 5d'));
    F.push(f);
  } else F.push(unavailableForce('etf', 'ETF demand', 'Farside ETF flow data could not be retrieved and no prior copy exists.'));

  // 2 Market depth
  if (m.depth) {
    const D = m.depth;
    const sell25 = D.impact?.sell?.find((x) => x.sizeUsd === 25e6), sell100 = D.impact?.sell?.find((x) => x.sizeUsd === 100e6);
    const det = D.ch7d !== null && D.ch7d < T.depthDeteriorate7d;
    const imp2 = D.ch7d !== null && D.ch7d > 15;
    const dir = det ? -1 : imp2 ? 1 : 0;
    const imp = clamp(30 + (D.ch7d !== null ? Math.abs(D.ch7d) : 0) + (D.pctile !== null ? Math.abs(50 - D.pctile) / 2 : 0) + (D.top2Share > 0.7 ? 10 : 0), 10, 90);
    const f = {
      id: 'depth', name: 'Market depth (spot liquidity)', importance: imp, direction: dir < 0 ? 'bearish (amplifier)' : dir > 0 ? 'stabilising' : 'neutral',
      confidence: D.historyDays >= 7 ? 'moderate' : 'weak', key: D.d1,
      state: `±1% displayed depth ${fmtUsd(D.d1)} across ${D.venueCount} venues (bids ${fmtUsd(D.bid1)}, asks ${fmtUsd(D.ask1)}; imbalance ${fmtPct(D.imbalance1 * 100, 0)}). ${D.ch7d !== null ? `${fmtPct(D.ch7d)} vs 7d ago.` : 'No like-for-like 7-day comparison yet.'} Top-2 venue share ${Math.round(D.top2Share * 100)}%.`,
      evidence: [
        { label: '±0.5% / ±1% / ±2%', value: `${fmtUsd(D.d05)} / ${fmtUsd(D.d1)} / ${fmtUsd(D.d2)}`, source: 'Exchange order books (aggregated)', asOf: snap.collectedAt, frequency: 'snapshot' },
        { label: 'Change vs 1d / 7d / 30d', value: `${fmtPct(D.ch1d)} / ${fmtPct(D.ch7d)} / ${fmtPct(D.ch30d)}`, derived: true },
        { label: 'Concentration', value: D.shares.slice(0, 3).map((s) => `${s.venue} ${Math.round(s.share * 100)}%`).join(', ') + ` (HHI ${Math.round(D.hhi)})`, derived: true },
        { label: 'Est. impact of $25M / $100M market sell', value: `${sell25 ? (sell25.exhausted ? 'beyond captured depth' : fmtPct(-sell25.slippagePct, 2)) : 'n/a'} / ${sell100 ? (sell100.exhausted ? 'beyond captured depth (lower bound)' : fmtPct(-sell100.slippagePct, 2)) : 'n/a'}`, derived: true },
        { label: 'Coinbase premium vs USDT venues', value: D.coinbasePremiumPct !== null ? fmtPct(D.coinbasePremiumPct, 3) : 'n/a', derived: true },
      ],
      mechanism: 'Depth is the market’s shock absorber. Price impact of a flow ≈ flow ÷ available liquidity, so the same ETF redemption or liquidation moves price far more in a thin book. Displayed depth also withdraws during volatility (market makers widen or pull quotes), so realised liquidity in a sell-off is lower than the snapshot suggests — which is how thin markets turn ordinary selling into cascades.',
      interpretation: `${det ? 'Liquidity is deteriorating: the market is becoming more fragile to any forced flow.' : imp2 ? 'Liquidity is improving: flows are being absorbed with less impact.' : 'Liquidity is broadly stable versus last week.'} ${D.top2Share > 0.65 ? 'Liquidity is concentrated in two venues — a pull-back by makers there would remove most of the cushion.' : ''} Displayed ≠ executed liquidity: treat impact estimates as a best case.`,
      invalidation: det ? '±1% depth recovering above its 7-day-ago level.' : '±1% depth falling more than 15% within a week, especially during a price decline.',
      watch: 'Depth during US hours and around macro releases; bid-side depth on Coinbase (ETF execution venue); whether depth falls as price falls (withdrawal) or holds (absorption).',
    };
    Object.assign(f, changeText('depth', f, (v) => fmtUsd(v) + ' ±1%'));
    F.push(f);
  } else F.push(unavailableForce('depth', 'Market depth (spot liquidity)', 'No exchange order book could be retrieved.'));

  // 3 Leverage (open interest)
  if (m.derivs) {
    const D = m.derivs;
    const oi7 = D.oiCh7d;
    const build = oi7 !== null && oi7 > T.oi7dBuild, flush = oi7 !== null && oi7 < T.oi7dFlush;
    const priceUp = (m.price.ch7d ?? 0) > 0;
    const dir = build ? (priceUp ? 0 : -1) : flush ? 1 : 0;
    const imp = clamp(20 + (oi7 !== null ? Math.abs(oi7) * 3 : 0) + (D.oiPctMcap !== null ? Math.max(0, D.oiPctMcap - 2.5) * 10 : 0), 10, 92);
    const f = {
      id: 'leverage', name: 'Leverage (open interest)', importance: imp,
      direction: build ? 'fragility rising' : flush ? 'fragility falling (constructive)' : 'neutral',
      confidence: D.oiChBasis.startsWith('aggregate') ? 'moderate' : D.okx ? 'weak' : 'insufficient data', key: D.totalOi,
      state: `${fmtUsd(D.totalOi)} OI across ${D.coverage.split(',').length} venues (${fmtNum(D.oiPctMcap)}% of market cap). OI ${fmtPct(D.oiCh1d)} 1d, ${fmtPct(D.oiCh7d)} 7d, ${fmtPct(D.oiCh30d)} 30d (${D.oiChBasis}).`,
      evidence: [
        { label: 'Venue OI', value: D.venues.filter((v) => v.oiUsd).map((v) => `${v.venue} ${fmtUsd(v.oiUsd)}${v.via ? ' (via ' + v.via + ')' : ''}${v.stale ? ' (stale)' : ''}`).join(' · '), source: 'Venue APIs (OKX, Deribit, Hyperliquid, BitMEX direct; Binance/Bybit direct or via CoinGecko when geo-blocked)', asOf: snap.collectedAt, frequency: 'snapshot' },
        D.marketWide ? { label: 'Market-wide BTC perpetual OI (aggregator)', value: `${fmtUsd(D.marketWide.totalOiUsd)} across ${D.marketWide.marketCount} venues — includes smaller exchanges whose reporting is not independently verified; shown for scale, not used in change calculations`, ...SRC(snap, 'coingecko_deriv') } : null,
        D.okx ? { label: 'OKX daily OI (consistent series)', value: `${fmtUsd(D.okx.oi)}; ${fmtPct(D.okx.ch1d)} 1d / ${fmtPct(D.okx.ch7d)} 7d / ${fmtPct(D.okx.ch30d)} 30d`, ...SRC(snap, 'okx_rubik') } : null,
        D.cot ? { label: `CME (CFTC, ${D.cot.date})`, value: `OI ≈${fmtNum(D.cot.oiBtc / 1000, 1)}K BTC (${fmtPct(D.cot.oiCh1w)} w/w). Leveraged funds net ${D.cot.levNet} contracts; asset managers net ${D.cot.amNet}`, ...SRC(snap, 'cftc_cot') } : null,
        D.longShort ? { label: 'Long/short account ratio', value: `OKX ${fmtNum(D.longShort.okx)}${D.longShort.binance ? ` · Binance ${fmtNum(D.longShort.binance)}` : ''} (accounts, not notional)`, ...SRC(snap, 'okx_rubik') } : null,
      ].filter(Boolean),
      mechanism: 'Open interest is the stock of leveraged exposure that can be forced to trade. Rising OI with rising price means new longs (or shorts being added against the move); a subsequent adverse move liquidates them, turning leverage into forced market orders. Falling OI removes that fuel. OI % of market cap normalises for price.',
      interpretation: build ? (priceUp ? 'Leverage is building into the rally — price is increasingly supported by borrowed positions, raising the risk of a long-liquidation reversal.' : 'Leverage is building while price falls — likely shorts being added, which creates short-squeeze fuel above.') : flush ? 'Leverage has been flushed; forced-flow risk is lower and moves are more likely to reflect genuine spot demand.' : 'Leverage is not changing materially.',
      invalidation: build ? 'OI falling back while price holds would show the build was absorbed without stress.' : 'OI growth above +8% in a week would re-introduce liquidation risk.',
      watch: 'OI change vs price change each day; OI % market cap vs its recent range; CME positioning on Friday’s CFTC release.',
    };
    Object.assign(f, changeText('leverage', f, (v) => fmtUsd(v) + ' OI'));
    F.push(f);

    // 4 Funding & basis
    const fa = D.fundingAnn;
    const hot = fa !== null && fa > T.fundingHotAnn, neg = fa !== null && fa < T.fundingNegAnn;
    const imp4 = clamp(15 + (fa !== null ? Math.abs(fa - 8) * 1.5 : 0) + (D.fundingDispersionBps !== null ? D.fundingDispersionBps / 2 : 0), 5, 85);
    const f4 = {
      id: 'funding', name: 'Funding & basis (cost of leverage)', importance: imp4,
      direction: hot ? 'bearish (crowded longs)' : neg ? 'bullish (crowded shorts / squeeze fuel)' : 'neutral',
      confidence: fa !== null ? 'moderate' : 'insufficient data', key: fa,
      state: `OI-weighted perpetual funding ${fmtNum(fa, 1)}% annualised (${fmtNum(D.funding8h * 1e4, 2)} bps per 8h); dispersion across venues ${fmtNum(D.fundingDispersionBps, 2)} bps. ${D.basis ? `Deribit ${Math.round(D.basis.days)}-day basis ${fmtNum(D.basis.annPct, 1)}% annualised.` : ''}`,
      evidence: [
        { label: 'Per venue (ann.)', value: D.venues.filter((v) => v.fundingAnn !== null).map((v) => `${v.venue} ${fmtNum(v.fundingAnn, 1)}%`).join(' · '), source: 'Venue APIs', asOf: snap.collectedAt, frequency: '8h (Hyperliquid 1h, scaled)' },
        D.okxFunding7dAnn !== undefined ? { label: 'OKX 7-day avg vs prior week', value: `${fmtNum(D.okxFunding7dAnn, 1)}% vs ${fmtNum(D.okxFundingPrev7dAnn, 1)}% (current rate at ${ordinal(D.okxFundingPctile)} pct of ~100d)`, ...SRC(snap, 'okx_deriv') } : null,
        D.basis ? { label: 'Futures curve', value: D.basis.curve.map((c) => `${c.expiry.slice(5)} ${fmtNum(c.basisAnnPct, 1)}%`).join(' · ') + (D.curveShape ? ` — ${D.curveShape}` : ''), ...SRC(snap, 'deribit_fut') } : null,
        D.takerContracts7d ? { label: 'OKX taker buy/sell (contracts)', value: `${fmtNum(D.takerContracts1d)} (1d) / ${fmtNum(D.takerContracts7d)} (7d)`, ...SRC(snap, 'okx_rubik') } : null,
      ].filter(Boolean),
      mechanism: 'Funding is the price longs pay shorts to keep perpetuals anchored to spot. High positive funding means demand for leveraged long exposure exceeds supply — crowded positioning that bleeds carry and is vulnerable to a flush. Negative funding means shorts are crowded and a rally forces them to buy. Basis on dated futures shows the same thing for institutional (cash-and-carry) demand; a falling basis can force basis-trade unwinds (ETF selling + futures buying).',
      interpretation: hot ? 'Leverage is expensive and crowded on the long side.' : neg ? 'Shorts are paying to be short — positioning is defensive, which historically creates squeeze conditions if spot demand appears.' : 'Funding is in a normal carry range; positioning is not crowded on either side.',
      invalidation: hot ? 'Funding normalising below ~10% ann. without a price drop.' : neg ? 'Funding turning positive as price rises (shorts closed).' : `Funding above ${T.fundingHotAnn}% or below 0% annualised.`,
      watch: 'Funding resets at 00:00/08:00/16:00 UTC; venue dispersion (a single venue spiking often precedes local liquidations); basis falling toward T-bill yield (basis-trade unwind risk).',
    };
    Object.assign(f4, changeText('funding', f4, (v) => fmtNum(v, 1) + '% ann'));
    F.push(f4);
  } else {
    F.push(unavailableForce('leverage', 'Leverage (open interest)', 'No derivatives venue could be reached.'));
  }

  // 5 Spot demand (taker flow, Coinbase premium, structure)
  {
    const D = m.derivs, dep = m.depth, S = m.structure;
    const prem = dep?.coinbasePremiumPct ?? null;
    const tak = D?.takerSpot7d ?? null;
    if (prem !== null || tak !== null) {
      const score = (prem !== null ? Math.sign(prem) * Math.min(Math.abs(prem) / 0.05, 2) : 0) + (tak !== null ? Math.sign(tak - 1) * Math.min(Math.abs(tak - 1) / 0.05, 2) : 0);
      const f = {
        id: 'spot', name: 'Spot demand (who is buying)', importance: clamp(20 + Math.abs(score) * 12, 10, 75),
        direction: score > 0.8 ? 'bullish' : score < -0.8 ? 'bearish' : 'neutral', confidence: prem !== null && tak !== null ? 'moderate' : 'weak', key: prem,
        state: `Coinbase premium ${prem !== null ? fmtPct(prem, 3) : 'n/a'}; OKX spot taker buy/sell ${fmtNum(tak)} (7d). ${S?.derivToSpot ? `Derivatives volume ≈${fmtNum(S.derivToSpot, 1)}× aggregate spot volume.` : ''}`,
        evidence: [
          { label: 'Coinbase BTC-USD vs offshore BTC-USDT mid', value: prem !== null ? fmtPct(prem, 3) : 'n/a', source: 'Order-book mids (Coinbase vs Binance/OKX/Bybit)', asOf: snap.collectedAt, frequency: 'snapshot', derived: true },
          { label: 'OKX spot taker buy/sell', value: `${fmtNum(D?.takerSpot1d)} (1d) / ${fmtNum(tak)} (7d)`, ...SRC(snap, 'okx_rubik') },
          { label: 'Spot vs derivatives volume (24h)', value: `${fmtUsd(S?.spotVolume24h)} spot (CoinGecko) / ${fmtUsd(S?.derivVolume24h)} perps (sum of covered venues)`, derived: true },
        ],
        mechanism: 'A persistent Coinbase premium indicates US-hours spot buying (often institutional/ETF-related) outpacing offshore venues; taker buy/sell shows whether aggressive orders are lifting offers or hitting bids. Moves led by spot taker buying with contained leverage are the most durable kind.',
        interpretation: score > 0.8 ? 'Aggressive spot buying is evident — the bid is coming from cash, not leverage.' : score < -0.8 ? 'Spot participants are net aggressive sellers; US venues trade at a discount.' : 'No strong one-sided spot aggression.',
        invalidation: 'Premium and taker ratio reversing sign for several sessions.',
        watch: 'Coinbase premium during US hours (13:30–21:00 UTC), especially on large ETF days.',
      };
      Object.assign(f, changeText('spot', f, (v) => fmtPct(v, 3) + ' premium'));
      F.push(f);
    }
  }

  // 6 Macro liquidity
  if (m.macro) {
    const M = m.macro;
    let sc = 0; const ev = [];
    if (M.netLiq4w !== null) { sc += clamp(M.netLiq4w / 100, -2, 2); }
    if (M.real10y20d !== null) sc -= clamp(M.real10y20d / 0.15, -2, 2);
    if (M.hy20d !== null) sc -= clamp(M.hy20d / 0.3, -1.5, 1.5);
    if (M.dollar20d !== null) sc -= clamp(M.dollar20d / 1.5, -1.5, 1.5);
    const tm = macroTransmission(m);
    const f = {
      id: 'macro', name: 'Macro liquidity & financial conditions', importance: clamp((15 + Math.abs(sc) * 12) * tm.factor + (tm.link ?? 0.3) * 25, 8, 88),
      direction: sc > 1 ? 'bullish' : sc < -1 ? 'bearish' : 'neutral', confidence: M.netLiq && M.real10y !== null ? 'moderate' : 'weak', key: M.netLiq?.[1] ?? null,
      state: `Net liquidity (Fed assets − TGA − RRP) ${M.netLiq ? fmtUsd(M.netLiq[1] * 1e9) : 'n/a'} (${M.netLiq4w !== null ? fmtUsdSigned(M.netLiq4w * 1e9) : 'n/a'} in 4w). 10y real yield ${M.real10y ? fmtNum(M.real10y[1], 2) + '%' : 'n/a'} (${M.real10y20d !== null ? (M.real10y20d >= 0 ? '+' : '') + fmtNum(M.real10y20d * 100, 0) + 'bp' : 'n/a'} 4w). HY spread ${M.hy ? fmtNum(M.hy[1], 2) + '%' : 'n/a'}. ${M.dollarLabel} ${fmtPct(M.dollar20d)} 4w.`,
      evidence: [
        { label: 'Fed balance sheet (WALCL)', value: M.fedAssets ? `${fmtUsd(M.fedAssets[1] * 1e9)} on ${M.fedAssets[0]} (13w ${M.fedAssets13w !== null ? fmtUsd(M.fedAssets13w * 1e9) : 'n/a'})` : 'n/a', ...SRC(snap, 'fred'), frequency: 'weekly (H.4.1, Thursday)' },
        { label: 'TGA / RRP', value: `${M.tga ? fmtUsd(M.tga[1] * 1e9) : 'n/a'} (4w ${M.tga4w !== null ? fmtUsd(M.tga4w * 1e9) : 'n/a'}) / ${M.rrp ? fmtUsd(M.rrp[1] * 1e9) : 'n/a'}`, ...SRC(snap, 'fred') },
        { label: 'Policy & rates', value: `Fed funds ${M.ff ? fmtNum(M.ff[1], 2) : 'n/a'}% · 2y ${M.us2y ? fmtNum(M.us2y[1], 2) : 'n/a'}% · 10y ${M.us10y ? fmtNum(M.us10y[1], 2) : 'n/a'}% · breakeven ${M.breakeven ? fmtNum(M.breakeven[1], 2) : 'n/a'}%`, ...SRC(snap, 'fred') },
        { label: 'Risk appetite', value: `VIX ${M.vix ? fmtNum(M.vix[1], 1) : 'n/a'} · Nasdaq-100 ${fmtPct(M.ndx20d)} 4w · gold ${fmtPct(M.gold20d)} 4w`, ...SRC(snap, 'yahoo') },
        M.g3 ? { label: 'G3 central-bank assets (USD)', value: `${fmtUsd(M.g3.usdBn * 1e9)} (${fmtPct(M.g3.ch13wPct)} 13w) — ${M.g3.note}`, ...SRC(snap, 'fred') } : null,
      ].filter(Boolean),
      mechanism: 'Fed balance sheet, Treasury cash (TGA) and reverse-repo usage determine bank reserves and dollar liquidity → that sets financial conditions (credit spreads, real yields, dollar) → which sets risk appetite and the cost of leverage → which sets the supply of speculative capital for BTC. Real yields are the opportunity cost of holding a non-yielding asset; a stronger dollar tightens global dollar funding.',
      interpretation: `${sc > 1 ? 'Financial conditions are easing at the margin — a tailwind for speculative capital.' : sc < -1 ? 'Financial conditions are tightening at the margin — speculative capital is more expensive.' : 'Macro liquidity is not changing enough to be a primary driver.'} BTC’s 90-day correlation with Nasdaq is ${fmtNum(m.corr?.NDX?.c90)} and with the dollar ${fmtNum(m.corr?.DXY?.c90)}${tm.link !== null && tm.link < 0.2 ? ' — the transmission channel is currently weak, so these conditions are a background headwind/tailwind rather than the day-to-day driver' : ', which scales how much these conditions transmit'}.`,
      invalidation: sc >= 0 ? 'A rise in real yields >25bp or HY spreads >50bp within a month.' : 'Net liquidity rising and real yields falling for several weeks.',
      watch: 'Thursday H.4.1 release; Treasury refunding / TGA rebuild; FOMC communications; month-end and quarter-end funding pressure.',
    };
    Object.assign(f, changeText('macro', f, (v) => fmtUsd(v * 1e9) + ' net liq.'));
    F.push(f);

    // 7 Dollar & rates (separate force — the rates channel)
    if (M.dollar !== null || M.us10y !== null) {
      const sc2 = -(clamp((M.dollar20d ?? 0) / 1.5, -2, 2) + clamp((M.us10y20d ?? 0) / 0.2, -2, 2));
      const cD = m.corr?.DXY?.c90, cR = m.corr?.US10Y?.c90;
      const f2 = {
        id: 'dollar', name: 'Dollar & Treasury yields', importance: clamp((12 + Math.abs(sc2) * 10) * macroTransmission(m).factor + (Math.abs(cD ?? 0) + Math.abs(cR ?? 0)) * 25, 6, 80),
        direction: sc2 > 1 ? 'bullish' : sc2 < -1 ? 'bearish' : 'neutral', confidence: cD !== null && cD !== undefined ? 'moderate' : 'weak', key: M.dollar?.[1] ?? null,
        state: `${M.dollarLabel} ${M.dollar ? fmtNum(M.dollar[1], 2) : 'n/a'} (${fmtPct(M.dollar20d)} 4w); 10y ${M.us10y ? fmtNum(M.us10y[1], 2) + '%' : 'n/a'} (${M.us10y20d !== null ? (M.us10y20d >= 0 ? '+' : '') + fmtNum(M.us10y20d * 100, 0) + 'bp' : 'n/a'}); 2y ${M.us2y ? fmtNum(M.us2y[1], 2) + '%' : 'n/a'}.`,
        evidence: [
          { label: '90d correlation of BTC returns', value: `vs ${M.dollarLabel} ${fmtNum(cD)} · vs 10y yield changes ${fmtNum(cR)} · vs real-yield changes ${fmtNum(m.corr?.REAL10Y?.c90)}`, derived: true },
          { label: 'Curve', value: M.us2y && M.us10y ? `2s10s ${fmtNum((M.us10y[1] - M.us2y[1]) * 100, 0)}bp` : 'n/a', ...SRC(snap, 'fred') },
        ],
        mechanism: 'A rising dollar tightens offshore dollar funding (where much crypto leverage sits) and lowers the dollar price of global assets; rising yields raise the hurdle rate for non-yielding assets and pull capital toward bonds. The effect on BTC is conditional on how strongly BTC currently trades as a macro asset (see correlations).',
        interpretation: sc2 > 1 ? 'Dollar and yields are easing — supportive.' : sc2 < -1 ? 'Dollar strength / higher yields are a headwind.' : 'No decisive move in the dollar or rates.',
        invalidation: 'A reversal of the 4-week dollar/yield trend.',
        watch: 'US CPI/PCE and payrolls; Treasury auctions; FOMC; DXY around its 4-week range.',
      };
      Object.assign(f2, changeText('dollar', f2, (v) => fmtNum(v, 2)));
      F.push(f2);
    }
  } else F.push(unavailableForce('macro', 'Macro liquidity & financial conditions', 'FRED and market data could not be retrieved.'));

  // 8 Options / volatility
  if (m.options) {
    const O = m.options;
    const exp = O.nextBigExpiry;
    const g = O.topGamma[0];
    const nearSpot = g && m.price.spot ? Math.abs(g.strike - m.price.spot) / m.price.spot < 0.03 : false;
    const ivCheap = O.ivRvSpread !== null && O.ivRvSpread < -5;
    const f = {
      id: 'options', name: 'Options positioning & volatility', importance: clamp(15 + (exp ? Math.min(exp.notionalUsd / 2e8, 30) / Math.max(exp.days, 1) : 0) + (nearSpot ? 15 : 0) + (O.dvolPctile !== null ? Math.abs(50 - O.dvolPctile) / 3 : 0), 8, 80),
      direction: O.skew25 !== null && O.skew25 < -4 ? 'bearish (hedging demand)' : O.skew25 !== null && O.skew25 > 3 ? 'bullish (call demand)' : 'neutral',
      confidence: 'moderate', key: O.atmIv30 ?? O.dvol,
      state: `Deribit OI ${fmtNum(O.totalOiBtc / 1000, 0)}K BTC (${fmtUsd(O.notionalUsd)}), put/call ${fmtNum(O.pcRatio)}. ~30d ATM IV ${fmtNum(O.atmIv30, 1)}% vs 30d realised ${fmtNum(m.price.rv30, 1)}%; 25Δ skew ${fmtNum(O.skew25, 1)} vol pts; DVOL ${fmtNum(O.dvol, 1)}${O.dvolPctile !== null ? ` (${ordinal(O.dvolPctile)} pct, 1y)` : ''}.`,
      evidence: [
        { label: 'Largest near-dated gamma strikes', value: O.topGamma.map((s) => `${fmtK(s.strike)} (${fmtUsd(s.nearGammaUsd)}/1% move)`).join(' · '), ...SRC(snap, 'deribit_opt'), derived: true },
        exp ? { label: `Expiry ${exp.expiry} (${exp.days}d)`, value: `${fmtUsd(exp.notionalUsd)} notional; max pain ${fmtK(exp.maxPain)}; largest strikes ${exp.topStrikes.map((s) => fmtK(s.strike)).join(', ')}`, ...SRC(snap, 'deribit_opt') } : null,
        { label: 'Largest OI strikes (all expiries)', value: `calls ${fmtK(O.maxCallStrike?.strike)} · puts ${fmtK(O.maxPutStrike?.strike)}`, ...SRC(snap, 'deribit_opt') },
        { label: 'IV − RV', value: `${fmtNum(O.ivRvSpread, 1)} vol pts`, derived: true },
      ].filter(Boolean),
      mechanism: 'Dealers delta-hedge the options they are short or long. When dealers are long gamma around a strike, they sell rallies and buy dips — suppressing volatility and pinning price toward the strike into expiry. When short gamma, they must buy rallies and sell dips — amplifying moves through the strike. Public data shows where gamma is concentrated, not the dealers’ sign; the conventional assumption (customers net long calls above spot, long puts below) is unverified.',
      interpretation: `${nearSpot ? `Large gamma sits within 3% of spot at ${fmtK(g.strike)}: expect either pinning (if dealers are long gamma) or acceleration through it (if short).` : 'No dominant gamma concentration immediately at spot.'} ${ivCheap ? 'Implied volatility is below realised — options are cheap relative to recent movement, which historically precedes volatility expansions.' : O.ivRvSpread !== null && O.ivRvSpread > 10 ? 'Implied volatility is rich vs realised — the market is paying for protection.' : ''} ${O.skew25 !== null && O.skew25 < -4 ? 'Puts trade at a premium to calls: demand for downside protection.' : ''}`,
      invalidation: 'Skew flipping sign; a large expiry rolling off removes the pinning effect.',
      watch: exp ? `${exp.expiry} 08:00 UTC Deribit expiry; behaviour around ${fmtK(g?.strike)}.` : 'Weekly Friday 08:00 UTC expiries; month-end expiry.',
    };
    Object.assign(f, changeText('options', f, (v) => fmtNum(v, 1) + '% IV'));
    F.push(f);
  } else F.push(unavailableForce('options', 'Options positioning & volatility', 'Deribit options data unavailable.'));

  // 9 On-chain supply
  {
    const O = m.onchain;
    if (O && (O.mvrv !== null || O.stables !== null || O.hashCh30d !== null)) {
      const stab = O.stables30d !== null ? O.stables30d / 1e9 : null;
      const sc = (stab !== null ? clamp(stab / 3, -1.5, 1.5) : 0) + (O.hashprice30d !== null && O.hashprice30d < -15 ? -0.7 : 0) + (O.exFlowNet7d !== null ? clamp(-O.exFlowNet7d / 15000, -1, 1) : 0);
      const f = {
        id: 'onchain', name: 'On-chain supply & stablecoin liquidity', importance: clamp(10 + Math.abs(sc) * 15 + (O.mvrv !== null && (O.mvrv > 3 || O.mvrv < 1.1) ? 20 : 0), 5, 70),
        direction: sc > 0.8 ? 'bullish' : sc < -0.8 ? 'bearish' : 'neutral', confidence: 'weak', key: O.mvrv,
        state: `MVRV ${fmtNum(O.mvrv, 2)} (realised price ≈${fmtPrice(O.realizedPrice)}); stablecoin supply ${fmtUsd(O.stables)} (${stab !== null ? fmtUsdSigned(stab * 1e9) : 'n/a'} 30d). Hash rate ${fmtPct(O.hashCh30d)} 30d; hashprice ${fmtPct(O.hashprice30d)} 30d.`,
        evidence: [
          { label: 'MVRV / realised price', value: `${fmtNum(O.mvrv, 2)} (${ordinal(O.mvrvPctile)} pct, ~1y) / ${fmtPrice(O.realizedPrice)}`, ...SRC(snap, 'coinmetrics') },
          { label: 'Stablecoin supply', value: `${fmtUsd(O.stables)}; 7d ${fmtUsd(O.stables7d)}, 30d ${fmtUsd(O.stables30d)}`, ...SRC(snap, 'defillama_stables') },
          { label: 'Mining', value: `${fmtNum(O.hashrateEhs, 0)} EH/s; next difficulty adj. ${fmtPct(O.nextAdjPct)}; hashprice ${O.hashprice ? '$' + fmtNum(O.hashprice, 0) + '/PH/day' : 'n/a'}`, ...SRC(snap, 'mempool') },
          O.exFlowNet7d !== null ? { label: 'Exchange net flow (7d) / exchange supply', value: `${O.exFlowNet7d > 0 ? '+' : ''}${fmtNum(O.exFlowNet7d, 0)} BTC net ${O.exFlowNet7d > 0 ? 'into' : 'out of'} exchanges; balance ${O.exSupply ? fmtNum(O.exSupply / 1e6, 2) + 'M BTC' : 'n/a'} (${fmtPct(O.exSupply30d)} 30d) — Coin Metrics entity heuristics`, ...SRC(snap, 'coinmetrics') } : { label: 'Exchange balances / LTH-STH / SOPR', value: 'Not available from free sources — see Data Coverage.', derived: true },
        ],
        mechanism: 'Stablecoin growth is dry powder on exchanges (and a crypto-native liquidity measure); MVRV shows how far price sits above the aggregate on-chain cost basis — high values mean more holders in profit and more potential distribution; near 1 means the market trades near cost. Miner economics matter when hashprice is squeezed and miners must sell inventory.',
        interpretation: `${stab !== null && stab > 3 ? 'Stablecoin liquidity is expanding — capital is entering the crypto system.' : stab !== null && stab < -2 ? 'Stablecoin supply is contracting — capital is leaving.' : 'Stablecoin liquidity is roughly flat.'} ${O.mvrv !== null && O.mvrv < 1.2 ? 'Price is near the on-chain cost basis — historically an area where long-term holders absorb supply.' : ''} On-chain supply is rarely the daily driver; it matters at extremes.`,
        invalidation: 'Stablecoin supply trend reversing; hashprice falling >20% (miner selling risk).',
        watch: 'Stablecoin mint/burn; difficulty adjustment; realised price as a deep support reference.',
      };
      Object.assign(f, changeText('onchain', f, (v) => 'MVRV ' + fmtNum(v, 2)));
      F.push(f);
    }
  }

  // 10 Risk appetite / correlation regime
  if (m.corr?.NDX) {
    const c = m.corr;
    const ndxMove = m.macro?.ndx20d ?? null;
    const f = {
      id: 'riskappetite', name: 'Equity risk appetite (correlation channel)', importance: clamp(10 + Math.abs(c.NDX.c30 ?? 0) * 50 + (ndxMove !== null ? Math.abs(ndxMove) * 2 : 0), 5, 80),
      direction: (c.NDX.c30 ?? 0) > 0.3 && ndxMove !== null ? (ndxMove > 2 ? 'bullish' : ndxMove < -2 ? 'bearish' : 'neutral') : 'neutral (weak link)', confidence: c.NDX.n30 >= 18 ? 'moderate' : 'weak', key: c.NDX.c30,
      state: `BTC behaves as: ${c.behaviour.label}. 30d corr — Nasdaq-100 ${fmtNum(c.NDX.c30)}, S&P ${fmtNum(c.SPX?.c30)}, gold ${fmtNum(c.GOLD?.c30)}, silver ${fmtNum(c.SILVER?.c30)}, dollar ${fmtNum(c.DXY?.c30)}, VIX ${fmtNum(c.VIX?.c30)}. 90d beta to Nasdaq ${fmtNum(c.NDX.beta90)}.`,
      evidence: [
        { label: 'Nasdaq-100 30d corr: now vs 30d ago', value: `${fmtNum(c.NDX.c30)} vs ${fmtNum(c.NDX.c30prev)}`, derived: true },
        { label: '90d correlations', value: Object.entries(c).filter(([k, v]) => v && v.c90 !== undefined).map(([k, v]) => `${k} ${fmtNum(v.c90)}`).join(' · '), derived: true },
      ],
      mechanism: 'When BTC trades as a high-beta risk asset, equity drawdowns force cross-asset de-risking (multi-asset funds, risk-parity, margin) that sells BTC regardless of crypto fundamentals. When decoupled, crypto-specific flows dominate. Correlation is a description of co-movement, not evidence of causation.',
      interpretation: c.behaviour.detail.length ? `Current behaviour: ${c.behaviour.detail.join('; ')}.` : 'No stable relationship — treat macro moves as a secondary input.',
      invalidation: 'A shift of more than ±0.3 in 30-day correlation.',
      watch: 'Nasdaq reaction to mega-cap earnings and macro releases; whether BTC follows equity moves on the day.',
    };
    Object.assign(f, changeText('riskappetite', f, (v) => 'corr ' + fmtNum(v)));
    F.push(f);
  }

  F.sort((a, b) => b.importance - a.importance);
  F.forEach((f, i) => { f.rank = i + 1; f.importance = Math.round(f.importance); });
  return F;
}
function unavailableForce(id, name, why) {
  return { id, name, importance: 0, direction: 'unknown', confidence: 'insufficient data', state: `Data unavailable: ${why}`, evidence: [], mechanism: '', interpretation: '', invalidation: '', watch: '', d1: '', d7: '', unavailable: true };
}

// ---------------------------------------------------------------------------
// LIQUIDITY / POSITIONING MAP
export function modelLiquidations(snap, m) {
  // MODEL ESTIMATE. Leverage added on days OI rose (OKX daily series, scaled to
  // aggregate OI) is assumed to sit at that day's close, split long/short by the
  // OKX account long/short ratio, across a fixed leverage mix. Positions whose
  // liquidation price was already crossed by the subsequent price path are removed.
  const oh = snap.derivs?.okxOiHistory || [];
  const ph = snap.priceHistory || [];
  if (oh.length < 10 || !ph.length || !m.derivs?.totalOi) return null;
  const scale = m.derivs.okx?.oi ? m.derivs.totalOi / m.derivs.okx.oi : 1;
  const priceMap = new Map(ph.map((r) => [r[0], r]));
  const ls = new Map((snap.derivs.okxLongShort || []).map(([d, r]) => [d, r]));
  const LEV = [[5, 0.25], [10, 0.35], [25, 0.25], [50, 0.15]];
  const mmr = 0.005;
  const out = [];
  const recent = oh.slice(-60);
  for (let i = 1; i < recent.length; i++) {
    const [d, oi] = recent[i];
    const dOi = (oi - recent[i - 1][1]) * scale;
    const pr = priceMap.get(d)?.[1];
    if (!(dOi > 0) || !pr) continue;
    const r = ls.get(d) ?? 1;
    const longShare = clamp(r / (1 + r), 0.3, 0.7);
    // price path since entry
    const path = ph.filter((x) => x[0] > d).map((x) => x[1]).concat(m.price.spot ? [m.price.spot] : []);
    const lo = path.length ? Math.min(...path) : pr, hi = path.length ? Math.max(...path) : pr;
    for (const [L, w] of LEV) {
      const longLiq = pr * (1 - 1 / L + mmr), shortLiq = pr * (1 + 1 / L - mmr);
      if (lo > longLiq) out.push({ side: 'long', price: longLiq, usd: dOi * longShare * w });
      if (hi < shortLiq) out.push({ side: 'short', price: shortLiq, usd: dOi * (1 - longShare) * w });
    }
  }
  return out;
}

export function buildLevelMap(snap, m) {
  const spot = m.price.spot;
  if (!spot) return null;
  const step = 5000;
  const lo = Math.max(step, Math.floor((spot * 0.72) / step) * step);
  const hi = Math.ceil((spot * 1.3) / step) * step;
  const levels = [];
  const liqs = modelLiquidations(snap, m) || [];
  const strikes = snap.options?.byStrike || [];
  const ph = snap.priceHistory || [];
  const year = ph.slice(-365);
  const bids = (snap.books?.venues || []).flatMap((v) => v.levels?.bids || []);
  const asks = (snap.books?.venues || []).flatMap((v) => v.levels?.asks || []);
  const etfBasis = m.etf?.flowBasis;
  const ma200 = m.price.ma200, realized = m.onchain?.realizedPrice;

  for (let L = hi; L >= lo; L -= step) {
    const a = L - step / 2, b = L + step / 2;
    const inB = (p) => p >= a && p < b;
    const isSpot = inB(spot);
    const above = L > spot;
    const book = isSpot ? sum(asks.filter(([p]) => inB(p)).map(([p, q]) => p * q)) + sum(bids.filter(([p]) => inB(p)).map(([p, q]) => p * q)) : above ? sum(asks.filter(([p]) => inB(p)).map(([p, q]) => p * q)) : sum(bids.filter(([p]) => inB(p)).map(([p, q]) => p * q));
    const bookCovered = (above ? asks : bids).some(([p]) => (above ? p >= a : p <= b)) && Math.abs(L - spot) / spot < 0.03 + step / 2 / spot;
    const opt = strikes.filter((s) => inB(s.strike));
    const callOi = sum(opt.map((s) => s.callOi)), putOi = sum(opt.map((s) => s.putOi)), gamma = sum(opt.map((s) => s.nearGammaUsd)), gammaAll = sum(opt.map((s) => s.gammaUsd));
    const lLong = sum(liqs.filter((x) => x.side === 'long' && inB(x.price)).map((x) => x.usd));
    const lShort = sum(liqs.filter((x) => x.side === 'short' && inB(x.price)).map((x) => x.usd));
    const days = year.filter((r) => inB(r[1])).length;
    const markers = [];
    if (etfBasis && inB(etfBasis)) markers.push(`ETF flow-weighted cost basis ≈${fmtPrice(etfBasis)}`);
    if (ma200 && inB(ma200)) markers.push(`200-day average ${fmtPrice(ma200)}`);
    if (realized && inB(realized)) markers.push(`On-chain realised price ${fmtPrice(realized)}`);
    if (m.price.high365 && inB(m.price.high365)) markers.push('12-month closing high');
    if (m.price.low365 && inB(m.price.low365)) markers.push('12-month closing low');
    if (spot >= a && spot < b) markers.push('SPOT');
    levels.push({ level: L, distPct: ((L - spot) / spot) * 100, above, isSpot, book, bookCovered, callOi, putOi, gamma, gammaAll, liqLong: lLong, liqShort: lShort, daysAtPrice: days, markers });
  }
  // classification relative to the distribution across levels
  const mx = (k) => Math.max(1, ...levels.map((l) => l[k]));
  const mLiqL = mx('liqLong'), mLiqS = mx('liqShort'), mOi = Math.max(1, ...levels.map((l) => l.callOi + l.putOi)), mDays = mx('daysAtPrice'), mG = mx('gamma');
  for (const l of levels) {
    const tags = [];
    const why = [];
    const oiRel = (l.callOi + l.putOi) / mOi;
    if (l.isSpot) {
      tags.push('current trading band');
      if (l.gamma / mG > 0.5) { tags.push('options strike: pin or acceleration'); why.push(`largest near-dated gamma is in the current band — dealer hedging can pin price here into expiry, or accelerate a break`); }
      if (l.book > 0) why.push(`${fmtUsd(l.book)} displayed bids+asks within this $5K band`);
    } else if (l.above) {
      if (l.liqShort / mLiqS > 0.5) { tags.push('potential short-squeeze zone'); why.push(`modelled short liquidations ≈${fmtUsd(l.liqShort)} — crossing forces short covering (market buys)`); }
      if (l.callOi / mOi > 0.5 && l.gamma / mG > 0.3) { tags.push('options strike: pin or acceleration'); why.push(`${fmtNum(l.callOi, 0)} BTC call OI; dealer hedging either pins price below (long gamma) or chases it through (short gamma)`); }
      if (l.daysAtPrice / mDays > 0.5) { tags.push('prior congestion: potential deceleration'); why.push(`${l.daysAtPrice} days traded here in the past year — trapped holders may sell at breakeven`); }
      if (l.daysAtPrice === 0 && l.liqShort / mLiqS < 0.2 && oiRel < 0.2 && l.distPct > 0) { tags.push('potential liquidity vacuum (upside)'); why.push('little historical trading, positioning or option interest — few natural sellers, price can travel quickly'); }
    } else {
      if (l.liqLong / mLiqL > 0.5) { tags.push('potential long-liquidation zone'); why.push(`modelled long liquidations ≈${fmtUsd(l.liqLong)} — crossing forces market selling`); }
      if (l.putOi / mOi > 0.5) { tags.push('put-strike hedging zone'); why.push(`${fmtNum(l.putOi, 0)} BTC put OI — short-gamma dealers would sell into a decline here`); }
      if (l.daysAtPrice / mDays > 0.5) { tags.push('prior congestion: potential support'); why.push(`${l.daysAtPrice} days traded here in the past year — buyers have historically been active`); }
      if (l.daysAtPrice === 0 && l.liqLong / mLiqL < 0.2 && oiRel < 0.2 && l.distPct < -1) { tags.push('potential liquidity vacuum (downside)'); why.push('little historical trading or positioning — few natural buyers, declines can gap'); }
    }
    if (l.markers.some((x) => x.startsWith('ETF'))) { tags.push('ETF cost-basis zone'); why.push('aggregate ETF holders near breakeven: a break below can turn holders into sellers (or attract defence)'); }
    if (!l.isSpot && l.book > 0 && l.bookCovered) why.push(`${fmtUsd(l.book)} displayed ${l.above ? 'asks' : 'bids'} in this $5K band`);
    const acc = tags.some((t) => /squeeze|liquidation|vacuum|acceleration/.test(t));
    const dec = tags.some((t) => /congestion|support|pin/.test(t));
    l.tags = tags.length ? tags : ['no notable structure'];
    l.why = why;
    l.crossing = l.isSpot ? 'n/a (spot is inside this band)' : acc && !dec ? (l.above ? 'likely to accelerate an advance' : 'likely to accelerate a decline') : dec && !acc ? 'likely to slow the move' : acc && dec ? 'two-sided: slows first, accelerates if broken' : 'neutral';
    l.etfContext = etfBasis ? `${l.level > etfBasis ? 'above' : 'below'} ETF flow-weighted basis (${fmtPrice(etfBasis)})` : 'ETF basis n/a';
  }
  return { step, spot, levels, liqModel: liqs.length ? { method: 'Model estimate — see methodology', positions: liqs.length } : null };
}

// ---------------------------------------------------------------------------
// SCENARIOS
export function buildScenarios(m, map) {
  const cond = (text, ok, value) => ({ text, status: ok === null || ok === undefined ? 'unknown' : ok ? 'met' : 'not met', value });
  const E = m.etf, D = m.derivs, dep = m.depth, O = m.options, M = m.macro;
  const spot = m.price.spot;
  const up = (map?.levels || []).filter((l) => l.above && !l.isSpot).reverse(); // nearest first
  const dn = (map?.levels || []).filter((l) => !l.above && !l.isSpot);
  const upAcc = up.find((l) => l.tags.some((t) => /squeeze|vacuum|acceleration/.test(t)));
  const upRes = up.find((l) => l.tags.some((t) => /congestion|pin/.test(t)));
  const dnAcc = dn.find((l) => l.tags.some((t) => /liquidation|vacuum|put/.test(t)));
  const dnSup = dn.find((l) => l.tags.some((t) => /support|ETF/.test(t)));
  const lvl = (l) => (l ? fmtK(l.level) : 'n/a');
  return [
    {
      id: 'up', name: 'Upside acceleration',
      first: [
        cond(`ETF 5-day net flows above +$${T.etf5dStrong}M and rising`, E ? E.s5 > T.etf5dStrong && E.accel > 0 : null, E ? fmtUsd(E.s5 * 1e6) : 'n/a'),
        cond('Funding still below 15% ann. (room for leverage to be added, not already crowded)', D?.fundingAnn !== null && D?.fundingAnn !== undefined ? D.fundingAnn < T.fundingHotAnn : null, D ? fmtNum(D.fundingAnn, 1) + '%' : 'n/a'),
        cond(`Price closes above the nearest resistance band ${lvl(upRes)} (upper edge ${upRes ? fmtPrice(upRes.level + 2500) : 'n/a'})`, upRes ? spot > upRes.level + 2500 : null, fmtPrice(spot)),
      ],
      confirm: ['Coinbase premium positive through US hours', 'OI rising alongside spot taker buying (not instead of it)', 'Short liquidations exceeding long liquidations', 'Ask-side depth thinning above spot as price approaches levels'],
      contradict: ['Rally on rising OI with funding >20% and no ETF inflows (leverage-only)', 'Call skew collapsing / IV falling during the rally', 'Dollar or real yields rising sharply'],
      levels: up.filter((l) => l.tags.some((t) => !/no notable/.test(t))).slice(0, 4).map((l) => ({ level: l.level, tags: l.tags })),
      mechanism: `Persistent ETF creations lift offers in thin books; crossing ${lvl(upAcc)} would force short covering (modelled short-liquidation band) and push short-gamma dealers to buy, converting a spot-led rise into a squeeze.`,
      failure: 'Inflows stall after a one-day print; leverage, not cash, carries price into resistance and the move reverses as late longs are liquidated.',
    },
    {
      id: 'base', name: 'Base case: range',
      first: [
        cond('ETF flows mixed (|5-day net| below $750M)', E ? Math.abs(E.s5) < T.etf5dStrong : null, E ? fmtUsd(E.s5 * 1e6) : 'n/a'),
        cond('Open interest stable (|7d change| below 8%)', D?.oiCh7d !== null && D?.oiCh7d !== undefined ? Math.abs(D.oiCh7d) < T.oi7dBuild : null, D ? fmtPct(D.oiCh7d) : 'n/a'),
        cond('Large option open interest near spot (pinning potential)', O?.topGamma?.[0] ? Math.abs(O.topGamma[0].strike - spot) / spot < 0.04 : null, O?.topGamma?.[0] ? fmtK(O.topGamma[0].strike) : 'n/a'),
      ],
      confirm: ['Implied volatility drifting lower', 'Funding oscillating around neutral', 'Depth stable or improving', 'Price rejected at both edges of the range'],
      contradict: ['A daily close outside the range with OI expanding', 'Sharp change in ETF flow direction lasting 3+ days'],
      levels: [upRes, dnSup].filter(Boolean).map((l) => ({ level: l.level, tags: l.tags })),
      mechanism: 'Offsetting flows and dealer hedging around large strikes absorb directional pressure; leverage is not large enough to force a break.',
      failure: 'A macro or flow shock arrives while depth is thin, pushing price through a range edge where positioning sits.',
    },
    {
      id: 'down', name: 'Downside acceleration',
      first: [
        cond('ETF flows turn to persistent outflows (5-day net negative, 3+ outflow days)', E ? E.s5 < 0 && E.streak <= -3 : null, E ? `${fmtUsd(E.s5 * 1e6)}, streak ${E.streak}` : 'n/a'),
        cond('±1% depth deteriorating (>15% lower than a week ago)', dep?.ch7d !== null && dep?.ch7d !== undefined ? dep.ch7d < T.depthDeteriorate7d : null, dep ? fmtPct(dep.ch7d) : 'n/a'),
        cond('Long leverage rebuilt (OI rising with positive funding)', D?.oiCh7d !== null && D?.oiCh7d !== undefined && D?.fundingAnn !== null ? D.oiCh7d > 0 && D.fundingAnn > 5 : null, D ? `${fmtPct(D.oiCh7d)} / ${fmtNum(D.fundingAnn, 1)}%` : 'n/a'),
        cond('Macro tightening impulse (real yields or dollar up sharply over 4w)', M ? (M.real10y20d ?? 0) > 0.2 || (M.dollar20d ?? 0) > 2 : null, M ? `${M.real10y20d !== null ? fmtNum(M.real10y20d * 100, 0) + 'bp' : 'n/a'} / ${fmtPct(M.dollar20d)}` : 'n/a'),
      ],
      confirm: ['Coinbase discount during US hours', 'OI falling fast while price falls (forced closing)', 'Put skew steepening and IV jumping', 'Bid depth withdrawing as price approaches modelled long-liquidation bands'],
      contradict: ['Price falling while OI is flat and funding negative (shorts already crowded)', 'ETF inflows on down days (dip buying)', 'Depth increasing into the decline'],
      levels: dn.filter((l) => l.tags.some((t) => !/no notable/.test(t))).slice(0, 4).map((l) => ({ level: l.level, tags: l.tags })),
      mechanism: `Spot selling (ETF redemptions) in thin books pushes price into ${lvl(dnAcc)}, where modelled long liquidations become forced market sells; makers widen quotes, depth falls further, and the cascade continues until leverage is exhausted — a reflexive liquidation chain.`,
      failure: 'Leverage is too small to cascade, or dip-buying (ETF creations, stablecoin deployment) absorbs the forced flow.',
    },
  ];
}

// ---------------------------------------------------------------------------
// WHAT CHANGED
// horizon 1 = since the previous daily observation; 7 = since the observation a week ago,
// each scored against the typical change over the same horizon in the stored history.
export function whatChanged(m, rows, horizon = 1) {
  const p = horizon === 7 ? m.prev7 : m.prev1;
  if (!p) return [{ text: horizon === 7 ? 'No observation from a week ago stored yet.' : 'No prior daily observation stored yet — change tracking begins with the next run.', weight: 0 }];
  const span = horizon === 7 ? 'typical 7-day change' : 'typical daily change';
  const out = [];
  const series = (k) => rows.map((r) => r[k]).filter((v) => v !== null && v !== undefined);
  const diffs = (k) => { const s = series(k); const d = []; for (let i = horizon; i < s.length; i++) d.push(s[i] - s[i - horizon]); return d; };
  const add = (k, now, label, fmt, why) => {
    if (now === null || now === undefined || p[k] === null || p[k] === undefined) return;
    const d = now - p[k];
    const sd = std(diffs(k));
    const z = sd ? d / sd : null;
    out.push({ key: k, label, from: fmt(p[k]), to: fmt(now), delta: d, z, horizon, weight: z !== null ? Math.abs(z) : Math.abs(d) > 0 ? 0.5 : 0, why, text: `${label}: ${fmt(p[k])} → ${fmt(now)}${z !== null ? ` (${fmtNum(z, 1)}σ vs ${span})` : ''}` });
  };
  add('price', m.price.spot, 'BTC price', fmtPrice, 'Price');
  add('depth1', m.depth?.venueSet === p.depthVenues ? m.depth?.d1 : null, '±1% depth', fmtUsd, 'Liquidity cushion');
  add('etf5d', m.etf?.s5, 'ETF 5-day net (US$m)', (v) => fmtUsd(v * 1e6), 'Spot demand via ETFs');
  add('oiTotal', m.derivs?.coverage === p.oiCoverage ? m.derivs?.totalOi : null, 'Aggregate OI', fmtUsd, 'Leverage stock');
  add('fundingAnn', m.derivs?.fundingAnn, 'Funding (ann.)', (v) => fmtNum(v, 1) + '%', 'Cost of leverage');
  add('iv30', m.options?.atmIv30, '30d ATM IV', (v) => fmtNum(v, 1) + '%', 'Expected volatility');
  add('skew', m.options?.skew25, '25Δ skew', (v) => fmtNum(v, 1), 'Hedging demand');
  add('dxy', m.macro?.dollar?.[1], m.macro?.dollarLabel || 'Dollar', (v) => fmtNum(v, 2), 'Dollar');
  add('real10y', m.macro?.real10y?.[1], '10y real yield', (v) => fmtNum(v, 2) + '%', 'Real rates');
  add('vix', m.macro?.vix?.[1], 'VIX', (v) => fmtNum(v, 1), 'Equity volatility');
  add('corrNdx30', m.corr?.NDX?.c30, 'BTC–Nasdaq 30d corr', (v) => fmtNum(v, 2), 'Macro linkage');
  add('stables', m.onchain?.stables, 'Stablecoin supply', fmtUsd, 'Crypto liquidity');
  add('mvrv', m.onchain?.mvrv, 'MVRV', (v) => fmtNum(v, 2), 'On-chain valuation');
  return out.sort((a, b) => b.weight - a.weight);
}

// ---------------------------------------------------------------------------
// TIMESERIES ROW (persisted daily, queried later)
export function makeRow(snap, m, extra = {}) {
  return {
    date: isoDate(snap.collectedAt),
    t: snap.collectedAt,
    price: m.price.spot, ch1d: m.price.ch24h, mcap: m.price.marketCap, rv30: m.price.rv30,
    depth05: m.depth?.d05 ?? null, depth1: m.depth?.d1 ?? null, depth2: m.depth?.d2 ?? null, depthBid1: m.depth?.bid1 ?? null, depthAsk1: m.depth?.ask1 ?? null, depthVenues: m.depth?.venueSet ?? null, depthTop2: m.depth?.top2Share ?? null,
    impactSell25: m.depth?.impact?.sell?.find((x) => x.sizeUsd === 25e6)?.slippagePct ?? null,
    impactSell100: m.depth?.impact?.sell?.find((x) => x.sizeUsd === 100e6)?.slippagePct ?? null,
    cbPremium: m.depth?.coinbasePremiumPct ?? null,
    etfDate: m.etf?.lastDate ?? null, etfLast: m.etf?.last ?? null, etf5d: m.etf?.s5 ?? null, etf20d: m.etf?.s20 ?? null,
    oiTotal: m.derivs?.totalOi ?? null, oiCoverage: m.derivs?.coverage ?? null, oiOkx: m.derivs?.okx?.oi ?? null, oiPctMcap: m.derivs?.oiPctMcap ?? null,
    fundingAnn: m.derivs?.fundingAnn ?? null, fundingDisp: m.derivs?.fundingDispersionBps ?? null, basisAnn: m.derivs?.basis?.annPct ?? null,
    liqLong: m.liq?.longUsd ?? null, liqShort: m.liq?.shortUsd ?? null,
    iv30: m.options?.atmIv30 ?? null, dvol: m.options?.dvol ?? null, skew: m.options?.skew25 ?? null, pcr: m.options?.pcRatio ?? null,
    netLiq: m.macro?.netLiq?.[1] ?? null, dxy: m.macro?.dollar?.[1] ?? null, us10y: m.macro?.us10y?.[1] ?? null, real10y: m.macro?.real10y?.[1] ?? null, hy: m.macro?.hy?.[1] ?? null, vix: m.macro?.vix?.[1] ?? null, ndx: m.macro?.ndx?.[1] ?? null, gold: m.macro?.gold?.[1] ?? null,
    corrNdx30: m.corr?.NDX?.c30 ?? null, corrGold30: m.corr?.GOLD?.c30 ?? null,
    mvrv: m.onchain?.mvrv ?? null, stables: m.onchain?.stables ?? null, dominance: m.structure?.dominance ?? null,
    curve: m.macro?.curve?.[1] ?? null, m2Yoy: m.macro?.m2Yoy?.[1] ?? null, cpiYoy: m.macro?.cpiYoy?.[1] ?? null,
    ls: m.derivs?.longShort?.okx ?? null, takerSpot7: m.derivs?.takerSpot7d ?? null,
    ...extra,
  };
}

// Reconstruct daily rows for past dates from series that carry history, so the
// archive is useful from day one. Fields that cannot be reconstructed (order-book
// depth, venue OI, options surface) remain null for backfilled dates.
export function backfillRows(snap) {
  const ph = snap.priceHistory || [];
  if (!ph.length) return [];
  const F = snap.macro?.fred || {}, Y = snap.macro?.markets || {};
  const etf = snap.etf?.daily || [];
  const etfMap = new Map(etf.map((r, i) => [r.date, i]));
  const oh = new Map((snap.derivs?.okxOiHistory || []).map(([d, o]) => [d, o]));
  const fd = new Map(dailyFunding(snap.derivs?.okxFundingHistory || []));
  const dv = new Map((snap.options?.dvolHistory || []).map(([d, v]) => [d, v]));
  const cm = snap.onchain?.coinmetrics?.series || {};
  const mv = new Map((cm.CapMVRVCur || []).map(([d, v]) => [d, v]));
  const st = new Map((snap.onchain?.stablecoins || []).map(([d, v]) => [d, v]));
  const ndx = Y.NDX || F.NASDAQCOM?.points || null;
  const btc = ph.map((r) => [r[0], r[1]]);
  const rows = [];
  for (let i = 1; i < ph.length; i++) {
    const [d, px, , mc] = ph[i];
    let e5 = null, e20 = null, eLast = null, eDate = null;
    // ETF: use flows reported up to and including the previous day (avoid look-ahead on the US close)
    const prior = etf.filter((r) => r.date < d);
    if (prior.length) {
      eDate = prior.at(-1).date; eLast = prior.at(-1).totalUsdM;
      e5 = sum(prior.slice(-5).map((r) => r.totalUsdM)); e20 = sum(prior.slice(-20).map((r) => r.totalUsdM));
    }
    const wal = valueAt(F.WALCL?.points, d), tga = valueAt(F.WTREGEN?.points, d), rrp = valueAt(F.RRPONTSYD?.points, d);
    let c30 = null;
    if (ndx && i > 45) { const a = alignedReturns(btc.slice(0, i + 1), ndx.filter(([x]) => x <= d), 30); c30 = pearson(a.ra, a.rb); }
    rows.push({
      date: d, t: d + 'T00:00:00Z', backfilled: true,
      price: px, ch1d: pct(px, ph[i - 1][1]), mcap: mc, rv30: realizedVol(ph.slice(0, i + 1).map((r) => r[1]), 30),
      etfDate: eDate, etfLast: eLast, etf5d: e5, etf20d: e20,
      oiOkx: oh.get(d) ?? null, oiTotal: null,
      fundingAnn: fd.get(d) ?? null,
      dvol: dv.get(d) ?? null,
      netLiq: wal !== null && tga !== null && rrp !== null ? wal - tga - rrp : null,
      dxy: valueAt(Y.DXY || F.DTWEXBGS?.points, d), us10y: valueAt(F.DGS10?.points, d), real10y: valueAt(F.DFII10?.points, d), hy: valueAt(F.BAMLH0A0HYM2?.points, d), vix: valueAt(Y.VIX || F.VIXCLS?.points, d),
      ndx: valueAt(ndx, d), gold: valueAt(Y.GOLD, d),
      corrNdx30: c30,
      mvrv: mv.get(d) ?? null, stables: st.get(d) ?? null,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// TOP-LEVEL
export function analyze(snap, rows = []) {
  const m = computeMetrics(snap, rows);
  const forces = buildForces(snap, m);
  const regime = classifyRegime(m);
  const attribution = { d1: attributeMove(m, '1d'), d7: attributeMove(m, '7d') };
  const map = buildLevelMap(snap, m);
  const scenarios = buildScenarios(m, map);
  const changes = whatChanged(m, rows);
  const changes7 = whatChanged(m, rows, 7);
  const top = forces.filter((f) => !f.unavailable).slice(0, 3).map((f) => ({ id: f.id, name: f.name, direction: f.direction, watch: f.watch, state: f.state }));
  const quality = Object.entries(snap.sources || {}).map(([id, s]) => ({ id, name: s.name, status: s.status, asOf: s.asOf || null, fetchedAt: s.fetchedAt, frequency: s.frequency, method: s.method, url: s.url, error: s.error || s.lastError || null, note: s.note || null, staleSince: s.staleSince || null }));
  const forceSummary = Object.fromEntries(forces.map((f) => [f.id, { direction: f.direction, importance: f.importance, key: f.key ?? null }]));
  let cycle = null;
  try { cycle = computeCycle(snap, m); } catch (e) { cycle = { error: String(e.message || e) }; }
  const cyOk = cycle && !cycle.error;
  const cyVal = (id) => (cyOk ? cycle.metrics.find((x) => x.id === id)?.value ?? null : null);
  const row = makeRow(snap, m, {
    regime: regime.primary, move1d: attribution.d1.label, move7d: attribution.d7.label, forces: forceSummary,
    cycleScore: cyOk ? cycle.valuation.score : null, cycleZone: cyOk ? cycle.valuation.zone?.label ?? null : null, momentumScore: cyOk ? cycle.momentum.score : null,
    nupl: cyVal('nupl'), mayer: cyVal('mayer'), puell: cyVal('puell'), sopr7: cyVal('sopr'), supplyProfitPct: cyVal('profit'),
  });
  if (cyOk) cycle.watch = cycleWatch(cycle, m.prev1);
  return {
    engine: ENGINE_VERSION,
    generatedAt: new Date().toISOString(),
    dataThrough: snap.collectedAt,
    scope: snap.scope,
    metrics: stripHeavy(m),
    regime, attribution, forces, map, scenarios, changes, changes7, top, cycle,
    quality, unavailable: UNAVAILABLE,
    row,
  };
}
function stripHeavy(m) {
  const { prev1, prev7, prev30, ...rest } = m;
  return { ...rest, prevDates: { d1: prev1?.date ?? null, d7: prev7?.date ?? null, d30: prev30?.date ?? null } };
}
