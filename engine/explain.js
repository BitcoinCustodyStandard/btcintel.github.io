// Plain-English explanations behind the "i" icons. Each entry has the same shape:
//   what    — what the number measures (1–2 sentences, any jargon explained inline)
//   why     — why it matters for the cycle or short-term behaviour
//   now(a)  — how to read today's reading/zone, built from the analysis (no new figures)
//   history — one sentence of historical context (optional)
//   caveat  — data or interpretation limits (optional)
// Rendered as 3–5 short sentences; entries that describe cycle zones end with the
// standard reminder. Tone: calm, educational, never predictive.

import { fmtNum, fmtPct, fmtUsd, fmtUsdSigned, fmtK } from './util.js';
import { macroTransmission } from './analyze.js';
import { ZONES } from './cycle.js';
import { DASH_EXPLAIN } from './explain_dash.js';

export const REMINDER = 'This is historical context, not a prediction.';

const cyM = (a, id) => a.cycle?.metrics?.find((x) => x.id === id);
const force = (a, id) => a.forces?.find((f) => f.id === id);
// "1.5–2.4" style range of the zone a value sits in
function range(table, label, unit = '') {
  const i = table.findIndex((z) => z.label === label);
  if (i < 0) return '';
  return i === 0 ? `below ${table[1].min}${unit}` : i === table.length - 1 ? `${table[i].min}${unit} and above` : `${table[i].min}–${table[i + 1].min}${unit}`;
}
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const linkWeak = (a) => { const t = macroTransmission(a.metrics || {}); return t.link !== null && t.link < 0.2; };
function zoneNow(a, id, table, neutralMeaning) {
  const x = cyM(a, id);
  if (!x?.zone || x.value === null) return null;
  const mean = x.zone.score === 0 ? neutralMeaning : x.zone.score > 0 ? 'historically on the cheaper side' : 'historically on the expensive side';
  return `Today’s ${x.display} is “${x.zone.label}” (${range(table, x.zone.label, id === 'profit' ? '%' : '')}): ${mean}.`;
}
function scenNow(a, i) {
  const s = a.scenarios?.[i];
  if (!s) return null;
  const met = s.first.filter((c) => c.status === 'met').length;
  return `Conditions met today: ${met} of ${s.first.length}.`;
}
const ZONE_MEANS = {
  mvrv: { 'Deep value': 'the average holder is at a loss — historically where long cycles have bottomed', Value: 'holders are only modestly in profit', 'Neutral / mid-cycle': 'a moderate profit — not cheap, but well short of the extremes seen at past tops', Elevated: 'large unrealised profits, which have historically encouraged selling', Euphoria: 'very large unrealised profits, the level seen near past cycle tops' },
  nupl: { Capitulation: 'the average holder is underwater', 'Hope / Fear': 'holders are back to small profits', 'Optimism / Anxiety': 'holders are in profit, but not euphoric', 'Belief / Denial': 'profits are large and confidence is high', 'Euphoria / Greed': 'profits are extreme' },
  sopr: { 'Loss realisation': 'sellers are, on average, locking in losses — often a sign of capitulation or shake-outs', 'Near breakeven': 'a balance point where neither profit-taking nor panic selling dominates', 'Heavy profit-taking': 'sellers are locking in sizeable profits' },
};

