// Checks the moving averages and ±2σ envelope against a direct (non-rolling) calculation.
import assert from 'node:assert/strict';
import { computeDaily, envelopePosition } from '../../engine/envelope.js';

const closes = Array.from({ length: 260 }, (_, i) => [new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10), 50000 + 8000 * Math.sin(i / 17) + i * 40]);
const rows = computeDaily(closes);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
for (const i of [19, 49, 99, 199, 259]) {
  const win = (w) => closes.slice(i - w + 1, i + 1).map((r) => r[1]);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const r = rows[i];
  if (i >= 49) near(r[2], mean(win(50)), `sma50 @${i}`);
  if (i >= 99) near(r[3], mean(win(100)), `sma100 @${i}`);
  if (i >= 199) near(r[4], mean(win(200)), `sma200 @${i}`);
  const w20 = win(20), m = mean(w20), sd = Math.sqrt(mean(w20.map((v) => (v - m) ** 2)));
  near(r[5], m, `mid @${i}`); near(r[6], m + 2 * sd, `upper @${i}`); near(r[7], m - 2 * sd, `lower @${i}`);
}
assert.equal(rows[18][5], null, 'no envelope before 20 closes');
assert.equal(rows[198][4], null, 'no 200-day average before 200 closes');
const last = rows.at(-1);
assert.equal(envelopePosition(last[6] + 1, last).key, 'above');
assert.equal(envelopePosition(last[7] - 1, last).key, 'below');
assert.equal(envelopePosition(last[5], last).key, 'lowerHalf');
assert.equal(envelopePosition(last[7] + (last[6] - last[7]) * 0.9, last).key, 'nearUpper');
console.log('envelope tests passed');
