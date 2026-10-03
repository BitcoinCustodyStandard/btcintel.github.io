// Bitcoin network state from mempool.space (free, CORS-enabled): blocks, fees,
// mempool, difficulty adjustment, hash rate and the last 144 blocks' rewards.
// REST on load, then the mempool.space WebSocket pushes blocks and mempool stats;
// if the socket drops, REST polling every 60 s takes over until it reconnects.
// The chain tip is also polled every 20 s from mempool.space, falling back to
// blockstream.info and blockchain.info, so the latest block stays live even when one
// provider is blocked or down. The server snapshot is used only if all of them fail.

const API = 'https://mempool.space/api';
export const N = { height: null, tipTime: null, blocks: [], fees: null, mempool: null, da: null, hash: null, reward: null, at: null, ws: 'connecting', errors: {}, tipSource: null, lastLive: null };

// AbortController-based timeout: AbortSignal.timeout() is missing in older Safari
export function timeoutSignal(ms) { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; }
async function fetchAny(url, type = 'json', ms = 8000) {
  const r = await fetch(url, { cache: 'no-store', signal: timeoutSignal(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return type === 'json' ? r.json() : r.text();
}
const j = (path) => fetchAny(API + path);
const setBlocks = (bl) => {
  const m = new Map(N.blocks.map((b) => [b.height, b]));
  // keep richer details (pool, fees) already known for a height when a simpler source reports it again
  for (const b of bl) { const o = m.get(b.height) || {}; m.set(b.height, { height: b.height, t: b.timestamp * 1000, tx: b.tx_count ?? o.tx ?? null, size: b.size ?? o.size ?? null, reward: b.extras?.reward ?? o.reward ?? null, fees: b.extras?.totalFees ?? o.fees ?? null, pool: b.extras?.pool?.name ?? o.pool ?? null, poolSlug: b.extras?.pool?.slug ?? o.poolSlug ?? null, id: b.id ?? o.id ?? null }); }
  N.blocks = [...m.values()].sort((a, b) => b.height - a.height).slice(0, 15);
  N.height = N.blocks[0]?.height ?? N.height; N.tipTime = N.blocks[0]?.t ?? N.tipTime;
};

// Fill gaps from the server's 15-minute snapshot (data/dash.json → network) so cards are not
// empty when this browser cannot reach mempool.space. Live data replaces it as it arrives.
export function seedNetwork(snap) {
  if (!snap?.blocks?.length || N.live) return;
  setBlocks(snap.blocks);
  N.fees = N.fees || snap.fees;
  N.mempool = N.mempool || { count: snap.mempool.count, vsize: snap.mempool.vsize, totalFee: snap.mempool.total_fee };
  N.da = N.da || snap.da;
  N.hash = N.hash || { current: snap.hash.currentHashrate, difficulty: snap.hash.currentDifficulty };
  N.reward = N.reward || { start: snap.reward.startBlock, end: snap.reward.endBlock, total: +snap.reward.totalReward, fees: +snap.reward.totalFee, tx: +snap.reward.totalTx };
  N.at = N.at || Date.parse(snap.at);
  N.seeded = Date.parse(snap.at);
}

let api = null;
// re-fetch everything now (used by the automatic refresh); the WebSocket keeps running
export const refreshNetwork = () => (api ? Promise.all([api.fast(), api.slow(), api.tip()]) : Promise.resolve());

// chain-tip providers, tried in order; each returns blocks in mempool.space's shape (newest first)
const TIP = [
  { name: 'mempool.space', height: () => fetchAny('https://mempool.space/api/blocks/tip/height', 'text').then(Number), blocks: () => fetchAny('https://mempool.space/api/v1/blocks') },
  { name: 'blockstream.info', height: () => fetchAny('https://blockstream.info/api/blocks/tip/height', 'text').then(Number), blocks: () => fetchAny('https://blockstream.info/api/blocks') },
  { name: 'blockchain.info', height: () => fetchAny('https://blockchain.info/latestblock?cors=true').then((b) => b.height), blocks: () => fetchAny('https://blockchain.info/latestblock?cors=true').then((b) => [{ height: b.height, timestamp: b.time, id: b.hash, tx_count: b.txIndexes?.length ?? null }]) },
];
const tipHealth = TIP.map(() => ({ fails: 0, skipUntil: 0 }));
async function pollTip(onNewBlock) {
  for (let i = 0; i < TIP.length; i++) {
    const s = TIP[i], h = tipHealth[i];
    if (Date.now() < h.skipUntil) continue;
    try {
      const height = await s.height();
      if (!(height > 0)) throw new Error('bad height');
      const prev = N.height;
      if (height !== prev || !N.blocks.length || !N.live) setBlocks(await s.blocks());
      h.fails = 0; N.tipSource = s.name; N.lastLive = Date.now(); N.live = true;
      if (prev && N.height > prev) onNewBlock(N.blocks[0]);
      return true;
    } catch { if (++h.fails >= 3) { h.skipUntil = Date.now() + 5 * 60e3; h.fails = 0; } }
  }
  return false;
}

export function startNetwork({ onUpdate, onBlock }) {
  let ws = null, poll = null, tries = 0, slowT = 0;
  const done = (live = true) => { if (live) { N.at = Date.now(); N.live = true; N.lastLive = Date.now(); N.tipSource = N.tipSource || 'mempool.space'; } onUpdate(N); };
  const get = async (k, path, fn) => { try { fn(await j(path)); delete N.errors[k]; } catch (e) { N.errors[k] = e.message; } };
  const fast = () => Promise.all([
    get('blocks', '/v1/blocks', setBlocks),
    get('fees', '/v1/fees/recommended', (v) => { N.fees = v; }),
    get('mempool', '/mempool', (v) => { N.mempool = { count: v.count, vsize: v.vsize, totalFee: v.total_fee }; }),
    get('da', '/v1/difficulty-adjustment', (v) => { N.da = v; }),
  ]).then(() => done(!N.errors.blocks || !N.errors.fees));
  // hash rate and the 144-block reward window change only per block
  const slow = () => { slowT = Date.now(); return Promise.all([
    get('hash', '/v1/mining/hashrate/3d', (v) => { N.hash = { current: v.currentHashrate, difficulty: v.currentDifficulty }; }),
    get('reward', '/v1/mining/reward-stats/144', (v) => { N.reward = { start: v.startBlock, end: v.endBlock, total: +v.totalReward, fees: +v.totalFee, tx: +v.totalTx }; }),
  ]).then(() => done(!N.errors.hash || !N.errors.reward)); };
  const startPoll = () => { if (!poll) poll = setInterval(() => { fast(); if (Date.now() - slowT > 300e3) slow(); }, 60e3); };
  const connect = () => {
    try { ws = new WebSocket('wss://mempool.space/api/v1/ws'); } catch { N.ws = 'down'; startPoll(); return; }
    ws.onopen = () => { tries = 0; N.ws = 'live'; clearInterval(poll); poll = null; ws.send(JSON.stringify({ action: 'want', data: ['blocks', 'stats'] })); done(false); };
    ws.onmessage = (m) => {
      let d; try { d = JSON.parse(m.data); } catch { return; }
      if (d.blocks) setBlocks(d.blocks);
      if (d.block) { const prev = N.height; setBlocks([d.block]); N.tipSource = 'mempool.space'; if (prev && d.block.height > prev) { onBlock(N.blocks[0]); slow(); get('da', '/v1/difficulty-adjustment', (v) => { N.da = v; }).then(done); } }
      if (d.mempoolInfo) N.mempool = { ...(N.mempool || {}), count: d.mempoolInfo.size, vsize: d.mempoolInfo.bytes };
      if (d.fees) N.fees = d.fees;
      if (d.da) N.da = d.da;
      if (d.blocks || d.block || d.mempoolInfo || d.fees || d.da) done();
    };
    ws.onclose = () => { N.ws = 'reconnecting'; done(false); startPoll(); if (tries < 10) setTimeout(connect, Math.min(60e3, 3000 * 2 ** tries++)); else N.ws = 'down'; };
    ws.onerror = () => { try { ws.close(); } catch {} };
    const ping = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ action: 'ping' })); else if (ws.readyState > 1) clearInterval(ping); }, 30e3);
  };
  // chain tip every 20 s while the page is visible, whatever the WebSocket is doing
  const tip = () => pollTip((b) => { onBlock(b); slow(); }).then((ok) => { if (ok) onUpdate(N); });
  setInterval(() => { if (!document.hidden) tip(); }, 20e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tip(); });
  api = { fast, slow, tip };
  fast(); slow(); connect(); tip();
  return N;
}

// ---------- derived values (pure, from the schedule and mempool.space data) ----------
export const HALVING_INTERVAL = 210000;
const subsidySats = (h) => { const e = Math.floor(h / HALVING_INTERVAL); return e >= 64 ? 0 : Math.floor(50e8 / 2 ** e); };
// coins issued by the schedule through block `height` (inclusive), in BTC
export function issuedSupply(height) {
  let sats = 0, h = 0;
  while (h <= height) { const end = Math.min(height, (Math.floor(h / HALVING_INTERVAL) + 1) * HALVING_INTERVAL - 1); sats += (end - h + 1) * subsidySats(h); h = end + 1; }
  return sats / 1e8;
}
export const subsidyBtc = (height) => subsidySats(height) / 1e8;
export const nextHalving = (height) => (Math.floor(height / HALVING_INTERVAL) + 1) * HALVING_INTERVAL;
// expected revenue per PH/s per day, from difficulty: blocks/day for 1 PH/s = 86400·1e15 / (D·2^32)
export function hashprice(avgRewardBtc, price, difficulty) {
  if (!(avgRewardBtc > 0 && price > 0 && difficulty > 0)) return null;
  return (avgRewardBtc * price * 86400 * 1e15) / (difficulty * 2 ** 32);
}
