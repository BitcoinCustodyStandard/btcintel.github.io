// On-chain Cycle & Momentum. Where BTC sits in the on-chain valuation cycle and whether
// momentum is constructive, neutral or weakening. Positioning research, not a signal.
//
// Everything is rule-based and published on the page: each metric maps to a zone with a
// fixed score; the composite is the plain average of the scored valuation inputs. Metrics
// that carry the same information as another (NUPL and distance-to-realised-price are both
// functions of MVRV) are shown for context but scored once, through MVRV.

import { mean, pct, percentileRank, valueAt, fmtUsd, fmtUsdSigned, fmtPct, fmtNum, fmtK, DAY } from './util.js';

// ---------- zone tables (lower bound inclusive) ----------
// tone: bull | neu | warn | bear — the same colour language as the rest of the product.
const Z = (min, label, score, tone) => ({ min, label, score, tone });
export const ZONES = {
  mvrv: [Z(-Infinity, 'Deep value', 2, 'bull'), Z(1.0, 'Value', 1, 'bull'), Z(1.5, 'Neutral / mid-cycle', 0, 'neu'), Z(2.4, 'Elevated', -1, 'warn'), Z(3.2, 'Euphoria', -2, 'bear')],
  mayer: [Z(-Infinity, 'Deep value', 2, 'bull'), Z(0.8, 'Value', 1, 'bull'), Z(1.0, 'Neutral', 0, 'neu'), Z(1.5, 'Elevated', -1, 'warn'), Z(2.4, 'Euphoria', -2, 'bear')],
  puell: [Z(-Infinity, 'Miner capitulation', 2, 'bull'), Z(0.5, 'Low miner revenue', 1, 'bull'), Z(0.8, 'Normal', 0, 'neu'), Z(1.5, 'Elevated', -1, 'warn'), Z(2.5, 'Miner euphoria', -2, 'bear')],
  sopr: [Z(-Infinity, 'Loss realisation', 1, 'bull'), Z(0.98, 'Near breakeven', 0, 'neu'), Z(1.03, 'Heavy profit-taking', -1, 'warn')],
  profit: [Z(-Infinity, 'Deep value', 2, 'bull'), Z(55, 'Value', 1, 'bull'), Z(70, 'Neutral', 0, 'neu'), Z(90, 'Elevated', -1, 'warn'), Z(97, 'Euphoria', -2, 'bear')],
  nupl: [Z(-Infinity, 'Capitulation', null, 'bull'), Z(0, 'Hope / Fear', null, 'bull'), Z(0.25, 'Optimism / Anxiety', null, 'neu'), Z(0.5, 'Belief / Denial', null, 'warn'), Z(0.75, 'Euphoria / Greed', null, 'bear')],
  composite: [Z(-Infinity, 'Euphoria / stretched', -2, 'bear'), Z(-1.25, 'Elevated', -1, 'warn'), Z(-0.5, 'Neutral / mid-cycle', 0, 'neu'), Z(0.5, 'Value', 1, 'bull'), Z(1.25, 'Deep value', 2, 'bull')],
};
const zoneOf = (table, v) => (v === null || v === undefined || !Number.isFinite(v) ? null : [...table].reverse().find((z) => v >= z.min));
const nextZones = (table, v) => { if (zoneOf(table, v) === null) return { below: null, above: null }; const i = table.findIndex((z) => z === zoneOf(table, v)); return { below: i > 0 ? { at: table[i].min, zone: table[i - 1] } : null, above: i < table.length - 1 ? { at: table[i + 1].min, zone: table[i + 1] } : null }; };

export const LEANING = {
  'Deep value': 'Historically a long-horizon accumulation zone',
  Value: 'Historically favourable for long-horizon holders',
  'Neutral / mid-cycle': 'Neutral — no valuation edge either way',
  Elevated: 'Historically a zone for caution',
  'Euphoria / stretched': 'Historically high risk',
};

const FRESH_DAYS = 3;   // older than this (or provider-flagged) = "delayed"
const sma = (arr, n) => (arr.length >= n ? mean(arr.slice(-n)) : null);

