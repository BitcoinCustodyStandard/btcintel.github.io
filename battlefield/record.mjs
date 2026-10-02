#!/usr/bin/env node
// Records real exchange feed data for the Battlefield replay mode.
//   RECORD_MIN=15 node battlefield/record.mjs
// Output: battlefield/replay.json — book frames (aggregated, bucketed)
// plus every liquidation, trades ≥ $5K, per-second small-trade flow, tickers,
// funding and OI. Nothing is synthesised: a venue that cannot be reached is
// simply absent and listed in `venueStatus`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectLive, setDebug } from './feeds.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIN = +(process.env.RECORD_MIN || 15);
const FRAME_MS = 2000, RANGE_PCT = 1.2, BUCKET = 10, BIG_TRADE = 5000;
const r2 = (x) => Math.round(x * 100) / 100;
const r0 = (x) => Math.round(x);

const events = [];
const status = {};
const flow = new Map(); // second -> {b, s}
let lastTicker = {};
const emit = (e) => {
  if (e.type === 'status') {
    status[e.venue] = { ...(status[e.venue] || {}), state: e.state, note: e.note || status[e.venue]?.note, ...(e.state === 'live' ? { liveAt: new Date().toISOString() } : {}) };
    if (e.state !== 'connecting') console.log(new Date().toISOString(), e.venue, e.state, e.note || '');
    return;
  }
  if (e.type === 'trade') {
    if (!(e.usd > 0)) return;
    if (e.usd >= BIG_TRADE) events.push({ ...e, px: r2(e.px), usd: r0(e.usd) });
    else { const s = Math.floor(e.t / 1000); const f = flow.get(s) || { b: 0, s: 0 }; f[e.side === 'buy' ? 'b' : 's'] += e.usd; flow.set(s, f); }
    return;
  }
  if (e.type === 'ticker') { if (Date.now() - (lastTicker[e.venue] || 0) < 10000) return; lastTicker[e.venue] = Date.now(); }
  events.push(e);
};

// Diagnostics: subscription acks/errors and the first raw liquidation messages per venue.
const seen = {};
setDebug((venue, j) => {
  const key = venue + ':' + (j.arg?.channel || j.e || j.channel || j.event || j.type || (j.parseError ? 'parseError' : 'other'));
  seen[key] = (seen[key] || 0) + 1;
  if (j.event || j.parseError || /liquidation|forceOrder/i.test(key)) { if (seen[key] <= 3) console.log('DEBUG', key, JSON.stringify(j).slice(0, 400)); }
});
const { books, stop } = connectLive(emit);
const frames = [];
const t0 = Date.now();
const iv = setInterval(() => {
  const mid = books.mid();
  if (!mid) return;
  const a = books.aggregate(mid, RANGE_PCT, BUCKET);
  frames.push({ t: Date.now(), mid: r2(mid), v: a.venues.length, b: a.bids.map(([p, u]) => [p, r0(u)]), a: a.asks.map(([p, u]) => [p, r0(u)]) });
  if (frames.length % 30 === 0) console.log(`${new Date().toISOString()} frames=${frames.length} events=${events.length} mid=${mid.toFixed(1)} venues=${a.venues.join(',')}`);
}, FRAME_MS);

setTimeout(() => {
  clearInterval(iv);
  stop();
  for (const [s, f] of flow) {
    if (f.b) events.push({ type: 'flow', t: s * 1000, side: 'buy', usd: r0(f.b) });
    if (f.s) events.push({ type: 'flow', t: s * 1000, side: 'sell', usd: r0(f.s) });
  }
  events.sort((x, y) => x.t - y.t);
  const out = { recordedAt: new Date(t0).toISOString(), durationMs: Date.now() - t0, frameMs: FRAME_MS, bucketUsd: BUCKET, rangePct: RANGE_PCT, bigTradeUsd: BIG_TRADE, venueStatus: status, frames, events };
  const counts = events.reduce((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {});
  const liqUsd = events.filter((e) => e.type === 'liq').reduce((s, e) => s + e.usd, 0);
  console.log('summary', JSON.stringify({ frames: frames.length, counts, liqUsd: r0(liqUsd), status }));
  console.log('message counts', JSON.stringify(seen));
  if (frames.length < 10) { console.error('Too few frames recorded — not writing replay.'); process.exit(1); }
  fs.writeFileSync(path.join(here, 'replay.json'), JSON.stringify(out));
  console.log('wrote replay.json', (fs.statSync(path.join(here, 'replay.json')).size / 1e6).toFixed(2), 'MB');
  setTimeout(() => process.exit(0), 500);
}, MIN * 60000);
