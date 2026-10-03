// Checks the DCA backtest against hand-computed cases and on real history.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { schedule, backtest, xirr, rollingWindows, forwardAtConstantPrice } from '../../engine/dca.js';

const days = (n, f) => Array.from({ length: n }, (_, i) => [new Date(Date.UTC(2024, 0, 1) + i * 864e5).toISOString().slice(0, 10), f(i)]);

// flat price: avg cost = price, P/L = 0, BTC = invested / price
const flat = days(400, () => 50000);
const b = backtest(flat, { amount: 100, every: 'week', start: '2024-01-01', end: '2024-12-31' });
assert.equal(b.n, 53, '53 weekly buys in a 366-day year starting on a buy day');
assert.equal(b.invested, 5300);
assert.ok(Math.abs(b.avgCost - 50000) < 1e-6 && Math.abs(b.pnl) < 1e-6);
assert.ok(Math.abs(b.btc - 5300 / 50000) < 1e-12);
assert.equal(b.sats, Math.round((5300 / 50000) * 1e8));
assert.ok(Math.abs(b.xirr) < 1e-4, 'flat price → ~0% XIRR');

// two-price case computed by hand: buy $100 at 100 then $100 at 50 → 3 BTC units, avg cost 66.67
const two = [['2024-01-01', 100], ['2024-01-02', 75], ['2024-01-03', 60], ['2024-01-04', 55], ['2024-01-05', 52], ['2024-01-06', 51], ['2024-01-07', 50], ['2024-01-08', 50]];
const t2 = backtest(two, { amount: 100, every: 'week', start: '2024-01-01', end: '2024-01-08' });
assert.equal(t2.n, 2); assert.ok(Math.abs(t2.btc - 3) < 1e-12); assert.ok(Math.abs(t2.avgCost - 200 / 3) < 1e-9);
assert.ok(Math.abs(t2.value - 150) < 1e-9 && Math.abs(t2.pnlPct + 25) < 1e-9);
assert.ok(Math.abs(t2.lump.btc - 2) < 1e-12, 'lump sum: $200 at 100');
assert.equal(t2.hindsight.price, 50);
// fee reduces bitcoin bought
assert.ok(Math.abs(backtest(two, { amount: 100, every: 'week', start: '2024-01-01', end: '2024-01-08', feePct: 1 }).btc - 2.97) < 1e-12);

// monthly schedule keeps the day of month, clamping short months (Jan 31 → Feb 29 2024 → Mar 31)
const m = schedule(days(130, () => 1), 'month', '2024-01-31', '2024-04-30').map((i) => days(130, () => 1)[i][0]);
assert.deepEqual(m, ['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']);

// XIRR: pay 100, receive 110 one year later → 10%
assert.ok(Math.abs(xirr([[Date.UTC(2023, 0, 1), -100], [Date.UTC(2024, 0, 1), 110]]) - 0.0997) < 0.001);

// live price overrides the last close for "value today"
assert.ok(Math.abs(backtest(flat, { amount: 100, start: '2024-01-01', end: '2024-12-31' }, 60000).pnlPct - 20) < 1e-9);

// forward illustration at a constant price
assert.deepEqual(forwardAtConstantPrice({ amount: 100, every: 'month', years: 2, price: 50000 }), { purchases: 24, invested: 2400, btc: 0.048 });

// real history sanity
const pi = JSON.parse(readFileSync(new URL('../../data/pi_cycle.json', import.meta.url)));
const closes = pi.rows.map((r) => [r[0], r[1]]);
const r4 = backtest(closes, { amount: 100, every: 'week', start: '2022-01-01', end: closes.at(-1)[0] });
assert.ok(r4.n > 190 && r4.btc > 0 && r4.avgCost > 15000 && r4.avgCost < 90000, 'plausible 2022→today result');
const rw = rollingWindows(closes, { years: 4 });
assert.ok(rw.n > 400 && rw.profitable > 0.5 && rw.profitable <= 1);
console.log(`dca tests passed · $100/week since 2022: ${r4.n} buys, ${r4.btc.toFixed(4)} BTC, avg cost $${Math.round(r4.avgCost)}, P/L ${r4.pnlPct.toFixed(1)}%, XIRR ${(r4.xirr * 100).toFixed(1)}% · 4-year windows: ${rw.n}, ${(rw.profitable * 100).toFixed(0)}% profitable, median ${(rw.median * 100).toFixed(0)}%`);
