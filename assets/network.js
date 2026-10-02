// Bitcoin network state from mempool.space (free, CORS-enabled): blocks, fees,
// mempool, difficulty adjustment, hash rate and the last 144 blocks' rewards.
// REST on load, then the mempool.space WebSocket pushes blocks and mempool stats;
// if the socket drops, REST polling every 60 s takes over until it reconnects.

const API = 'https://mempool.space/api';
export const N = { height: null, tipTime: null, blocks: [], fees: null, mempool: null, da: null, hash: null, reward: null, at: null, ws: 'connecting', errors: {} };

async function j(path) {
  const r = await fetch(API + path, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const setBlocks = (bl) => {
  const m = new Map(N.blocks.map((b) => [b.height, b]));
  for (const b of bl) m.set(b.height, { height: b.height, t: b.timestamp * 1000, tx: b.tx_count, size: b.size, reward: b.extras?.reward ?? null, fees: b.extras?.totalFees ?? null, pool: b.extras?.pool?.name ?? null });
  N.blocks = [...m.values()].sort((a, b) => b.height - a.height).slice(0, 15);
  N.height = N.blocks[0]?.height ?? N.height; N.tipTime = N.blocks[0]?.t ?? N.tipTime;
};

export function startNetwork({ onUpdate, onBlock }) {
  let ws = null, poll = null, tries = 0, slowT = 0;
  const done = () => { N.at = Date.now(); onUpdate(N); };
  const get = async (k, path, fn) => { try { fn(await j(path)); delete N.errors[k]; } catch (e) { N.errors[k] = e.message; } };
  const fast = () => Promise.all([
    get('blocks', '/v1/blocks', setBlocks),
    get('fees', '/v1/fees/recommended', (v) => { N.fees = v; }),
    get('mempool', '/mempool', (v) => { N.mempool = { count: v.count, vsize: v.vsize, totalFee: v.total_fee }; }),
    get('da', '/v1/difficulty-adjustment', (v) => { N.da = v; }),
  ]).then(done);
  // hash rate and the 144-block reward window change only per block
  const slow = () => { slowT = Date.now(); return Promise.all([
    get('hash', '/v1/mining/hashrate/3d', (v) => { N.hash = { current: v.currentHashrate, difficulty: v.currentDifficulty }; }),
    get('reward', '/v1/mining/reward-stats/144', (v) => { N.reward = { start: v.startBlock, end: v.endBlock, total: +v.totalReward, fees: +v.totalFee, tx: +v.totalTx }; }),
  ]).then(done); };
  const startPoll = () => { if (!poll) poll = setInterval(() => { fast(); if (Date.now() - slowT > 300e3) slow(); }, 60e3); };
  const connect = () => {
    try { ws = new WebSocket('wss://mempool.space/api/v1/ws'); } catch { N.ws = 'down'; startPoll(); return; }
    ws.onopen = () => { tries = 0; N.ws = 'live'; clearInterval(poll); poll = null; ws.send(JSON.stringify({ action: 'want', data: ['blocks', 'stats'] })); done(); };
    ws.onmessage = (m) => {
      let d; try { d = JSON.parse(m.data); } catch { return; }
      if (d.blocks) setBlocks(d.blocks);
      if (d.block) { const prev = N.height; setBlocks([d.block]); if (prev && d.block.height > prev) { onBlock(N.blocks[0]); slow(); get('da', '/v1/difficulty-adjustment', (v) => { N.da = v; }).then(done); } }
      if (d.mempoolInfo) N.mempool = { ...(N.mempool || {}), count: d.mempoolInfo.size, vsize: d.mempoolInfo.bytes };
      if (d.fees) N.fees = d.fees;
      if (d.da) N.da = d.da;
      if (d.blocks || d.block || d.mempoolInfo || d.fees || d.da) done();
    };
    ws.onclose = () => { N.ws = 'reconnecting'; done(); startPoll(); if (tries < 10) setTimeout(connect, Math.min(60e3, 3000 * 2 ** tries++)); else N.ws = 'down'; };
    ws.onerror = () => { try { ws.close(); } catch {} };
    const ping = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ action: 'ping' })); else if (ws.readyState > 1) clearInterval(ping); }, 30e3);
  };
  fast(); slow(); connect();
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
