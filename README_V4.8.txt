V4.8 — Official Dividend Payment Dates

WHAT CHANGED
- Harvest High Income Shares ETFs: tries Harvest official fund page first.
- Purpose Yield Shares ETFs: uses Purpose official fund page for mapped tickers.
- Other stocks/ETFs: Alpha Vantage next, Yahoo only as fallback.
- Eligibility still uses ex-dividend date.
- YTD/month/current-month placement uses actual payment date from exact sources.
- Alpha errors are sanitized so the API key is not echoed in the response/console.
- Exact issuer/Alpha data is never overwritten by Yahoo fallback.

DEPLOY
1) Cloudflare Worker: replace market-worker.js and Deploy.
2) Test /health.
3) Test /dividends?symbol=HHIS.TO and /dividends?symbol=YTSL.TO.
   Expected source: Harvest official / Purpose official.
4) After both tests work, update GitHub Pages files (index.html, sw.js; icons/manifest unchanged but included).

NOTE
Official site HTML can change. If an official parser stops matching, the Worker automatically falls back to Alpha/Yahoo instead of breaking the app.
