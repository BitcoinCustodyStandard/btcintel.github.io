# Bitcoin Market Intelligence

A persistent research system that explains, every day, **which forces are driving Bitcoin's price, how they interact, where liquidity and positioning are concentrated, and what conditions could produce materially higher or lower prices**. It is not a trading signal: no recommendations, price targets or probabilities.

- **Page:** `https://btcintel.org/` (works on phone, tablet, desktop)
- **Agent:** GitHub Actions workflow `market-intel` — 07:00 every morning in `INTEL_TZ`, plus on demand
- **Archive:** `data/` — every run is kept; nothing is overwritten except the "latest" pointers
- **BTC Dashboard** (landing tab): live price, network, fees, mining, supply and halving, on-chain valuation, derivatives, ETFs and treasuries, news with keyword sentiment tags, Fear & Greed, and a live large-moves feed — all from free public sources. Feed workflow `dashboard-feed` refreshes `data/dash.json` every 15 minutes.

## How it works

```
collect (engine/collect.js)  →  merge with last snapshot (stale-labelling)
   →  analyze vs stored history (engine/analyze.js)
   →  brief (engine/brief.js) + condensed and full morning report (engine/report.js)  [+ optional Claude analyst narrative]
   →  persist: timeseries row, history/<date>.json, reports/<date>.md, latest.json
   →  commit → GitHub Pages republishes the page
```

### Page layout

The default **Overview** is a 60–90 second read: price and regime with a quiet data-status bar; today's three most important variables; the top 5 ranked forces (each row expands to full evidence, mechanism, invalidation and charts; the rest behind "Show all"); a liquidity ladder of key levels (full band table on expand); three acceleration cards (upside / base case / downside) with condition status; and what to watch in the next 24 hours. The KPI tiles and charts sit in a collapsed **Market dashboard**. Changes are called out on the overview only when they are at least 1.5σ versus the typical daily change. Other tabs: **On-chain cycle** (see below), **Morning report** (condensed, full report on expand), **Liquidity detail** (band table, depth by venue, order impact, options expiries), **Data & method**, **Archive**. The short copy is derived mechanically from the analysis (`engine/brief.js`) and adds no figures. Every tile, card, force, level and score has an ⓘ icon (hover, keyboard focus or tap) with a plain-English explanation from `engine/explain.js`: what it measures, why it matters, how to read today's zone, and one line of history — 3–5 short sentences, no unexplained jargon.

### Market Intelligence Engine (`engine/intel.js`)

Raw data → indicators → interpretation → five domains → market forces → Market read → valuation & cycle → narrative. Free data only, computed in the browser from the published files (and stored daily by the agent).

- **Five domains**: Technical, On-chain, Market structure, Sentiment, Macro & liquidity. About 80 indicators; each is read on its own −1…+1 scale (supportive / neutral / cautionary / deteriorating) against fixed thresholds and its own history. Context-only readings are shown but not scored.
- **No grand average**: indicators combine only inside a component (Trend, Valuation, Leverage…), components into a domain by fixed weights and explicit override rules (e.g. a negative long-term trend caps Technical; elevated leverage caps Market structure; extreme greed overrides Sentiment).
- **Forces**: detected from combinations of indicators (uptrend, institutional demand, leverage building, macro tightening…), each with direction, strength, confidence, horizon, persistence (days) and strengthening/weakening. Ranking weighs horizon so short-term signals cannot dominate structural ones.
- **Market read**: state, breadth (domains supportive), Fair Grade (50 + explicit contributions: trend, demand, network & holders, liquidity, positioning, breadth, risk and valuation adjustments, each scaled by data confidence), key drivers and offsets.
- **Conclusions**: valuation (MVRV, Mayer, 200-week average, Puell, supply in profit, holder cost bases), cycle phase (scored conditions; halving timing is context only) and risk regime.
- **What changed**: the engine is re-evaluated as of 2, 7 and 30 days ago and compared on the indicators known on both dates only.
- Views: the dashboard Market read card, the **Analysis** tab (every domain, component and indicator with source and date) and the **Intelligence** tab (narrative, drivers, offsets, cross-domain confirmation, changes, valuation, cycle, risk, Fair Grade breakdown). Tests: `agent/test/intel.test.mjs`.

### Site architecture (one source of truth)

DATA → INDICATORS → FIVE DOMAINS → CROSS-DOMAIN FORCES → INTELLIGENCE → DASHBOARD / ANALYSIS / CYCLE / REPORTS. Every page reads the same engine output; no page has its own calculation.

