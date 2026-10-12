V4.6 PAYMENT-DATE DIVIDENDS

1. Cloudflare Worker
   - Secret required: ALPHAVANTAGE_API_KEY
   - Replace Worker code with market-worker.js and Deploy.
   - Test: /health should show alphaVantageConfigured: true
   - Test: /dividends?symbol=AAPL should return source: Alpha Vantage and dividend rows.

2. GitHub Pages
   - Replace index.html and sw.js.
   - manifest.json and icons are unchanged, but included in this package for convenience.

Behavior
- Prices/search/history remain Yahoo Finance.
- Dividend eligibility uses exDate.
- YTD/month assignment uses paymentDate when Alpha Vantage provides it.
- USD dividends convert to CAD using USD/CAD near paymentDate.
- Future declared dividends are excluded from Received until paymentDate.
- Dividend history refresh is paced (~13 sec/ticker) and cached. First full sync can take a few minutes for many holdings; later loads use cache.
- If Alpha is unavailable/rate-limited for a ticker, Yahoo ex-date fallback keeps the app working.
