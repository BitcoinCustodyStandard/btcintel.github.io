// Keyword tags for news headlines. Deliberately simple and fully transparent:
// a headline is "bullish" or "bearish" only when it contains more words from one
// list than the other, and the matched words are kept so the page can show why.
// This is a label for skimming, not an assessment of the story or of the market.

export const BULL = [
  'surge', 'surges', 'soar', 'soars', 'rally', 'rallies', 'jump', 'jumps', 'climb', 'climbs', 'gain', 'gains',
  'record high', 'all-time high', 'new high', 'inflow', 'inflows', 'approve', 'approves', 'approved', 'approval',
  'adopt', 'adopts', 'adoption', 'buy', 'buys', 'bought', 'accumulate', 'accumulates', 'rebound', 'rebounds',
  'recover', 'recovers', 'breakout', 'bullish', 'rate cut', 'rate cuts', 'cuts rates', 'upgrade',
  'heads higher', 'moves higher', 'edges higher', 'pushes higher', 'rises', 'tops', 'short squeeze',
];
export const BEAR = [
  'plunge', 'plunges', 'crash', 'crashes', 'tumble', 'tumbles', 'slump', 'slumps', 'drop', 'drops', 'fall', 'falls',
  'sink', 'sinks', 'slide', 'slides', 'outflow', 'outflows', 'sell-off', 'selloff', 'sells', 'dump', 'dumps',
  'liquidated', 'liquidations', 'hack', 'hacked', 'exploit', 'exploited', 'stolen', 'ban', 'bans', 'banned',
  'lawsuit', 'sues', 'sued', 'fraud', 'charged', 'crackdown', 'bearish', 'fear', 'warns', 'rate hike', 'hikes rates',
  'bankrupt', 'bankruptcy', 'collapse', 'collapses', 'reject', 'rejects', 'rejected', 'delay', 'delays',
  'reverses', 'erases', 'pares', 'retreats', 'slips', 'falls below', 'drops below',
];

const re = (w) => new RegExp(`(^|[^a-z])${w.replace(/[-]/g, '[- ]?')}([^a-z]|$)`, 'i');
const BULL_RE = BULL.map((w) => [w, re(w)]), BEAR_RE = BEAR.map((w) => [w, re(w)]);

// → { tag: 'bullish' | 'bearish' | 'neutral', words: [matched words] }
export function tagHeadline(title) {
  const t = String(title || '');
  // who was liquidated decides the direction: shorts wiped out = forced buying
  const shortLiq = /short(s|-side)? (liquidations?|liquidated|squeezed?)|liquidat\w* (of )?shorts/i.test(t);
  const longLiq = /long(s|-side)? (liquidations?|liquidated)|liquidat\w* (of )?longs/i.test(t);
  const bull = BULL_RE.filter(([, r]) => r.test(t)).map(([w]) => w).concat(shortLiq ? ['short liquidations'] : []);
  const bear = BEAR_RE.filter(([w, r]) => r.test(t) && !(shortLiq && /^liquidat/.test(w))).map(([w]) => w).concat(longLiq ? ['long liquidations'] : []);
  // a negated bullish word ("fails to rally", "no inflows") is not counted as bullish
  const negated = /\b(fails? to|no|not|without|despite)\b/i.test(t);
  const b = negated ? 0 : bull.length, s = bear.length;
  if (b > s) return { tag: 'bullish', words: bull };
  if (s > b) return { tag: 'bearish', words: bear };
  return { tag: 'neutral', words: [...bull, ...bear] };
}
