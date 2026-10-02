// Run: node agent/test/picycle.test.mjs
import assert from 'node:assert/strict';
import { computePiCycle, piZone } from '../../engine/picycle.js';
const day = (i) => new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString().slice(0, 10);
// 1) rolling sums match a brute-force mean; no partial windows
const closes = Array.from({ length: 900 }, (_, i) => [day(i), 1000 + 400 * Math.sin(i / 37) + i * 3]);
const { rows, latest } = computePiCycle(closes);
assert.equal(rows[109][2], null); assert.notEqual(rows[110][2], null);
assert.equal(rows[348][3], null); assert.notEqual(rows[349][3], null);
const mean = (a, n, i) => a.slice(i - n + 1, i + 1).reduce((s, x) => s + x[1], 0) / n;
for (const i of [110, 349, 500, 899]) {
  assert.ok(Math.abs(rows[i][2] - mean(closes, 111, i)) / rows[i][2] < 1e-6);
  if (i >= 349) assert.ok(Math.abs(rows[i][3] - 2 * mean(closes, 350, i)) / rows[i][3] < 1e-6);
}
assert.ok(Math.abs(latest.gap - (latest.ma350x2 - latest.ma111) / latest.ma350x2) < 1e-12);
// 2) a parabolic blow-off produces exactly one cross, on the right day
const blow = Array.from({ length: 800 }, (_, i) => [day(i), i < 600 ? 100 : 100 * Math.exp((i - 600) / 25)]);
const b = computePiCycle(blow);
assert.equal(b.crosses.length, 1);
const ci = b.rows.findIndex((r) => r[0] === b.crosses[0].date);
assert.ok(b.rows[ci][2] >= b.rows[ci][3] && b.rows[ci - 1][2] < b.rows[ci - 1][3]);
// 3) zones
assert.deepEqual(['far', 'approaching', 'close', 'crossed'], [0.55, 0.12, 0.03, -0.01].map((g) => piZone(g).key));
console.log('pi cycle tests passed; synthetic cross on', b.crosses[0].date);
