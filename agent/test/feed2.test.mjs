// Offline checks for the distribution parser, Polymarket selection and correlations.
import assert from 'node:assert/strict';
import { parseDistribution, pickPolymarket, correlations } from '../feed.mjs';

const row = (r, a, b) => `<tr><td>${r}</td><td data-val='${a}'>${a}</td><td class='hidden-phone' data-val='1'>x</td><td data-val='${b}'>${b} BTC</td><td data-val='${b}'>$1</td><td class='hidden-phone' data-val='0'>0%</td></tr>`;
const html = `<table><caption>Bitcoin distribution</caption><thead></thead><tbody>${[
  ['(0 - 0.00001)', 7832646, 46.4], ['[0.00001 - 0.0001)', 12696575, 532.35], ['[0.0001 - 0.001)', 14156233, 5295.2], ['[0.001 - 0.01)', 12149150, 44853.9],
  ['[0.01 - 0.1)', 8256193, 277706.9], ['[0.1 - 1)', 3496833, 1067671.4], ['[1 - 10)', 821413, 2041159.4], ['[10 - 100)', 129668, 4221741.6],
  ['[100 - 1,000)', 18272, 5236700.4], ['[1,000 - 10,000)', 1943, 4204509.2], ['[10,000 - 100,000)', 83, 2260289.0], ['[100,000 - 1,000,000)', 4, 729349.1],
].map((r) => row(...r)).join('')}</tbody></table>`;
const d = parseDistribution(html);
assert.equal(d.rows.length, 12);
assert.deepEqual(d.cohorts.shrimp, [7832646 + 12696575 + 14156233 + 12149150 + 8256193 + 3496833, Math.round(46.4 + 532.35 + 5295.2 + 44853.9 + 277706.9 + 1067671.4)]);
assert.deepEqual(d.cohorts.crab, [821413, 2041159]);
assert.deepEqual(d.cohorts.shark, [18272, 5236700]);
assert.deepEqual(d.cohorts.humpback, [87, Math.round(2260289.0 + 729349.1)]);

const now = Date.parse('2026-10-02T20:00:00Z');
const mk = (g, q, p) => ({ active: true, closed: false, groupItemTitle: g, question: q, outcomePrices: JSON.stringify([String(p), String(1 - p)]), volume24hr: 10, volumeNum: 100, oneDayPriceChange: 0.01 });
const evs = [
  { title: 'What price will Bitcoin hit in 2026?', slug: 'y', endDate: '2027-01-01T05:00:00Z', markets: [mk('↑ 100,000', 'Will Bitcoin reach $100,000 by December 31, 2026?', 0.375), mk('↓ 60,000', 'Will Bitcoin dip to $60,000 by December 31, 2026?', 0.135)] },
  { title: 'What price will ETH/BTC hit in October?', slug: 'e', endDate: '2026-11-01T04:00:00Z', markets: [mk('↑ 0.05', 'q', 0.1)] },
  { title: 'Bitcoin above ___ on October 2?', slug: 'a0', endDate: '2026-10-02T16:00:00Z', markets: [mk('86,000', 'Will the price of Bitcoin be above $86,000 on October 2?', 0.5)] },
  { title: 'Bitcoin above ___ on October 4?', slug: 'a2', endDate: '2026-10-04T16:00:00Z', markets: [mk('86,000', 'Will the price of Bitcoin be above $86,000 on October 4?', 0.4)] },
  { title: 'Bitcoin Up or Down on October 3?', slug: 'u', endDate: '2026-10-03T16:00:00Z', markets: [mk('', 'Up or down', 0.5)] },
];
const P = pickPolymarket(evs, now);
assert.deepEqual(P.map((e) => e.slug), ['y', 'a2'], 'year ladder plus nearest "above" ladder ≥ 20 h away; ETH/BTC and up/down excluded');
assert.equal(P[0].markets[0].strike, 100000); assert.equal(P[0].markets[0].dir, 'up'); assert.equal(P[0].markets[1].dir, 'down');
assert.equal(P[1].markets[0].strike, 86000); assert.equal(P[0].url, 'https://polymarket.com/event/y');

const C = await correlations();
for (const k of ['SPX', 'GOLD', 'DXY']) { const p = C.pairs[k]; assert.ok(p && Math.abs(p.c30) <= 1 && Math.abs(p.c90) <= 1 && p.s30.length > 100, k); }
console.log('feed2 tests passed', Object.entries(C.pairs).map(([k, p]) => `${k} c30 ${p.c30} c90 ${p.c90} (${p.s30.length} pts)`).join(' · '));
