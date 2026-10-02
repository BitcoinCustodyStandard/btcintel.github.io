// Data the system cannot observe from free primary sources, shown explicitly on the page.
export const UNAVAILABLE = [
  { metric: 'Exchange BTC balances / exchange net flows', why: 'Requires an on-chain entity-labelling provider (Glassnode, CryptoQuant, Coin Metrics Pro). Shown if the free Coin Metrics tier returns flow metrics.' },
  { metric: 'SOPR, LTH/STH supply, dormancy, realized P/L, whale cohorts', why: 'Requires Glassnode/CryptoQuant (paid). Not estimated.' },
  { metric: 'Aggregated liquidation history & observed liquidation heatmaps', why: 'CoinGlass/Kaiko require keys. This system shows OKX liquidations (sample) and a clearly-labelled model estimate of liquidation zones.' },
  { metric: 'CME futures open interest (live) and CME basis', why: 'No free real-time API. Weekly CFTC Commitments of Traders positioning is used instead.' },
  { metric: 'ETF assets under management / holdings', why: 'Issuer pages are not machine-readable reliably. BTC exposure implied by daily flows is computed instead.' },
  { metric: 'IBIT / CME options positioning', why: 'Not available free. Options analytics are Deribit-only (the largest crypto-native venue).' },
  { metric: 'Executed (vs displayed) liquidity at depth', why: 'Requires tick-level trade + book data (Kaiko). Displayed depth is shown with that caveat.' },
];
