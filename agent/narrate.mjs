// Optional analyst narrative via the Claude API. Used only when ANTHROPIC_API_KEY
// is set (GitHub Actions secret). The model receives the computed analysis and is
// constrained to it: it explains mechanisms and interactions; it may not add data.

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are the senior market-structure analyst for an institutional Bitcoin research desk.
You write the "Analyst narrative" that accompanies a deterministic morning report.

Hard rules:
- Use ONLY numbers present in the supplied JSON/report. Never introduce a figure, event, or source that is not in the input. If something important is missing, say it is unavailable.
- Distinguish observation ("Observed:") from interpretation ("Interpretation:").
- No price predictions, targets, probabilities, or buy/sell language. This is about mechanism, not recommendation.
- Explain interactions between forces (e.g., how ETF flows interact with depth and leverage), not just each force in isolation.
- Where the data is stale or partial, say so.

Write in sober, precise institutional prose. Structure:
1. The one-paragraph answer to "What is driving BTC right now?" (rank the top forces and say why they dominate).
2. "How the forces interact today" — the transmission chain as it currently stands (who is the marginal buyer/seller, is there enough liquidity, is leverage involved).
3. "Could today's structure produce a sharp liquidation-driven move?" — current amplifiers and dampeners (depth, leverage, flows).
4. "What would change my reading" — specific observable thresholds.
Keep it under 900 words.`;

export async function narrate(analysis, reportMd, rows) {
  const client = new Anthropic();
  const compact = {
    dataThrough: analysis.dataThrough,
    regime: analysis.regime,
    attribution: analysis.attribution,
    forces: analysis.forces.map(({ id, name, rank, direction, confidence, state, evidence, interpretation, invalidation, d1, d7 }) => ({ id, name, rank, direction, confidence, state, evidence: evidence.map((e) => `${e.label}: ${e.value}`), interpretation, invalidation, d1, d7 })),
    scenarios: analysis.scenarios,
    changes: analysis.changes.slice(0, 10).map((c) => c.text),
    staleOrMissing: analysis.quality.filter((q) => q.status !== 'ok').map((q) => `${q.name}: ${q.status}`),
    recentDays: rows.slice(-14).map(({ date, price, etf5d, oiTotal, oiOkx, fundingAnn, depth1, dvol, corrNdx30, regime }) => ({ date, price, etf5d, oiTotal, oiOkx, fundingAnn, depth1, dvol, corrNdx30, regime })),
  };
  const stream = client.beta.messages.stream({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content: `Structured analysis (JSON):\n${JSON.stringify(compact)}\n\nDeterministic report:\n${reportMd}` }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('model declined (refusal)');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!text) throw new Error(`empty narrative (stop_reason ${msg.stop_reason})`);
  return { text, model: msg.model, generatedAt: new Date().toISOString() };
}
