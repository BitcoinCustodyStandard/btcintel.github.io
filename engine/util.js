// Shared helpers. Runs unchanged in Node 22 (GitHub Actions agent) and in the browser.

export const DAY = 86400000;

export function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / DAY);
}

export async function fetchWithTimeout(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status} ${res.statusText} — ${body.slice(0, 160)}`);
      err.status = res.status;
      throw err;
    }
    return res;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchJSON(url, opts = {}, timeoutMs) {
  const res = await fetchWithTimeout(url, opts, timeoutMs);
  return res.json();
}

export async function fetchText(url, opts = {}, timeoutMs) {
  const res = await fetchWithTimeout(url, opts, timeoutMs);
  return res.text();
}

export const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export const sum = (arr) => arr.reduce((a, b) => a + (b ?? 0), 0);
export const mean = (arr) => {
  const v = arr.filter((x) => x !== null && Number.isFinite(x));
  return v.length ? sum(v) / v.length : null;
};
export function std(arr) {
  const v = arr.filter((x) => x !== null && Number.isFinite(x));
  if (v.length < 2) return null;
  const m = mean(v);
  return Math.sqrt(sum(v.map((x) => (x - m) ** 2)) / (v.length - 1));
}
export function pct(a, b) {
  // percent change from b (old) to a (new)
  if (a === null || b === null || a === undefined || b === undefined || b === 0) return null;
  return ((a - b) / Math.abs(b)) * 100;
}
export function zscore(x, series) {
  const s = std(series);
  const m = mean(series);
  if (x === null || s === null || s === 0) return null;
  return (x - m) / s;
}
export function percentileRank(x, series) {
  const v = series.filter((y) => y !== null && Number.isFinite(y));
  if (x === null || !v.length) return null;
  return (v.filter((y) => y <= x).length / v.length) * 100;
}

export function pearson(xs, ys) {
  const pairs = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 10) return null;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let num_ = 0, dx = 0, dy = 0;
  for (const [x, y] of pairs) {
    num_ += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  return dx && dy ? num_ / Math.sqrt(dx * dy) : null;
}

// Align two [date, value] series on common dates and return log returns.
// For equity/FX series, BTC's weekend days drop out naturally.
export function alignedReturns(a, b, lastN) {
  const mb = new Map(b.map(([d, v]) => [d, v]));
  const common = a.filter(([d]) => mb.has(d)).map(([d, v]) => [d, v, mb.get(d)]);
  const ra = [], rb = [], dates = [];
  for (let i = 1; i < common.length; i++) {
    const [d, a1, b1] = common[i];
    const [, a0, b0] = common[i - 1];
    if (a0 > 0 && a1 > 0 && b0 > 0 && b1 > 0) {
      ra.push(Math.log(a1 / a0));
      rb.push(Math.log(b1 / b0));
      dates.push(d);
    }
  }
  const n = lastN ? Math.max(0, ra.length - lastN) : 0;
  return { ra: ra.slice(n), rb: rb.slice(n), dates: dates.slice(n) };
}

// Same, but series b is treated in level differences (yields, VIX), not log returns.
export function alignedReturnsVsDiff(a, b, lastN) {
  const mb = new Map(b.map(([d, v]) => [d, v]));
  const common = a.filter(([d]) => mb.has(d)).map(([d, v]) => [d, v, mb.get(d)]);
  const ra = [], rb = [];
  for (let i = 1; i < common.length; i++) {
    const [, a1, b1] = common[i];
    const [, a0, b0] = common[i - 1];
    if (a0 > 0 && a1 > 0 && b0 !== null && b1 !== null) {
      ra.push(Math.log(a1 / a0));
      rb.push(b1 - b0);
    }
  }
  const n = lastN ? Math.max(0, ra.length - lastN) : 0;
  return { ra: ra.slice(n), rb: rb.slice(n) };
}

export function beta(ra, rb) {
  const c = pearson(ra, rb);
  const sa = std(ra), sb = std(rb);
  return c === null || !sb ? null : (c * sa) / sb;
}

export function realizedVol(closes, n) {
  // annualized, 365-day crypto calendar
  const c = closes.slice(-(n + 1));
  const r = [];
  for (let i = 1; i < c.length; i++) if (c[i - 1] > 0 && c[i] > 0) r.push(Math.log(c[i] / c[i - 1]));
  const s = std(r);
  return s === null ? null : s * Math.sqrt(365) * 100;
}

// value of [date, v] series at or before a date
export function valueAt(series, date) {
  if (!series || !series.length) return null;
  let best = null;
  for (const [d, v] of series) {
    if (d <= date) best = v;
    else break;
  }
  return best;
}
export function lastPoint(series) {
  if (!series || !series.length) return null;
  for (let i = series.length - 1; i >= 0; i--) if (series[i][1] !== null) return series[i];
  return null;
}
export function shiftDate(date, days) {
  return isoDate(new Date(date + 'T00:00:00Z').getTime() + days * DAY);
}

// --- Formatting -----------------------------------------------------------
export function fmtUsd(v, digits) {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(digits ?? 2)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(digits ?? 2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(digits ?? 1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(digits ?? 1)}K`;
  return `${sign}$${a.toFixed(digits ?? 0)}`;
}
export function fmtUsdSigned(v, digits) {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  return (v > 0 ? '+' : '') + fmtUsd(v, digits);
}
export function ordinal(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  const r = Math.round(n), t = r % 100;
  return r + (t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][r % 10] || 'th');
}
export function fmtPrice(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  return '$' + Math.round(v).toLocaleString('en-US');
}
export function fmtPct(v, digits = 1, signed = true) {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  const a = Math.abs(v).toFixed(digits);
  const zero = +a === 0;
  const s = zero ? '' : signed && v > 0 ? '+' : v < 0 ? '−' : '';
  return `${s}${a}%`;
}
export function fmtNum(v, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  return v.toFixed(digits);
}
export function fmtK(v) {
  return v === null || v === undefined ? 'n/a' : `$${Math.round(v / 1000)}K`;
}
export function signWord(v, pos = 'up', neg = 'down', flat = 'flat', eps = 0) {
  if (v === null || v === undefined) return 'unknown';
  return v > eps ? pos : v < -eps ? neg : flat;
}
export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// Black-Scholes helpers (r = 0, crypto convention)
function ncdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
export function bsGreeks(S, K, T, iv, isCall) {
  if (!(S > 0 && K > 0 && T > 0 && iv > 0)) return { delta: null, gamma: null };
  const sq = iv * Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * iv * iv * T) / sq;
  const pdf = Math.exp((-d1 * d1) / 2) / Math.sqrt(2 * Math.PI);
  const gamma = pdf / (S * sq);
  const delta = isCall ? ncdf(d1) : ncdf(d1) - 1;
  return { delta, gamma };
}