export const EXPLAIN = {
  picycle: {
    title: 'Pi Cycle Top Indicator',
    what: 'Two moving averages of Bitcoin’s daily price: the 111-day average and twice the 350-day average.',
    why: 'When the faster 111-day line crosses above the slower (×2) line, it has historically coincided with major cycle tops within a few days.',
    history: 'The name comes from the ratio 350 ÷ 111 ≈ 3.15, which is close to π.',
    caveat: () => 'This is a historical pattern, not a guaranteed signal.',
  },
  mvrv: {
    title: 'MVRV ratio',
    what: 'MVRV compares Bitcoin’s price with the average price at which all coins last moved on-chain — the network’s average “cost basis”.',
    why: 'It shows how much profit the typical holder is sitting on.',
    now: (a) => { const x = cyM(a, 'mvrv'); return x?.value ? `Today’s ${x.display} is in the “${x.zone.label}” zone (${range(ZONES.mvrv, x.zone.label)}): ${ZONE_MEANS.mvrv[x.zone.label]}.` : null; },
    history: 'Past cycle tops came above roughly 3–4; major bottoms below 1.',
    reminder: true,
  },
  nupl: {
    title: 'NUPL',
    what: 'NUPL (net unrealised profit/loss) is the share of Bitcoin’s market value that is paper profit not yet sold.',
    why: 'It is calculated directly from MVRV, so it tells the same story on a simpler scale.',
    now: (a) => { const x = cyM(a, 'nupl'); return x?.value !== undefined && x?.value !== null ? `${x.display} is the “${x.zone.label}” band (${range(ZONES.nupl, x.zone.label)}): ${ZONE_MEANS.nupl[x.zone.label]}.` : null; },
    history: 'Above 0.75 has often appeared near cycle tops; below zero near major bottoms.',
    reminder: true,
  },
  sopr: {
    title: 'SOPR',
    what: 'SOPR (spent output profit ratio) looks only at coins that actually moved and asks whether their sellers took a profit or a loss, on average.',
    why: 'Above 1 means a profit; below 1, a loss.',
    now: (a) => { const x = cyM(a, 'sopr'); return x?.value ? `The 7-day average of ${x.display} is “${x.zone.label}”: ${ZONE_MEANS.sopr[x.zone.label]}.` : null; },
    history: 'Sustained readings well above 1 have accompanied heavy profit-taking.',
    caveat: (a) => (cyM(a, 'sopr')?.status === 'delayed' ? `The free data runs about a week behind (latest ${cyM(a, 'sopr').asOf}).` : null),
  },
  composite: {
    title: 'Composite valuation index',
    what: 'Averages five valuation readings, each scored from −2 (stretched) to +2 (deep value).',
    why: 'Combining several metrics avoids leaning on any single one.',
    now: (a) => { const v = a.cycle?.valuation; if (!v?.zone) return null; const ext = (v.inputs || []).filter((x) => Math.abs(x.score) === 2).length; return `Today’s ${v.score > 0 ? '+' : ''}${fmtNum(v.score, 1)} is “${v.zone.label}”${v.zone.label.startsWith('Neutral') ? `: ${ext ? 'readings offset each other' : 'no input is at an extreme'}, so valuation gives no edge either way` : ''}.`; },
    reminder: true,
  },
  'force:options': {
    title: 'Options positioning & volatility',
    what: 'Tracks Deribit, the largest Bitcoin options exchange: where large contracts cluster, and how much movement traders are paying for (implied volatility, or “IV”).',
    why: 'Dealers hedge options by trading bitcoin, so big clusters (“gamma”) can hold price near a strike or speed up a break through it.',
    now: (a) => { const O = a.metrics?.options, f = force(a, 'options'); return O && f ? `${f.direction.charAt(0).toUpperCase() + f.direction.slice(1)} today: IV of ${fmtNum(O.atmIv30, 0)}% is ${O.ivRvSpread < 0 ? 'below' : 'above'} the ${fmtNum(O.atmIv30 - O.ivRvSpread, 0)}% that price actually moved, so options look ${O.ivRvSpread < 0 ? 'calm, not fearful' : 'nervous'}.` : null; },
    caveat: () => 'Public data can’t fully confirm whether dealers dampen or amplify moves.',
  },
  'force:etf': {
    title: 'ETF demand',
    what: 'Net money flowing into US spot Bitcoin ETFs (exchange-traded funds that hold real bitcoin); new shares mean the fund must buy coins.',
    why: 'It is the clearest daily window into demand from traditional investors.',
    now: (a) => { const E = a.metrics?.etf; return E ? `${E.s5 >= 0 ? 'Still buying' : 'Net selling'}: ${fmtUsdSigned(E.s5 * 1e6, 0)} over 5 days${E.accel < 0 ? `, slower than the ${fmtUsdSigned(E.s20 * 1e6)} of the past 20 days` : ''}.` : null; },
    history: 'Persistent multi-week inflows have accompanied the strongest rallies since these ETFs launched in 2024.',
  },
  // ---------- remaining forces ----------
  'force:onchain': {
    title: 'On-chain supply & stablecoin liquidity',
    what: 'Combines what the blockchain itself shows about holders (how far price is above their average cost) with the supply of stablecoins — dollar tokens that traders use to buy crypto.',
    why: 'Growing stablecoin supply is “dry powder” that can flow into bitcoin; holder profit levels show how much selling pressure could appear.',
    now: (a) => { const O = a.metrics?.onchain, f = force(a, 'onchain'); return O && f ? `${cap(f.direction)} today: stablecoin supply is ${O.stables30d > 0 ? 'growing' : 'shrinking'} (${fmtUsdSigned(O.stables30d, 1)} in 30 days) and MVRV of ${fmtNum(O.mvrv, 2)} shows moderate holder profits.` : null; },
    history: 'Expanding stablecoin supply has tended to accompany healthier crypto markets; shrinking supply, weaker ones.',
  },
  'force:macro': {
    title: 'Macro liquidity & financial conditions',
    what: 'Tracks how easy or tight money is in the wider economy: the Federal Reserve’s balance sheet, “real” interest rates (rates after inflation) and credit spreads.',
    why: 'When money is cheap and plentiful, investors take more risk, which has tended to help bitcoin; tighter money works the other way.',
    now: (a) => { const M = a.metrics?.macro, f = force(a, 'macro'); return M && f ? `${cap(f.direction)} today: real yields ${M.real10y20d >= 0 ? 'rose' : 'fell'} ${fmtNum(Math.abs(M.real10y20d) * 100, 0)} basis points (hundredths of a percent) in four weeks${linkWeak(a) ? ', but bitcoin is moving largely independently of these markets right now, so the effect is muted' : ''}.` : null; },
  },
  'force:depth': {
    title: 'Market depth (spot liquidity)',
    what: 'The dollar value of buy and sell orders waiting within 1% of the current price on major exchanges — the market’s shock absorber.',
    why: 'Thin order books let even modest selling or buying move price sharply; deep books absorb it.',
    now: (a) => { const d = a.metrics?.depth; return d ? `About ${fmtUsd(d.d1, 0)} sits within 1% today, with ${d.imbalance1 < 0 ? 'more sell orders than buy orders' : 'more buy orders than sell orders'} (${fmtPct(d.imbalance1 * 100, 0)} imbalance) — a reading to watch, not a signal by itself.` : null; },
    caveat: () => 'Displayed orders can be pulled at any moment, especially during stress.',
  },
  'force:spot': {
    title: 'Spot buying vs selling',
    what: 'Measures who is more aggressive in the regular (non-leveraged) market: buyers paying up or sellers hitting bids, plus the “Coinbase premium” — the price gap between Coinbase (US buyers) and offshore exchanges.',
    why: 'Rallies driven by real spot buying have historically been more durable than those driven by borrowed money.',
    now: (a) => { const d = a.metrics?.depth, D = a.metrics?.derivs; return d && D ? `Neutral today: the Coinbase premium is ${fmtPct(d.coinbasePremiumPct, 2)} and buyers slightly outnumber sellers (ratio ${fmtNum(D.takerSpot7d, 2)}) — no strong push either way.` : null; },
  },
  'force:riskappetite': {
    title: 'Cross-asset risk appetite',
    what: 'Checks how closely bitcoin has been moving with stocks, gold and the dollar (their “correlation”, from −1 to +1).',
    why: 'When the link is strong, a stock-market sell-off tends to drag bitcoin with it; when weak, crypto-specific news dominates.',
    now: (a) => { const C = a.metrics?.corr; return C?.NDX ? `Today the 30-day correlation with the Nasdaq is ${fmtNum(C.NDX.c30, 2)} — close to zero, so bitcoin is mostly ${C.behaviour?.label || 'moving on its own'}.` : null; },
    caveat: () => 'Correlation describes moving together, not cause and effect.',
  },
  'force:leverage': {
    title: 'Futures & leverage',
    what: 'Open interest is the total value of outstanding futures bets on bitcoin, many of them made with borrowed money (leverage).',
    why: 'When leverage builds up, price moves can trigger forced closures (liquidations) that make the move bigger, in either direction.',
    now: (a) => { const D = a.metrics?.derivs; return D ? `About ${fmtUsd(D.totalOi, 1)} is open (${fmtNum(D.oiPctMcap, 1)}% of bitcoin’s value), ${Math.abs(D.oiCh7d) < 5 ? 'roughly flat over the past week — leverage is not building up' : `${fmtPct(D.oiCh7d, 0)} over the past week`}.` : null; },
    history: 'Sharp leverage build-ups have often preceded sudden “flush-outs” in both directions.',
  },
  'force:dollar': {
    title: 'US dollar & yields',
    what: 'Follows the dollar index (DXY, the dollar against major currencies) and US 10-year Treasury yields.',
    why: 'A stronger dollar and higher yields make cash and bonds more attractive than risk assets, which has tended to weigh on bitcoin.',
    now: (a) => { const M = a.metrics?.macro; return M ? `Both rose over four weeks (dollar ${fmtPct(M.dollar20d, 1)}, 10-year yield ${M.us10y20d >= 0 ? '+' : ''}${fmtNum(M.us10y20d * 100, 0)} basis points) — a mild headwind${linkWeak(a) ? ' that bitcoin has largely shrugged off so far' : ''}.` : null; },
  },
  'force:funding': {
    title: 'Funding rates',
    what: 'Funding is the fee traders with long (bullish) or short (bearish) positions pay each other to keep perpetual futures in line with spot price.',
    why: 'High positive funding means many traders are paying to bet on higher prices — a crowded trade that can unwind fast.',
    now: (a) => { const D = a.metrics?.derivs; return D?.fundingAnn !== undefined ? `At ${fmtNum(D.fundingAnn, 1)}% a year, funding is ${D.fundingAnn > 15 ? 'high — longs look crowded' : D.fundingAnn < 0 ? 'negative — shorts are paying, a sign of pessimism' : 'moderate — positioning is not crowded'}.` : null; },
    history: 'Readings above roughly 20–30% a year have often appeared near short-term tops.',
  },

  // ---------- overview ----------
  regime: {
    title: 'Market regime',
    what: 'A one-line summary of which family of forces is setting the price right now: spot buying, leverage, derivatives, macro, or thin liquidity.',
    why: 'Knowing what is in charge helps judge how durable a move is likely to be — spot-led moves have tended to last longer than leverage-led ones.',
    now: (a) => `Today: “${a.regime?.primary}”. ${/Balanced/.test(a.regime?.primary || '') ? 'No single force clearly dominates; several moderate ones are pulling against each other.' : ''}`,
    caveat: () => 'The classification uses fixed, published rules, not judgement calls.',
  },
  cyclebadge: {
    title: 'On-chain cycle badge',
    what: 'A short summary of where bitcoin sits in its long-term valuation cycle, based on blockchain data (open the On-chain cycle tab for the full picture).',
    why: 'Cycles describe slow-moving shifts in how much profit holders are sitting on — useful context for the daily moves on this page.',
    now: (a) => { const c = a.cycle; return c?.valuation?.zone ? `Today: “${c.phase?.label}” phase, valuation “${c.valuation.zone.label}”, momentum ${String(c.momentum?.label).toLowerCase()}.` : null; },
    reminder: true,
  },
  changes: {
    title: 'What changed',
    what: 'Only unusually large moves appear here, measured in “σ” (sigma): how big the change was compared with a typical move in that data.',
    why: 'A move of 1.5σ or more happens on roughly one day in eight, so this filter hides everyday noise.',
    now: (a) => { const n = [...(a.changes || []), ...(a.changes7 || [])].filter((c) => Math.abs(c.z ?? 0) >= 1.5).length; return n ? `${n} move${n > 1 ? 's' : ''} cleared the bar today, over 24 hours or 7 days.` : 'Nothing cleared the bar today — markets moved within their normal ranges.'; },
  },
  evidence: {
    title: 'Evidence strength',
    what: 'How much confidence the data supports for each reading: strong (●●●), moderate (●●○) or weak (●○○).',
    why: 'A reading built on several fresh, consistent data sources is more reliable than one from a single or delayed source.',
    now: () => 'Strength drops automatically when inputs are missing, stale or conflicting.',
  },
  'scen:up': {
    title: 'Upside acceleration',
    what: 'Lists the conditions that, historically, have turned a gradual rise into a fast one — for example strong ETF buying while leverage is not yet crowded.',
    why: 'Each condition shows Met, Not met or Unknown with today’s value, so you can see how close the setup is.',
    now: (a) => scenNow(a, 0),
    caveat: () => 'Meeting conditions describes a setup, not a forecast; no probabilities are assigned.',
  },
  'scen:base': {
    title: 'Base case: range',
    what: 'Describes the conditions under which price tends to stay in a range: mixed flows, stable leverage and large options positions near the current price.',
    why: 'Ranges are the most common state of any market; knowing what keeps one in place shows what would have to change to break it.',
    now: (a) => scenNow(a, 1),
    caveat: () => 'Meeting conditions describes a setup, not a forecast; no probabilities are assigned.',
  },
  'scen:down': {
    title: 'Downside acceleration',
    what: 'Lists the conditions that, historically, have turned a decline into a cascade — for example ETF selling into thin order books with heavy leverage.',
    why: 'Each condition shows Met, Not met or Unknown with today’s value, so you can see how close the setup is.',
    now: (a) => scenNow(a, 2),
    caveat: () => 'Meeting conditions describes a setup, not a forecast; no probabilities are assigned.',
  },
  'w:expiry': {
    title: 'Options expiry',
    what: 'On expiry day, options contracts settle and the hedges that dealers held against them are unwound.',
    why: 'Around large expiries, price can be “pinned” near big strikes, then move more freely once the hedges are gone.',
    now: (a) => { const x = a.metrics?.options?.nextBigExpiry; return x ? `This one covers ${fmtUsd(x.notionalUsd)} of contracts. “Max pain” (${fmtK(x.maxPain)}) is the price at which option buyers would lose the most — a reference point, not a target.` : null; },
  },
  'w:etf': {
    title: 'Tonight’s ETF print',
    what: 'Farside Investors publishes each US spot bitcoin ETF’s net inflows or outflows after the US market closes.',
    why: 'It is the main daily read on demand from traditional investors.',
    now: (a) => { const E = a.metrics?.etf; return E ? `The 5-day total is ${fmtUsdSigned(E.s5 * 1e6, 0)}; tonight shows whether that trend continues.` : null; },
  },
  'w:cycle': {
    title: 'On-chain zone watch',
    what: 'Flags when an on-chain valuation metric changes zone, or sits right next to a zone boundary.',
    why: 'Zone changes in slow-moving metrics happen rarely, so they are worth noticing when they do.',
    now: () => 'A small move across a boundary changes the label more than the substance — read it alongside the other metrics.',
  },
  'w:stables': {
    title: 'Stablecoin flow',
    what: 'Stablecoins are dollar-pegged tokens; new ones are created when money enters crypto and destroyed when it leaves.',
    why: 'Weekly changes in their supply are a quick read on money arriving or leaving the crypto market.',
    now: (a) => { const O = a.metrics?.onchain; return O?.stables7d !== undefined ? `Supply changed ${fmtUsdSigned(O.stables7d, 1)} over the past week.` : null; },
  },
  'w:depth': {
    title: 'Depth during US hours',
    what: 'Watches whether buy orders near the price stay in place or get pulled during the busiest trading hours.',
    why: 'If buyers step back when price dips, small sell orders can move price much further than usual.',
  },
  'w:leverage': {
    title: 'Open interest and funding',
    what: 'Watches whether traders are adding borrowed-money bets and paying more to hold them.',
    why: 'Leverage building into a move makes it more fragile: a reversal can trigger forced selling or buying.',
  },

  // ---------- on-chain cycle: remaining metrics and headers ----------
  mayer: {
    title: 'Mayer Multiple',
    what: 'Price divided by its 200-day average — a simple way to see how stretched price is versus its long-term trend.',
    why: 'Far above the trend has often meant overheated; below it, out of favour.',
    now: (a) => zoneNow(a, 'mayer', ZONES.mayer, 'price is moderately above its long-term trend, but far from stretched'),
    history: 'Readings above 2.4 have historically marked overheated markets.',
    reminder: true,
  },
  puell: {
    title: 'Puell Multiple',
    what: 'Compares miners’ daily income from new coins with its one-year average.',
    why: 'Miners steadily sell new coins; unusually low income forces some out and eases that selling, while unusually high income tends to bring more.',
    now: (a) => zoneNow(a, 'puell', ZONES.puell, 'miner income is normal, so miners are neither stressed nor flush'),
    history: 'Very low readings have coincided with past cycle bottoms; each halving (every ~4 years) pushes it down for a while.',
    reminder: true,
  },
  profit: {
    title: '% supply in profit',
    what: 'The share of all bitcoin that last moved at a lower price than today — coins that would be in profit if sold now.',
    why: 'When nearly all coins are in profit, more holders are tempted to sell; when many are underwater, selling tends to dry up.',
    now: (a) => zoneNow(a, 'profit', ZONES.profit, 'most holders are in profit, but well short of the near-100% seen in strong bull phases'),
    history: 'Bear-market lows have historically come with roughly half of supply in profit.',
    caveat: (a) => (cyM(a, 'profit')?.status === 'delayed' ? `The free data runs a few days behind (latest ${cyM(a, 'profit').asOf}).` : null),
    reminder: true,
  },
  realized: {
    title: 'Distance to realised price',
    what: 'The “realised price” is the average price at which all bitcoin last moved — roughly the network’s average purchase price.',
    why: 'In deep bear markets, price has tended to fall to or below this level, making it a long-term floor reference.',
    now: (a) => { const x = cyM(a, 'realized'); return x?.value !== null && x?.value !== undefined ? `Price is ${fmtPct(Math.abs(x.value), 0, false)} ${x.value >= 0 ? 'above' : 'below'} it today. This is the same information as MVRV, shown in price terms, so it is not scored separately.` : null; },
    reminder: true,
  },
  hashribbons: {
    title: 'Hash Ribbons',
    what: 'Compares the 30-day and 60-day average of the network’s total computing power (hash rate).',
    why: 'When the short average falls below the long one, miners are switching machines off — often under financial stress. The recovery afterwards has historically been a constructive sign.',
    now: (a) => { const x = cyM(a, 'hashribbons'); return x?.zone ? `Today: “${x.zone.label}” — ${x.zone.label === 'Capitulation' ? 'miners are under stress' : x.zone.label === 'Recovery' ? 'miners are recovering from a stress period' : 'miners are not under stress'}.` : null; },
    reminder: true,
  },
  stables: {
    title: 'Stablecoin supply trend',
    what: 'The 30-day change in the total supply of dollar-pegged stablecoins (such as USDT and USDC).',
    why: 'New stablecoins usually mean new money entering crypto, ready to buy; shrinking supply means money leaving.',
    now: (a) => { const x = cyM(a, 'stables'); return x?.zone ? `Supply is ${x.display.replace(' 30d', '')} over 30 days — “${x.zone.label}”.` : null; },
  },
  phase: {
    title: 'Cycle position',
    what: 'Names the phase of the classic market cycle based on NUPL (the share of bitcoin’s value that is unrealised profit): Capitulation, Hope, Optimism, Belief, Euphoria — or the matching anxious names when it is falling.',
    why: 'It is a shorthand for the typical holder’s mood, measured from data rather than surveys.',
    now: (a) => { const p = a.cycle?.phase; return p ? `Today: “${p.label}”, with NUPL at ${fmtNum(p.nupl, 2)} and ${p.rising ? 'rising' : 'falling'} over the past 30 days.` : null; },
    reminder: true,
  },
  momentum: {
    title: 'Momentum',
    what: 'Adds up four simple trend checks, each scored +1 (up), 0 or −1 (down): price versus its 200-day average, that average’s direction, MVRV versus its one-year average, and stablecoin supply.',
    why: 'Valuation says where we are in the cycle; momentum says which way things are currently moving.',
    now: (a) => { const M = a.cycle?.momentum; return M?.label ? `Today scores ${M.score > 0 ? '+' : ''}${M.score} of a possible ±${M.n}: “${M.label}”. +2 or more is constructive, −2 or less weakening.` : null; },
    reminder: true,
  },
  stretched: {
    title: 'Stretched flag',
    what: 'Appears when valuation is elevated but momentum is still pointing up.',
    why: 'That combination has described late stages of past rallies — prices still rising while already expensive by on-chain measures.',
    reminder: true,
  },
  'mom:aboveMa': { title: 'Price vs 200-day average', what: 'Whether price is above (+1) or below (−1) its average over the last 200 days.', why: 'Long-term uptrends have historically spent most of their time above this line.' },
  'mom:maSlope': { title: '200-day average slope', what: 'Whether the 200-day average itself is rising (+1), falling (−1) or flat (0) over the past month.', why: 'A rising long-term average means the trend is improving, not just bouncing.' },
  'mom:mvrvTrend': { title: 'MVRV vs its one-year average', what: 'Whether holders’ average profit (MVRV) is above (+1) or below (−1) its own one-year average.', why: 'It shows whether on-chain valuation is improving or fading compared with the past year.' },
  'mom:stables': { title: 'Stablecoin supply, 30 days', what: 'Whether dollar-token supply grew more than 1% (+1), shrank more than 1% (−1) or held steady (0) in 30 days.', why: 'Growing supply is fresh money arriving in crypto.' },

  // ---------- dashboard & liquidity detail ----------
  liquidations: {
    title: 'Liquidations',
    what: 'Forced closures of leveraged positions when traders can no longer cover their losses; the exchange sells (longs) or buys (shorts) for them.',
    why: 'Clusters of liquidations can turn a normal move into a sharp spike.',
    now: () => 'This tile shows a sample from one exchange (OKX); market-wide totals need paid data.',
  },
  attribution: {
    title: 'How price is moving',
    what: 'Classifies the latest move by what drove it: real spot buying or selling, leverage, or both.',
    why: 'Moves carried by cash buyers have historically lasted longer than moves carried by borrowed money.',
    now: (a) => (a.attribution?.d1 ? `Last 24 hours: “${a.attribution.d1.label}”.` : null),
  },
  depthVenues: {
    title: 'Order-book depth by exchange',
    what: 'Breaks the 1% depth down by exchange and shows how concentrated it is.',
    why: 'If most liquidity sits on one or two venues, trouble there affects the whole market more.',
    caveat: () => 'Some exchanges only share part of their order book, so totals are a lower bound.',
  },
  impact: {
    title: 'Can the market absorb aggressive flow?',
    what: 'Estimates how far price would move if a single large market order were placed against today’s visible order books.',
    why: 'It turns “depth” into a practical number: the price cost of selling or buying in size.',
    caveat: () => 'Real impact is usually larger, because market makers pull orders during stress.',
  },
  expiries: {
    title: 'Options expiries',
    what: 'Upcoming dates when Deribit options settle, with their size and the strikes holding the most contracts.',
    why: 'Large expiries can hold price near big strikes beforehand and release it afterwards.',
    caveat: () => '“Max pain” is a reference point, not a target.',
  },

  level: {
    title: 'Liquidity level',
    now: (a, l) => (l ? levelNow(l) : null),
    why: 'Hedging and forced buying or selling here can slow a move (“pinning”) or speed it up (“acceleration”).',
    caveat: () => 'Liquidation figures are model estimates; dealer positioning can’t always be confirmed from public data.',
  },
};

