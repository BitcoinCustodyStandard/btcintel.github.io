// Offline checks for the dashboard feed: RSS parsing, relevance filter and keyword tags.
import assert from 'node:assert/strict';
import { parseRss, FEEDS } from '../feed.mjs';
import { tagHeadline } from '../../engine/sentiment.js';

const xml = `<rss><channel>
<item><title><![CDATA[Bitcoin surges past $90K as ETF inflows climb]]></title><link>https://example.com/a</link><pubDate>Fri, 02 Oct 2026 15:00:00 GMT</pubDate></item>
<item><title>Ether staking upgrade ships</title><link>https://example.com/b</link><pubDate>Fri, 02 Oct 2026 14:00:00 GMT</pubDate></item>
<item><title>Bitcoin miners sell as BTC falls &amp; hashprice drops</title><link>https://example.com/c</link><pubDate>Fri, 02 Oct 2026 13:00:00 GMT</pubDate></item>
<item><title>No link item about bitcoin</title><pubDate>Fri, 02 Oct 2026 13:00:00 GMT</pubDate></item>
</channel></rss>`;
const coindesk = FEEDS.find((f) => f.name === 'CoinDesk');
const items = parseRss(xml, coindesk, Date.parse('2026-10-02T16:00:00Z'));
assert.equal(items.length, 2, 'non-bitcoin and link-less items are dropped');
assert.equal(items[0].tag, 'bullish');
assert.deepEqual([...items[0].words].sort(), ['climb', 'inflows', 'surges']);
assert.equal(items[1].title, 'Bitcoin miners sell as BTC falls & hashprice drops');
assert.equal(items[1].tag, 'bearish');

assert.equal(tagHeadline('Bitcoin trades sideways ahead of CPI').tag, 'neutral');
assert.equal(tagHeadline('Bitcoin fails to rally despite inflows').tag, 'neutral');
assert.equal(tagHeadline('Exchange hacked, $40M stolen').tag, 'bearish');
assert.equal(tagHeadline('Federal Reserve issues statement').tag, 'neutral');
assert.equal(tagHeadline('Bitcoin sell-off deepens').tag, 'bearish');

const fed = FEEDS.find((f) => f.name === 'Federal Reserve');
const fx = parseRss(`<item><title>Federal Reserve Board issues enforcement action with Example Bank</title><link><![CDATA[https://www.federalreserve.gov/x]]></link><pubDate>Fri, 02 Oct 2026 13:00:00 GMT</pubDate></item><item><title>Minutes of the Federal Open Market Committee</title><link>https://www.federalreserve.gov/y</link><pubDate>Fri, 02 Oct 2026 13:00:00 GMT</pubDate></item>`, fed, Date.parse('2026-10-02T16:00:00Z'));
assert.equal(fx.length, 1, 'Fed enforcement actions are filtered out');
assert.equal(fx[0].macro, true);
console.log('feed tests passed');
assert.equal(tagHeadline('Bitcoin reaches for $87K as short liquidations top $120M').tag, 'bullish');
assert.equal(tagHeadline('Long liquidations hit $300M as bitcoin slides').tag, 'bearish');
assert.equal(tagHeadline('Live updates: Bitcoin reverses big early gains following soft U.S. jobs data').tag, 'neutral');
assert.equal(tagHeadline('Bitcoin Heads Higher on Macro Moves').tag, 'bullish');
console.log('sentiment edge cases passed');
{ // daily headline tally: crypto feeds only, partly covered days never lose their stored count, 400-day cap
  const { tallyDays } = await import('../feed.mjs');
  const t = tallyDays([{ t: '2026-10-03T01:00:00Z', tag: 'bullish' }, { t: '2026-10-03T02:00:00Z', tag: 'bearish' }, { t: '2026-10-02T02:00:00Z', tag: 'neutral' }, { t: '2026-10-02T03:00:00Z', tag: 'neutral', macro: true }], [['2024-01-01', 9, 1, 1], ['2026-10-02', 4, 1, 0]], Date.parse('2026-10-04'));
  const assert2 = (await import('node:assert/strict')).default;
  assert2.deepEqual(t, [['2026-10-02', 4, 1, 0], ['2026-10-03', 2, 1, 1]]);
  console.log('news tally ok');
}
