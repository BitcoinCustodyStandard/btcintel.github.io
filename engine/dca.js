// Dollar-cost-averaging backtests on real daily closes. Pure functions, no I/O.
// closes: [[date 'YYYY-MM-DD', close], …] oldest first, one row per day.
//
// Purchases happen at the daily close on scheduled dates (weekly / every 2 weeks /
// monthly / daily) from `start` to `end`. A fee (percent of each purchase) reduces the
// bitcoin bought. Nothing here projects future prices.

const DAY = 864e5;
const t = (d) => Date.parse(d + 'T00:00:00Z');
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// purchase dates for a schedule, snapped to the first available close on or after each date
export function schedule(closes, every, start, end) {
  const out = [], idx = new Map(closes.map((r, i) => [r[0], i]));
  const first = Math.max(t(start), t(closes[0][0])), last = Math.min(t(end), t(closes.at(-1)[0]));
  const next = (ms, k) => {
    if (every === 'day') return ms + DAY;
    if (every === 'week') return ms + 7 * DAY;
    if (every === '2weeks') return ms + 14 * DAY;
    // monthly: same day of month as the start (clamped to the month's length)
    const s = new Date(first), d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + k, 1));
    const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), Math.min(s.getUTCDate(), dim));
  };
  for (let ms = first, k = 1; ms <= last; ms = next(ms, k++)) {
    let i = idx.get(iso(ms));
    for (let g = 1; i === undefined && g <= 5; g++) i = idx.get(iso(ms + g * DAY)); // fill small data gaps
    if (i !== undefined && (!out.length || out.at(-1) !== i) && t(closes[i][0]) <= last) out.push(i);
  }
  return out;
}

// XIRR: annualised money-weighted return. flows: [[ms, amount]] (negative = paid in)
export function xirr(flows) {
  if (flows.length < 2) return null;
  const t0 = flows[0][0], yr = (ms) => (ms - t0) / (365.25 * DAY);
  const npv = (r) => flows.reduce((s, [ms, a]) => s + a / (1 + r) ** yr(ms), 0);
  let lo = -0.9999, hi = 100, flo = npv(lo), fhi = npv(hi);
  if (!(flo * fhi < 0)) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2, f = npv(mid);
    if (Math.abs(f) < 1e-7) return mid;
    if (f * flo < 0) { hi = mid; fhi = f; } else { lo = mid; flo = f; }
  }
  return (lo + hi) / 2;
}

// Full backtest. livePrice (optional) values the holdings "today" instead of the last close.
export function backtest(closes, { amount, every = 'week', start, end, feePct = 0 }, livePrice = null) {
  const buys = schedule(closes, every, start, end);
  if (!buys.length) return null;
  const f = 1 - feePct / 100, buySet = new Set(buys);
  const i0 = buys[0], i1 = Math.min(closes.length - 1, closes.findLastIndex((r) => r[0] <= end));
  let btc = 0, invested = 0, peak = 0, maxDD = 0, ddAt = null, worst = 0, worstAt = null;
  const series = [], purchases = [];
  for (let i = i0; i <= i1; i++) {
    const [d, p] = closes[i];
    if (buySet.has(i)) { const b = (amount * f) / p; btc += b; invested += amount; purchases.push([d, p, b, btc, invested]); }
    const v = btc * p;
    series.push([d, invested, v, p]);
    // largest fall in portfolio value from its running peak (contributions included)
    if (v > peak) peak = v; else if (peak > 0 && 1 - v / peak > maxDD) { maxDD = 1 - v / peak; ddAt = d; }
    // deepest point "underwater": value below money put in
    const u = invested ? v / invested - 1 : 0;
    if (u < worst) { worst = u; worstAt = d; }
  }
  const lastClose = closes[i1][1], px = livePrice ?? lastClose, value = btc * px;
  const flows = purchases.map(([d]) => [t(d), -amount]).concat([[Date.now() > t(closes[i1][0]) + 2 * DAY ? t(closes[i1][0]) : Date.now(), value]]);
  // comparisons: the same total invested as a single purchase on day one, and (hindsight) at the lowest close
  const lumpBtc = (invested * f) / closes[i0][1];
  let low = i0; for (let i = i0; i <= i1; i++) if (closes[i][1] < closes[low][1]) low = i;
  const lowBtc = (invested * f) / closes[low][1];
  return {
    start: closes[i0][0], end: closes[i1][0], every, amount, feePct, price: px, priceIsLive: livePrice != null,
    purchases, series, n: purchases.length, invested, btc, sats: Math.round(btc * 1e8), avgCost: invested / btc,
    value, pnl: value - invested, pnlPct: (value / invested - 1) * 100, xirr: xirr(flows),
    maxDrawdown: maxDD * 100, maxDrawdownAt: ddAt, worstUnderwater: worst * 100, worstUnderwaterAt: worstAt,
    lump: { btc: lumpBtc, value: lumpBtc * px, pnlPct: ((lumpBtc * px) / invested - 1) * 100, price: closes[i0][1], date: closes[i0][0] },
    hindsight: { btc: lowBtc, value: lowBtc * px, pnlPct: ((lowBtc * px) / invested - 1) * 100, price: closes[low][1], date: closes[low][0] },
  };
}

// Every historical window of the same length: how often was a DCA of `years` in profit at its end?
// Starts step weekly through the full history; each window is valued at its own final close.
export function rollingWindows(closes, { years, every = 'week', step = 7 }) {
  const lenDays = Math.round(years * 365.25), res = [];
  const lastT = t(closes.at(-1)[0]);
  for (let i = 0; i < closes.length; i += step) {
    const s = closes[i][0], eMs = t(s) + lenDays * DAY;
    if (eMs > lastT) break;
    const buys = schedule(closes, every, s, iso(eMs));
    if (buys.length < 4) continue;
    let btc = 0; for (const b of buys) btc += 1 / closes[b][1];
    const endIdx = closes.findLastIndex((r) => t(r[0]) <= eMs);
    res.push([s, (btc * closes[endIdx][1]) / buys.length - 1]);
  }
  if (!res.length) return null;
  const r = res.map((x) => x[1]).sort((a, b) => a - b), q = (p) => r[Math.min(r.length - 1, Math.floor(p * (r.length - 1)))];
  const worst = res.reduce((a, x) => (x[1] < a[1] ? x : a)), best = res.reduce((a, x) => (x[1] > a[1] ? x : a));
  return { years, n: res.length, profitable: res.filter((x) => x[1] > 0).length / res.length, median: q(0.5), p10: q(0.1), p90: q(0.9), worst, best, from: res[0][0], to: res.at(-1)[0], points: res };
}

// Forward illustration only: keep the same pace for N years at ONE constant (today's) price.
export function forwardAtConstantPrice({ amount, every = 'week', years, price, feePct = 0 }) {
  const per = { day: 365, week: 52, '2weeks': 26, month: 12 }[every] || 52, n = Math.round(per * years);
  return { purchases: n, invested: n * amount, btc: (n * amount * (1 - feePct / 100)) / price };
}