Object.assign(EXPLAIN, DASH_EXPLAIN);

function levelNow(l) {
  const parts = [];
  if (/short-squeeze/i.test(l.what)) parts.push('estimated short positions that would be force-closed (bought back) above it');
  if (/long-liquidation/i.test(l.what)) parts.push('estimated leveraged long positions that would be force-sold below it');
  if (/options/i.test(l.what) || /gamma/i.test(l.what)) parts.push('a large cluster of options contracts');
  if (/put-strike/i.test(l.what)) parts.push('put options whose hedging can add selling into a decline');
  if (/congestion/i.test(l.what)) parts.push('a price area where Bitcoin traded on many days last year');
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  const what = parts.length ? `This band holds ${list}.` : `This band holds: ${l.what}.`;
  const how = l.kind === 'two' ? '“Two-sided” means it could slow a move first, then speed it up if broken.' : l.kind === 'acc' ? 'If reached, forced flows here would tend to speed the move up.' : l.kind === 'spot' ? 'Price is inside this band now, so hedging can hold price in place or amplify a break.' : 'Buyers or hedgers here would tend to slow the move.';
  return [what, how];
}

// → { title, parts: [[sentences…] per paragraph], text: all sentences } or null
// Paragraphs: what it measures + why · how to read today · history / caveats · reminder.
export function explain(key, a, ctx) {
  const e = EXPLAIN[key];
  if (!e) return null;
  const val = (v) => (typeof v === 'function' ? v(a, ctx) : v);
  const now = val(e.now);
  const [lead, reading] = Array.isArray(now) ? [[now[0], e.why], [now[1]]] : [[e.what, e.why], [now]];
  const parts = [lead, reading, [e.history, val(e.caveat)], [e.reminder ? REMINDER : null]].map((p) => p.filter(Boolean)).filter((p) => p.length);
  return { title: ctx?.label ? `${e.title} · ${ctx.label}` : e.title, parts, text: parts.flat() };
}