- **BTC Dashboard** (`#dashboard`): what is happening now — Market read (state, breadth, Fair Grade, drivers, offsets, 2/7/30-day changes).
- **Analysis** (`#analysis`): five domain tiles → domain research pages (`#analysis/technical`, `/on-chain`, `/market-structure`, `/sentiment`, `/macro-liquidity`) → component pages (`/c-liquidity`, `/c-leverage`, …) → indicator deep dives (`#analysis/macro-liquidity/g3`, `#analysis/technical/rsi`, …). Deep dives show the current value, its percentile and historical zone (2.5/10/90/97.5th percentiles of its own history), the full history chart computed by the engine for every past date, time in zone, 30-day direction, what followed similar readings (historical observation, not a forecast), interpretation with cross-domain confirmation, caveats, method, source and freshness. Research notes: `engine/indicator_docs.js`; views: `assets/research.js`.
- **Intelligence** (`#overview`): what matters now — forces, horizon view, confirmation, divergence, concentration and breadth, changes, valuation, cycle, risk, Fair Grade breakdown.
- **On-chain Cycle** (`#cycle`): the engine's cycle synthesis above the on-chain valuation cycle.
- **Reports** (`#reports`): morning report, archive, and the outline of the planned daily PDF (`engine/reportmodel.js`, built from the same engine output).
- The former *Liquidity detail* (order-book depth, impact, options expiries, $5K band map) is in-market liquidity and now lives on Market Structure (`#analysis/market-structure/liquidity`); external liquidity (net liquidity, M2, central-bank balance sheets) is on Macro & Liquidity. Old links (`#liquidity`, `#report`) redirect.
- **Long history** (`data/longhist.json`, `engine/longhist.js`): written by the daily run from free sources — FRED since 2015 (incl. NFCI), Yahoo Finance 10 years (DXY, Nasdaq, S&P 500, gold, VIX, ACWI), Coin Metrics full history (supply, exchange flows/balance, activity, hash rate), DefiLlama stablecoins, Fear & Greed since 2018, Wikipedia pageviews since 2016. Daily for two years, weekly before. A source that fails keeps its last series, marked stale.

### On-chain Cycle & Momentum (`engine/cycle.js`)

Where BTC sits in the historical on-chain valuation cycle — positioning research, not a signal. Rule-based and fully shown on the page:

| Input | Source | Zones (score) |
|---|---|---|
| MVRV | Coin Metrics `CapMVRVCur` (history since 2011) | <1.0 Deep value (+2) · 1.0–1.5 Value (+1) · 1.5–2.4 Neutral (0) · 2.4–3.2 Elevated (−1) · ≥3.2 Euphoria (−2) |
| Mayer Multiple | spot ÷ 200-day average (CoinGecko) | <0.8 (+2) · 0.8–1.0 (+1) · 1.0–1.5 (0) · 1.5–2.4 (−1) · ≥2.4 (−2) |
| Puell Multiple | derived: Coin Metrics `IssTotNtv` × `PriceUSD` ÷ 365-day average | <0.5 (+2) · 0.5–0.8 (+1) · 0.8–1.5 (0) · 1.5–2.5 (−1) · ≥2.5 (−2) |
| SOPR (7d avg) | BGeometrics free API | <0.98 (+1) · 0.98–1.03 (0) · ≥1.03 (−1) |
| % supply in profit | BGeometrics BTC in profit ÷ Coin Metrics supply | <55% (+2) · 55–70 (+1) · 70–90 (0) · 90–97 (−1) · ≥97 (−2) |
| NUPL, distance to realised price | derived from MVRV (NUPL = 1 − 1/MVRV) | context only — not double-scored |
| Hash Ribbons | derived: 30d vs 60d average hash rate | +1 only on a recovery cross after ≥10 days of capitulation |

Composite valuation = mean of the scored valuation inputs available (minimum 3): ≥+1.25 Deep value · +0.5…+1.25 Value · −0.5…+0.5 Neutral / mid-cycle · −1.25…−0.5 Elevated · ≤−1.25 Euphoria / stretched. Momentum = sum of four −1/0/+1 components (price vs 200-day average, 200-day slope, MVRV vs its 365-day average, stablecoin supply 30d); ≥+2 constructive, ≤−2 weakening. **BGeometrics free tier** (15 requests/day) is called at most once every 20 hours (2 requests) and carried forward between runs; values the provider flags as delayed (latest ~7 days withheld) are shown as “Data delayed — last good value as of …”.

