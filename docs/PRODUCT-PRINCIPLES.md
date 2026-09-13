# MARS PRO V3 Product Principles

MARS is manual trading decision support, not an auto-trader or prediction guarantee.

- BUY, SELL, and WAIT are valid outputs; unsafe or unclear context must immediately return WAIT.
- Actionable signals require fresh data, a valid asset, positive quote, supported timeframe, and usable chart/candle quality.
- Evidence confidence is not win probability. Setup risk is uncertainty, not promised profit/loss.
- Market context must combine trend, momentum, structure, volatility, support/resistance, candles, regime, timeframe, and quality; indicator voting alone cannot force a trade.
- Missing/stale quotes must clear price and indicative P&L instead of leaving frozen values.
- Placed-trade lifecycle, setup health, and indicative P&L are separate.
- All executions remain auditable; only verified clean LIVE outcomes with complete finite features may train the LIVE model.
- Release automation cannot guarantee profitability. Production-ready claims require a logged-in user-device DEMO end-to-end test.
