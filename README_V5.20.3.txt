Portfolio Tracker V5.20.3 — Previous Close Fix

Fixes the Investment 1D / past day return showing $0.00 after market close.

Root cause:
The Worker previously inferred previousClose from the last two history candles. Background quote refreshes use a long weekly range, so the last weekly candle could equal the current regular-market price and incorrectly produce zero daily change.

Fix:
The Worker now uses Yahoo chart metadata (chartPreviousClose / previousClose) as the authoritative previous regular-session close, independent of requested range or interval. Historical-candle inference remains only as a fallback.

Deployment:
- REQUIRED: Replace market-worker.js in Cloudflare and Deploy.
- OPTIONAL: Replace index.html + sw.js if you want the package/version marker updated. Frontend logic from V5.20.2 is unchanged.
- No D1 schema changes.
- No Cron changes.