The **same engine** runs in the agent (Node 22) and is used by the page to render the analysis. The page's single **Refresh** button polls the live price immediately, re-fetches the dashboard's live sources (mempool.space, CoinGecko) and reloads the published data files; the server-side data itself is produced by the scheduled `market-intel` (daily) and `dashboard-feed` (every 15 minutes) workflows, which can also be started manually from the Actions tab.

### Schedule and time zone

GitHub cron is UTC and has no daylight-saving awareness, so the workflow runs in two slots (10:45 and 11:45 UTC). The agent's gate waits until exactly 07:00 in `INTEL_TZ` in the correct slot and the other slot exits. GitHub can delay scheduled jobs under load; if the 07:00 slot starts late, the report is generated as soon as it starts (until 11:00 local). To change the time zone set the repository variable `INTEL_TZ` (Settings → Secrets and variables → Actions → Variables), e.g. `Europe/London`.

### Optional: analyst narrative

If the repository secret `ANTHROPIC_API_KEY` is set, each run adds an analyst narrative written by Claude (`claude-opus-5-5`) from the computed analysis only. It is constrained to the numbers in the input, must separate observation from interpretation, and may not predict prices. Without the key, the deterministic report is complete on its own.

## Data sources

| Area | Source | Frequency | Notes |
|---|---|---|---|
| Price, market cap, history | CoinGecko (fallback Coinbase candles) | intraday / daily | |
| Order-book depth | Coinbase, Kraken, Bitstamp, OKX, Binance, Bybit public books | snapshot per run | ±0.5/1/2% USD depth, imbalance, venue share, impact simulation |
| Perp/futures OI, funding | OKX, Binance, Bybit, Deribit, BitMEX, Hyperliquid | snapshot; 8h funding | Binance/Bybit often geo-block US servers → shown as unavailable |
| OI history, long/short, taker flow | OKX Trading Data | daily | single-venue consistent series |
| CME positioning | CFTC Traders in Financial Futures (code 133741) | weekly | |
| Basis curve | Deribit dated futures vs index | snapshot | |
| Options | Deribit (OI, IV, skew, gamma, max pain), DVOL | snapshot / daily | excludes CME and IBIT options |
| ETF flows | Farside Investors | daily | per fund, US$m |
| Macro | FRED: WALCL, WTREGEN, RRPONTSYD, WRESBAL, DFF, DGS2, DGS10, DFII10, T10YIE, DTWEXBGS, BAMLH0A0HYM2, VIXCLS, NASDAQCOM, SP500, ECBASSETSW, JPNASSETS, FX | daily/weekly/monthly | |
| Cross-asset | Yahoo Finance: gold & silver futures, DXY, Nasdaq-100, S&P 500, VIX, 10y | daily | |
| On-chain | Coin Metrics Community (MVRV, realised cap, hash rate, miner revenue), mempool.space, DefiLlama stablecoins | daily | |

**ETF fallback:** if Farside blocks the runner, add rows to `data/manual/etf_flows.csv` (`date,total_usd_m,IBIT,FBTC,...`, US$ millions). They fill missing dates only and are labelled as manual in the source table.

**Not available from free sources (shown explicitly on the page):** exchange balances and entity-labelled flows, SOPR/LTH/STH/dormancy/whale cohorts, aggregated liquidation history and observed heatmaps, live CME OI/basis, ETF AUM, IBIT/CME options, executed (vs displayed) depth.

## Methodology

**Never mixing methodologies silently.** Aggregate OI changes are computed only against history with the same venue set; otherwise the OKX daily series is used and labelled "OKX-only proxy". Depth changes likewise require the same venue set. Funding is normalised to an 8-hour rate and OI-weighted.

**Observed vs interpretation.** Every force shows *Current state (observed)*, *Evidence* (value · source · timestamp · frequency, or "Derived by this system"), *Transmission mechanism*, *Interpretation (analysis)*, change vs yesterday and vs one week ago, *what would invalidate it* and *what to watch*.