export function computeCycle(snap, m) {
  const cm = snap.onchain?.coinmetrics?.series || {};
  const bg = snap.onchain?.bgeo || null;
  const src = snap.sources || {};
  const today = String(snap.collectedAt).slice(0, 10);
  const ageDays = (d) => (d ? Math.round((new Date(today) - new Date(d)) / DAY) : null);
  const status = (srcId, d, providerDelayed) => {
    const s = src[srcId]?.status;
    if (!d || s === 'error' || s === undefined) return 'unavailable';
    if (s === 'stale') return 'carried';
    return providerDelayed || ageDays(d) > FRESH_DAYS ? 'delayed' : 'live';
  };
  const P = m.price, spot = P.spot;
  const metrics = [];
  const add = (x) => { metrics.push(x); return x; };

  // 1. MVRV (Coin Metrics)
  const mvS = cm.CapMVRVCur || [];
  const mvrv = mvS.at(-1)?.[1] ?? null, mvDate = mvS.at(-1)?.[0] ?? null;
  const realized = m.onchain?.realizedPrice ?? null;
  const weekly = snap.onchain?.coinmetrics?.mvrvWeekly || null;
  const hist = weekly?.length ? weekly.map((r) => r[1]) : mvS.map((r) => r[1]);
  const histFrom = weekly?.length ? weekly[0][0].slice(0, 4) : mvS[0]?.[0]?.slice(0, 4);
  const mvPct = mvrv !== null ? percentileRank(mvrv, hist) : null;
  const mv30 = mvS.length > 30 ? mvS.at(-31)[1] : null;
  const mvZ = zoneOf(ZONES.mvrv, mvrv);
  const priceAt = (mult) => (realized ? fmtK(realized * mult) : null);
  const mvN = nextZones(ZONES.mvrv, mvrv);
  add({
    id: 'mvrv', name: 'MVRV ratio', group: 'valuation', scored: true,
    value: mvrv, display: fmtNum(mvrv, 2), zone: mvZ,
    meaning: mvrv !== null ? `Market value is ${fmtNum(mvrv, 2)}× the aggregate on-chain cost basis — the average coin sits ${mvrv >= 1 ? 'at a ' + fmtPct((mvrv - 1) * 100, 0, false) + ' unrealised gain' : 'at a ' + fmtPct((1 - mvrv) * 100, 0, false) + ' unrealised loss'}.` : null,
    move: [mvN.below && `below ${mvN.below.at} → ${mvN.below.zone.label}${priceAt(mvN.below.at) ? ` (≈ price ${priceAt(mvN.below.at)} at today’s realised price)` : ''}`, mvN.above && `above ${mvN.above.at} → ${mvN.above.zone.label}${priceAt(mvN.above.at) ? ` (≈ ${priceAt(mvN.above.at)})` : ''}`].filter(Boolean),
    context: mvPct !== null ? `${Math.round(mvPct)}th percentile of all readings since ${histFrom}; 30 days ago ${fmtNum(mv30, 2)}.` : null,
    source: 'Coin Metrics Community (CapMVRVCur)', asOf: mvDate, status: status('coinmetrics', mvDate),
  });

  // 2. NUPL — derived exactly as 1 − 1/MVRV; context only (same information as MVRV)
  const nupl = mvrv ? 1 - 1 / mvrv : null;
  const nZ = zoneOf(ZONES.nupl, nupl);
  const rising = mvrv !== null && mv30 !== null ? mvrv >= mv30 : null;
  const phase = nZ ? (nZ.label.includes(' / ') ? nZ.label.split(' / ')[rising === false ? 1 : 0] : nZ.label) : null;
  const nN = nextZones(ZONES.nupl, nupl);
  add({
    id: 'nupl', name: 'NUPL (derived)', group: 'context', scored: false,
    value: nupl, display: fmtNum(nupl, 2), zone: nZ && { ...nZ, label: nZ.label },
    meaning: nupl !== null ? `Unrealised profit equals ${fmtPct(nupl * 100, 0, false)} of market cap. Classic cycle phase: ${phase}${rising === null ? '' : rising ? ' (MVRV rising over 30d)' : ' (MVRV falling over 30d)'}.` : null,
    move: [nN.below && `below ${nN.below.at} (MVRV ${fmtNum(1 / (1 - nN.below.at), 2)}) → ${nN.below.zone.label}`, nN.above && `above ${nN.above.at} (MVRV ${fmtNum(1 / (1 - nN.above.at), 2)}) → ${nN.above.zone.label}`].filter(Boolean),
    context: 'Not scored separately: NUPL is a direct transform of MVRV.',
    source: 'Derived from Coin Metrics MVRV: NUPL = 1 − 1/MVRV', asOf: mvDate, status: status('coinmetrics', mvDate), derived: true,
  });

  // 3. Distance to realised price — context only (= MVRV − 1 at the same date)
  const dist = realized && spot ? pct(spot, realized) : null;
  add({
    id: 'realized', name: 'Distance to realised price', group: 'context', scored: false,
    value: dist, display: dist !== null ? fmtPct(dist, 0) : 'n/a', zone: zoneOf(ZONES.mvrv, realized && spot ? spot / realized : null),
    meaning: realized ? `Realised price (aggregate on-chain cost basis per coin) is $${Math.round(realized).toLocaleString('en-US')} — historically a deep-support reference in bear phases.` : null,
    move: realized ? [`A revisit of ${fmtK(realized)} would put MVRV at 1.0 (Value / Deep value boundary).`] : [],
    context: 'Not scored separately: equivalent to MVRV at spot.',
    source: 'Spot (CoinGecko) ÷ realised price (Coin Metrics price ÷ MVRV)', asOf: mvDate, status: status('coinmetrics', mvDate), derived: true,
  });

  // 4. Mayer Multiple — price ÷ 200-day average (trend/valuation), scored
  const mayer = P.ma200 && spot ? spot / P.ma200 : null;
  const myZ = zoneOf(ZONES.mayer, mayer), myN = nextZones(ZONES.mayer, mayer);
  add({
    id: 'mayer', name: 'Mayer Multiple', group: 'valuation', scored: true,
    value: mayer, display: fmtNum(mayer, 2), zone: myZ,
    meaning: mayer !== null ? `Price is ${fmtPct(Math.abs(mayer - 1) * 100, 0, false)} ${mayer >= 1 ? 'above' : 'below'} its 200-day average (${fmtK(P.ma200)}).` : null,
    move: [myN.below && `below ${myN.below.at} (≈ ${fmtK(P.ma200 * myN.below.at)}) → ${myN.below.zone.label}`, myN.above && `above ${myN.above.at} (≈ ${fmtK(P.ma200 * myN.above.at)}) → ${myN.above.zone.label}`].filter(Boolean),
    context: '2.4 is the long-standing historical “overheated” threshold.',
    source: 'CoinGecko daily closes (200-day average) and spot', asOf: snap.priceHistory?.at(-1)?.[0] ?? null, status: status(src.coingecko_hist ? 'coingecko_hist' : 'coinbase_hist', snap.priceHistory?.at(-1)?.[0]), derived: true,
  });

  // 5. Puell Multiple — derived: daily issuance USD ÷ its 365-day average, scored
  let puell = null, puellDate = null, puellHist = [];
  if (cm.IssTotNtv && cm.PriceUSD) {
    const px = new Map(cm.PriceUSD);
    const iss = cm.IssTotNtv.map(([d, v]) => [d, px.has(d) ? v * px.get(d) : null]).filter(([, v]) => v !== null);
    for (let i = 364; i < iss.length; i++) puellHist.push([iss[i][0], iss[i][1] / mean(iss.slice(i - 364, i + 1).map((r) => r[1]))]);
    if (puellHist.length) [puellDate, puell] = puellHist.at(-1);
  }
  const puN = nextZones(ZONES.puell, puell);
  add({
    id: 'puell', name: 'Puell Multiple (derived)', group: 'valuation', scored: puell !== null,
    value: puell, display: fmtNum(puell, 2), zone: zoneOf(ZONES.puell, puell),
    meaning: puell !== null ? `Miners’ daily issuance revenue is ${fmtNum(puell, 2)}× its one-year average${puell < 0.8 ? ' — miner revenue is depressed' : puell > 1.5 ? ' — miners are earning well above normal' : ' — within its normal range'}.` : null,
    move: [puN.below && `below ${puN.below.at} → ${puN.below.zone.label}`, puN.above && `above ${puN.above.at} → ${puN.above.zone.label}`].filter(Boolean),
    context: 'Issuance halves every ~4 years; for a year after a halving the multiple reads low mechanically.',
    source: 'Derived from Coin Metrics IssTotNtv × PriceUSD', asOf: puellDate, status: puell === null ? 'unavailable' : status('coinmetrics', puellDate), derived: true,
    unavailableWhy: puell === null ? 'Needs 365+ days of Coin Metrics issuance and price history.' : null,
  });

  // 6. SOPR — BGeometrics, 7-day average, scored
  const sp = bg?.sopr || [];
  const sopr7 = sp.length >= 7 ? mean(sp.slice(-7).map((r) => r[1])) : null;
  const soprDate = sp.at(-1)?.[0] ?? null;
  const soN = nextZones(ZONES.sopr, sopr7);
  add({
    id: 'sopr', name: 'SOPR (7-day average)', group: 'valuation', scored: sopr7 !== null,
    value: sopr7, display: fmtNum(sopr7, 3), zone: zoneOf(ZONES.sopr, sopr7),
    meaning: sopr7 !== null ? `Coins moved on-chain are being sold at ${sopr7 >= 1 ? 'an average ' + fmtPct((sopr7 - 1) * 100, 1, false) + ' profit' : 'an average ' + fmtPct((1 - sopr7) * 100, 1, false) + ' loss'} versus their acquisition price.` : null,
    move: [soN.below && `below ${soN.below.at} → ${soN.below.zone.label}`, soN.above && `above ${soN.above.at} → ${soN.above.zone.label}`].filter(Boolean),
    context: 'In uptrends, SOPR dipping below 1 and recovering has historically marked reset points.',
    source: 'BGeometrics free API (sopr)', asOf: soprDate, status: sopr7 === null ? 'unavailable' : status('bgeometrics', soprDate, bg?.soprDelayed),
    delayNote: bg?.soprDelayed ? 'Free tier withholds the latest ~7 days.' : null,
    unavailableWhy: sopr7 === null ? 'BGeometrics free tier did not return SOPR (rate limit or outage). Coming back automatically on the next successful fetch.' : null,
  });

  // 7. % supply in profit — BGeometrics BTC in profit ÷ Coin Metrics supply, scored
  const spP = bg?.supplyProfit || [];
  const profitDate = spP.at(-1)?.[0] ?? null;
  const supplyAt = profitDate && cm.SplyCur ? valueAt(cm.SplyCur, profitDate) : null;
  const profitPct = spP.length && supplyAt ? (spP.at(-1)[1] / supplyAt) * 100 : null;
  const prN = nextZones(ZONES.profit, profitPct);
  add({
    id: 'profit', name: '% supply in profit', group: 'valuation', scored: profitPct !== null,
    value: profitPct, display: profitPct !== null ? fmtNum(profitPct, 1) + '%' : 'n/a', zone: zoneOf(ZONES.profit, profitPct),
    meaning: profitPct !== null ? `${fmtNum(profitPct, 0)}% of circulating BTC last moved at a lower price than today’s.` : null,
    move: [prN.below && `below ${prN.below.at}% → ${prN.below.zone.label}`, prN.above && `above ${prN.above.at}% → ${prN.above.zone.label}`].filter(Boolean),
    context: 'Bear-market lows have historically coincided with roughly half of supply in profit; bull phases hold above 90%.',
    source: 'BGeometrics free API (supply-profit, BTC) ÷ Coin Metrics SplyCur', asOf: profitDate, status: profitPct === null ? 'unavailable' : status('bgeometrics', profitDate, bg?.supplyProfitDelayed), derived: true,
    delayNote: bg?.supplyProfitDelayed ? 'Free tier withholds the latest ~7 days.' : null,
    unavailableWhy: profitPct === null ? 'BGeometrics free tier did not return supply in profit, or Coin Metrics supply was unavailable.' : null,
  });

  // 8. Hash Ribbons — derived 30d vs 60d SMA of hash rate; scored only on a recovery cross
  const hr = cm.HashRate || [];
  let ribbon = null, ribbonDate = hr.at(-1)?.[0] ?? null;
  if (hr.length >= 90) {
    const v = hr.map((r) => r[1]);
    const state = (k) => { const a = sma(v.slice(0, v.length - k), 30), b = sma(v.slice(0, v.length - k), 60); return a !== null && b !== null ? a >= b : null; };
    const up = state(0);
    let capDays = 0, crossedAgo = null;
    for (let k = 0; k < 60; k++) { const s = state(k); if (s === false) { capDays++; if (crossedAgo === null && k > 0 && state(k - 1) === true) crossedAgo = k; } }
    const recovery = up && crossedAgo !== null && crossedAgo <= 20 && capDays >= 10;
    ribbon = { up, recovery, s30: sma(v, 30), s60: sma(v, 60), label: !up ? 'Capitulation' : recovery ? 'Recovery' : 'Healthy', score: recovery ? 1 : 0, tone: !up ? 'warn' : 'bull' };
  }
  add({
    id: 'hashribbons', name: 'Hash Ribbons (derived)', group: 'miner', scored: ribbon !== null,
    value: ribbon ? ribbon.s30 / ribbon.s60 : null, display: ribbon ? ribbon.label : 'n/a', zone: ribbon && { label: ribbon.label, score: ribbon.score, tone: ribbon.tone },
    meaning: ribbon ? (ribbon.up ? `30-day average hash rate is ${fmtPct((ribbon.s30 / ribbon.s60 - 1) * 100, 1)} vs the 60-day — miners are not under stress.` : `30-day average hash rate is below the 60-day — miners are switching off (capitulation).`) : null,
    move: ribbon ? [ribbon.up ? '30-day average falling below the 60-day → Capitulation' : '30-day average crossing back above the 60-day → Recovery (historically constructive)'] : [],
    context: 'Scored +1 only on a recovery cross after ≥10 days of capitulation; otherwise 0.',
    source: 'Derived from Coin Metrics HashRate (30d vs 60d average)', asOf: ribbonDate, status: ribbon ? status('coinmetrics', ribbonDate) : 'unavailable', derived: true,
  });

  // 9. Stablecoin supply trend — liquidity, part of momentum
  const st = snap.onchain?.stablecoins || [];
  const st30 = st.length > 30 ? pct(st.at(-1)[1], st.at(-31)[1]) : null;
  const stZ = st30 === null ? null : st30 > 1 ? { label: 'Expanding', score: 1, tone: 'bull' } : st30 < -1 ? { label: 'Contracting', score: -1, tone: 'bear' } : { label: 'Flat', score: 0, tone: 'neu' };
  add({
    id: 'stables', name: 'Stablecoin supply trend', group: 'momentum', scored: st30 !== null,
    value: st30, display: st30 !== null ? fmtPct(st30, 1) + ' 30d' : 'n/a', zone: stZ,
    meaning: st30 !== null ? `USD stablecoin supply is ${fmtUsd(st.at(-1)[1], 1)} (${fmtUsdSigned(st.at(-1)[1] - st.at(-31)[1], 1)} in 30 days) — dry powder that can be deployed into crypto.` : null,
    move: ['above +1% in 30d → Expanding · below −1% → Contracting'],
    context: null,
    source: 'DefiLlama stablecoins', asOf: st.at(-1)?.[0] ?? null, status: status('defillama_stables', st.at(-1)?.[0]),
  });

  // ---------- composite valuation (mean of scored valuation inputs) ----------
  const valInputs = metrics.filter((x) => x.group === 'valuation' && x.scored && x.zone && x.status !== 'unavailable');
  const valScore = valInputs.length >= 3 ? mean(valInputs.map((x) => x.zone.score)) : null;
  const comp = zoneOf(ZONES.composite, valScore);

  // ---------- momentum (each −1 / 0 / +1) ----------
  const ph = snap.priceHistory || [];
  const closes = ph.map((r) => r[1]);
  const ma200ago = closes.length >= 230 ? mean(closes.slice(-230, -30)) : null;
  const slope = P.ma200 && ma200ago ? pct(P.ma200, ma200ago) : null;
  const mv365 = mvS.length >= 365 ? mean(mvS.slice(-365).map((r) => r[1])) : null;
  const mom = [
    { id: 'aboveMa', name: 'Price vs 200-day average', value: mayer !== null ? fmtPct((mayer - 1) * 100, 0) : 'n/a', score: mayer === null ? null : mayer >= 1 ? 1 : -1, rule: 'above +1 · below −1' },
    { id: 'maSlope', name: '200-day average, 30-day slope', value: slope !== null ? fmtPct(slope, 1) : 'n/a', score: slope === null ? null : slope > 1 ? 1 : slope < -1 ? -1 : 0, rule: 'rising >1% +1 · falling >1% −1 · else 0' },
    { id: 'mvrvTrend', name: 'MVRV vs its 365-day average', value: mv365 ? `${fmtNum(mvrv, 2)} vs ${fmtNum(mv365, 2)}` : 'n/a', score: mv365 === null || mvrv === null ? null : mvrv >= mv365 ? 1 : -1, rule: 'above +1 · below −1' },
    { id: 'stables', name: 'Stablecoin supply, 30d', value: st30 !== null ? fmtPct(st30, 1) : 'n/a', score: stZ?.score ?? null, rule: '> +1% +1 · < −1% −1 · else 0' },
  ];
  const momIn = mom.filter((x) => x.score !== null);
  const momScore = momIn.length >= 3 ? momIn.reduce((a, b) => a + b.score, 0) : null;
  const momLabel = momScore === null ? null : momScore >= 2 ? 'Constructive' : momScore <= -2 ? 'Weakening' : 'Neutral';
  const momTone = momLabel === 'Constructive' ? 'bull' : momLabel === 'Weakening' ? 'bear' : 'neu';
  const stretched = valScore !== null && valScore <= -0.5 && momLabel === 'Constructive';

  // ---------- executive summary ----------
  const g = (id) => metrics.find((x) => x.id === id);
  const asOfTxt = (x) => (x.status === 'delayed' ? `; as of ${x.asOf}, delayed` : '');
  const bullets = [];
  if (mvrv !== null) bullets.push(`MVRV ${fmtNum(mvrv, 2)} — ${mvZ.label.toLowerCase()}; NUPL ${fmtNum(nupl, 2)} puts the market in the “${phase}” phase.`);
  if (dist !== null && mayer !== null) bullets.push(`Price is ${fmtPct(Math.abs(dist), 0, false)} ${dist >= 0 ? 'above' : 'below'} the realised price (${fmtK(realized)}) and ${fmtPct(Math.abs(mayer - 1) * 100, 0, false)} ${mayer >= 1 ? 'above' : 'below'} its 200-day average (Mayer ${fmtNum(mayer, 2)}).`);
  const calm = ['puell', 'sopr', 'profit'].map(g).filter((x) => x && x.status !== 'unavailable');
  if (calm.length) bullets.push(calm.map((x) => `${x.name.replace(/ \(.*\)/, '')} ${x.display} (${x.zone.label.toLowerCase()}${asOfTxt(x)})`).join('; ') + '.');
  const MOM_TXT = { aboveMa: ['price above its 200-day average', 'price below its 200-day average'], maSlope: ['200-day average rising', '200-day average falling'], mvrvTrend: ['MVRV above its one-year average', 'MVRV below its one-year average'], stables: ['stablecoin supply expanding', 'stablecoin supply contracting'] };
  if (momLabel) bullets.push(`Momentum ${momLabel.toLowerCase()} (${momScore > 0 ? '+' : ''}${momScore} on a −${momIn.length}…+${momIn.length} scale): ${momIn.filter((x) => x.score !== 0).map((x) => MOM_TXT[x.id][x.score > 0 ? 0 : 1]).join(', ') || 'mixed inputs'}.`);

  const comingSoon = [
    { name: 'Long- / short-term holder MVRV and supply', why: 'Requires cohort (UTXO-age) data; not in the free Coin Metrics or BGeometrics tiers.' },
    { name: 'Reserve Risk, RHODL, Liveliness', why: 'Require coin-days-destroyed history beyond free tiers.' },
    { name: 'Real-time SOPR / supply in profit (last 7 days)', why: 'BGeometrics free tier withholds the most recent ~7 days on some metrics.' },
  ];

  return {
    asOf: mvDate,
    phase: phase ? { label: phase, zone: nZ.label, nupl, rising } : null,
    valuation: { score: valScore, n: valInputs.length, zone: comp, leaning: comp ? LEANING[comp.label] : null, inputs: valInputs.map((x) => ({ id: x.id, name: x.name, score: x.zone.score, zone: x.zone.label })) },
    momentum: { score: momScore, n: momIn.length, label: momLabel, tone: momTone, components: mom },
    stretched,
    headline: comp ? `${phase ? phase + ' · ' : ''}${comp.label}${momLabel ? ` · momentum ${momLabel.toLowerCase()}` : ''}` : 'Insufficient on-chain inputs',
    bullets,
    metrics,
    comingSoon,
    charts: {
      mvrv: weekly?.length ? weekly : mvS,
      puell: puellHist.filter((_, i, a) => i % 2 === (a.length - 1) % 2),
      sopr: sp.map(([d], i) => (i >= 6 ? [d, mean(sp.slice(i - 6, i + 1).map((r) => r[1]))] : null)).filter(Boolean),
      profit: spP.map(([d, v]) => { const s = cm.SplyCur ? valueAt(cm.SplyCur, d) : null; return s ? [d, (v / s) * 100] : null; }).filter(Boolean),
    },
  };
}

