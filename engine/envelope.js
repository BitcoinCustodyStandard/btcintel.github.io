// Moving averages and the volatility envelope, computed from daily closes.
//
// Envelope (classic Bollinger, 20, 2):
//   middle = simple average of the last 20 daily closes (including that day)
//   σ      = population standard deviation of the same 20 closes
//   upper  = middle + 2σ,  lower = middle − 2σ
// %B = (price − lower) / (upper − lower): 0 at the lower band, 1 at the upper band.
// The envelope describes how widely price has been spread recently. It is not a forecast.

export const ENV_N = 20, ENV_K = 2, SMAS = [50, 100, 200];

// closes: [[date, close], …] oldest first → rows [date, close, sma50, sma100, sma200, mid, upper, lower]
export function computeDaily(closes) {
  const n = closes.length, out = new Array(n);
  const sums = Object.fromEntries(SMAS.map((w) => [w, 0]));
  let s20 = 0, q20 = 0;
  for (let i = 0; i < n; i++) {
    const c = closes[i][1];
    for (const w of SMAS) { sums[w] += c; if (i >= w) sums[w] -= closes[i - w][1]; }
    s20 += c; q20 += c * c;
    if (i >= ENV_N) { const o = closes[i - ENV_N][1]; s20 -= o; q20 -= o * o; }
    const row = [closes[i][0], c];
    for (const w of SMAS) row.push(i >= w - 1 ? sums[w] / w : null);
    if (i >= ENV_N - 1) {
      const mid = s20 / ENV_N, sd = Math.sqrt(Math.max(0, q20 / ENV_N - mid * mid));
      row.push(mid, mid + ENV_K * sd, mid - ENV_K * sd);
    } else row.push(null, null, null);
    out[i] = row;
  }
  return out;
}

// where a price sits relative to an envelope row → { pctB, key, label, widthPct }
export function envelopePosition(price, row) {
  const [, , , , , mid, up, lo] = row || [];
  if (!(price > 0 && up > lo)) return null;
  const pctB = (price - lo) / (up - lo), widthPct = ((up - lo) / mid) * 100;
  let key, label;
  if (pctB > 1) { key = 'above'; label = 'above the upper band'; }
  else if (pctB >= 0.8) { key = 'nearUpper'; label = 'near the upper band'; }
  else if (pctB > 0.5) { key = 'upperHalf'; label = 'inside the envelope, upper half'; }
  else if (pctB >= 0.2) { key = 'lowerHalf'; label = 'inside the envelope, lower half'; }
  else if (pctB >= 0) { key = 'nearLower'; label = 'near the lower band'; }
  else { key = 'below'; label = 'below the lower band'; }
  return { pctB, key, label, widthPct, mid, up, lo };
}