**Force ranking** = magnitude of the current change × structural relevance (e.g. ETF flows weighted by persistence; macro weighted by BTC's current correlation with equities). The score orders the list; it is not a forecast.

**Regime** (spot-, leverage-, derivatives-, macro- or liquidity-led) is scored from explicit thresholds (`T` in `engine/analyze.js`):

| Threshold | Value |
|---|---|
| Funding "hot" / "extreme" | > 15% / > 30% annualised |
| Leverage build / flush (7d OI) | > +8% / < −8% |
| Strong ETF demand | \|5-day net\| > $750M |
| Depth deterioration | ±1% depth < −15% vs 7 days earlier |
| High / low correlation | > 0.5 / < 0.15 (30-day) |

**Move attribution** classifies the last 24h and 7d as spot-driven rally, leverage-driven rally, short squeeze, spot-driven decline, leveraged long liquidation, reflexive liquidation cascade, or range variants, from price change × OI change × funding × ETF flows × depth change × liquidations. The label states how complete its inputs were.

**Liquidity map ($5K bands).** For each band: displayed book liquidity (only observable within ~±3%), **modelled** liquidation concentrations, Deribit option OI and near-dated gamma, days traded in the band over the past year (congestion), and markers (ETF flow-weighted basis, 200-day average, realised price). Tags use the language "potential acceleration zone / liquidity vacuum / short-squeeze zone / long-liquidation zone".

**Liquidation model (estimate, not data).** Leverage added on days when OKX OI rose (scaled to aggregate OI) is placed at that day's close, split long/short by the OKX account ratio, across a 5×/10×/25×/50× mix (25/35/25/15%) with 0.5% maintenance margin; positions whose liquidation price has already been crossed by the subsequent price path are removed. It locates *plausible* clusters; it does not observe them.

**Options.** Gamma from Black-Scholes with Deribit mark IV, expressed as $ hedge change per 1% move. Dealer sign is not observable, so the page states both possibilities (pinning if dealers are long gamma, acceleration if short).

**Scenarios** list what must happen first (with today's status), confirming and contradicting indicators, acceleration levels from the map, the liquidity mechanism and the failure condition. No probabilities.

## Asking the archive

From a checkout:

```bash
node agent/query.mjs between 2026-02-05 2026-03-05   # what changed between two dates
node agent/query.mjs selloff     # what preceded the last ≥15% selloff
node agent/query.mjs liquidity   # when liquidity began deteriorating
node agent/query.mjs etf         # when ETF flows turned
node agent/query.mjs funding     # when funding became extreme
node agent/query.mjs oi          # when OI began increasing
node agent/query.mjs decouple    # when BTC decoupled from the Nasdaq
```

On the first run the agent **backfills ~1 year** of daily rows from series that carry history (price, ETF flows, OKX OI, funding, DVOL, macro, MVRV, stablecoins, BTC–Nasdaq correlation). Order-book depth, aggregate OI and the options surface cannot be backfilled from free sources and accumulate from the first live run.

## Files

```

  index.html, assets/          the page
  engine/                      collect · analyze · report · history queries · reference library (shared by page and agent)
  agent/feed.mjs               BTC Dashboard feed (news RSS, Fear & Greed, treasuries, volume, exchange flows) → data/dash.json
  assets/dash.js · pricechart.js · network.js · moves.js   dashboard · price chart (averages, ±2σ envelope) · mempool.space · large moves
  engine/envelope.js           50/100/200-day averages and the 20-day ±2σ volatility envelope
  engine/dca.js · assets/dcapage.js   DCA backtest page (#dca): schedules, XIRR, drawdown, lump-sum and every-window comparisons
  agent/run.mjs                the daily agent;  agent/narrate.mjs  optional Claude narrative
  agent/query.mjs              archive questions (CLI);  agent/test/offline.mjs  synthetic end-to-end test
  data/latest.json             current analysis (what the page shows)
  data/snapshot.json           last raw snapshot (for stale carry-forward)
  data/timeseries.json         one row per day — the queryable history (feeds the daily charts)
  data/runs.json               one point per agent run — depth, aggregate OI, Coinbase premium charts
  data/history/<id>.json       full analysis for every run (<date> = 07:00 report, <date>-HHMM = refresh)
  data/reports/<id>.md         the morning report as Markdown (condensed brief, then the full report)
  data/index.json              archive index
```

Run locally: `cd agent && npm ci && node run.mjs` (live) or `node test/offline.mjs` (synthetic data, writes to a temp dir only).

## Market Battlefield (`/battlefield/`)

A real-time visualization of order-book pressure, trades and liquidations. Not built yet; the page is a placeholder.