// Cycle watch items: a zone change since the previous observation, or a scored metric
// within a metric-specific distance of a zone boundary (absolute units of that metric).
// Used by the overview's "things to watch".
const NEAR = { mvrv: 0.05, mayer: 0.03, puell: 0.05, sopr: 0.005, profit: 1.5 };
export function cycleWatch(cy, prevRow) {
  if (!cy) return [];
  const out = [];
  const z = cy.valuation.zone?.label;
  if (z && prevRow?.cycleZone && prevRow.cycleZone !== z) out.push({ what: `On-chain zone change: ${prevRow.cycleZone} → ${z}`, why: 'First change in the composite valuation zone since the previous observation.', kind: 'zone' });
  for (const x of cy.metrics.filter((y) => y.scored && y.value !== null && y.status !== 'unavailable')) {
    const tbl = ZONES[x.id], tol = NEAR[x.id];
    if (!tbl || !tol) continue;
    for (const b of tbl.slice(1).map((t) => t.min)) {
      if (Math.abs(x.value - b) <= tol) {
        const i = tbl.findIndex((t) => t.min === b);
        const other = x.value >= b ? tbl[i - 1] : tbl[i];
        out.push({ what: `${x.name.replace(/ \(.*\)/, '')} near a zone boundary`, why: `${x.display} vs the ${b}${x.id === 'profit' ? '%' : ''} line — crossing it moves the reading from ${x.zone.label} to ${other.label}.`, kind: 'near' });
        break;
      }
    }
  }
  return out;
}
