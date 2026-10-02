// Run: node battlefield/test/model.test.mjs
import assert from 'node:assert/strict';
import { Battle, soldiersFor, liqTier, toBands, markWalls, RULES } from '../model.js';

const ok = (name, fn) => { fn(); console.log('ok -', name); };
// book with bids/asks every $10 from mid, `usd` per bucket, plus optional overrides
const mkBook = (mid, usd = 300e3, extra = {}) => {
  const bids = [], asks = [];
  for (let i = 0; i < 80; i++) { const pb = Math.floor((mid - 10 - i * 10) / 10) * 10, pa = Math.floor((mid + i * 10) / 10) * 10 + 10; bids.push([pb, extra[pb] ?? usd]); asks.push([pa, extra[pa] ?? usd]); }
  return { mid, bids, asks };
};

ok('soldier formula matches the spec', () => {
  assert.equal(soldiersFor(250e3), 12); assert.equal(soldiersFor(1e6), 28); assert.equal(soldiersFor(4e6), 49); assert.equal(soldiersFor(16e6), 72); assert.equal(soldiersFor(0), 0);
});
ok('liquidation tiers', () => {
  assert.deepEqual([49e3, 50e3, 150e3, 499e3, 500e3, 2e6].map(liqTier), [0, 1, 2, 2, 3, 4]);
});
ok('walls: >= 4x median band and >= $2M', () => {
  const b = toBands(mkBook(86000, 300e3, { 85800: 6e6 }));
  markWalls(b);
  const w = b.bids.filter((x) => x.wall);
  assert.equal(w.length, 1); assert.equal(w[0].p, 85800); assert.equal(w[0].wall, 'palisade');
});
ok('wall pulled vs hit', () => {
  const B = new Battle();
  B.book(0, mkBook(86000, 300e3, { 85800: 6e6 }), 86000);
  B.book(250, mkBook(86000), 86000); // vanished without trades
  assert.equal(B.drain().find((e) => e.kind.startsWith('wall')).kind, 'wall-pulled');
  B.book(500, mkBook(86000, 300e3, { 85700: 6e6 }), 86000);
  B.trade({ t: 600, px: 85710, usd: 3e6, side: 'sell', venue: 'Coinbase' });
  B.book(750, mkBook(86000), 86000);
  assert.equal(B.drain().find((e) => e.kind.startsWith('wall')).kind, 'wall-hit');
});
ok('no wall verdict when the venue set changes', () => {
  const B = new Battle();
  B.book(0, { ...mkBook(86000, 300e3, { 85800: 6e6 }), venues: ['Coinbase', 'Kraken'] }, 86000);
  B.book(250, { ...mkBook(86000), venues: ['Coinbase'] }, 86000);
  assert.ok(!B.drain().some((e) => e.kind.startsWith('wall')));
});
ok('walls vanishing on both sides at once are treated as a feed resync', () => {
  const B = new Battle();
  B.book(0, mkBook(86000, 300e3, { 85800: 6e6, 86200: 6e6 }), 86000);
  B.book(250, mkBook(86000), 86000);
  assert.ok(!B.drain().some((e) => e.kind === 'wall-pulled'));
});
ok('trades grouped per second into volley / surge / charge', () => {
  const B = new Battle({ bigTrade: 250e3 });
  B.trade({ t: 1000, px: 86000, usd: 20e3, side: 'buy' });
  B.trade({ t: 1500, px: 86001, usd: 20e3, side: 'buy' });
  B.trade({ t: 2100, px: 86002, usd: 100e3, side: 'buy' });
  B.trade({ t: 3100, px: 86003, usd: 300e3, side: 'sell' });
  B.flush(5000);
  const ev = B.drain();
  assert.deepEqual(ev.map((e) => [e.kind, e.side, e.usd]), [['volley', 'bull', 40e3], ['surge', 'bull', 100e3], ['charge', 'bear', 300e3]]);
});
ok('liquidations merge within 2 s; long liquidation hits bulls', () => {
  const B = new Battle();
  B.liq({ t: 0, px: 86000, usd: 100e3, side: 'long', venue: 'OKX' });
  B.liq({ t: 1500, px: 85990, usd: 100e3, side: 'long', venue: 'Binance' });
  B.liq({ t: 5000, px: 85900, usd: 60e3, side: 'long', venue: 'OKX' });
  B.flush(9000);
  const ev = B.drain();
  assert.equal(ev.length, 2); assert.equal(ev[0].side, 'bull'); assert.equal(ev[0].usd, 200e3); assert.equal(ev[0].tier, 2); assert.equal(ev[0].count, 2); assert.equal(ev[1].tier, 1);
});
ok('rout when ±1% depth drops 30% within 60 s, rally on recovery', () => {
  const B = new Battle();
  for (let t = 0; t <= 6000; t += 1000) B.book(t, mkBook(86000), 86000);
  B.book(7000, mkBook(86000, 150e3), 86000);
  let ev = B.drain(); assert.ok(ev.some((e) => e.kind === 'rout'));
  B.book(8000, mkBook(86000), 86000);
  ev = B.drain(); assert.ok(ev.some((e) => e.kind === 'rally'));
});
ok('range won only after holding 60 s past the marker', () => {
  const B = new Battle({ rangeStep: 500, rangeHoldMs: 60e3 });
  B.book(0, mkBook(85990), 85990);
  B.book(1000, mkBook(86010), 86010);      // crosses $86,000
  B.book(30e3, mkBook(85995), 85995);      // falls back: cancelled
  B.book(31e3, mkBook(86020), 86020);      // crosses again
  B.book(90e3, mkBook(86030), 86030);      // 59 s held
  assert.ok(!B.drain().some((e) => e.kind === 'range-won'));
  B.book(91.5e3, mkBook(86030), 86030);    // 60.5 s held
  const w = B.drain().find((e) => e.kind === 'range-won');
  assert.ok(w); assert.equal(w.side, 'bull'); assert.equal(w.marker, 86000);
});
ok('deterministic: same inputs, same events', () => {
  const run = () => { const B = new Battle(); for (let t = 0; t < 20000; t += 250) { B.book(t, mkBook(86000 + Math.round(Math.sin(t / 3000) * 40)), 86000 + Math.round(Math.sin(t / 3000) * 40)); B.trade({ t, px: 86000, usd: 30e3 + (t % 7000) * 50, side: t % 2000 ? 'buy' : 'sell' }); } B.flush(30000); return JSON.stringify(B.drain()); };
  assert.equal(run(), run());
});
ok('history keeps 15 minutes', () => {
  const B = new Battle();
  for (let t = 0; t <= 20 * 60e3; t += 1000) B.book(t, mkBook(86000), 86000);
  assert.ok(B.history.snaps[0].t >= 20 * 60e3 - RULES.HISTORY_MS);
});
console.log('all model tests passed');
