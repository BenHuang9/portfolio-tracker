Portfolio Tracker V5.20.2 - 1D Return Fix

- Fixes the Investment 1D headline return.
- 1D chart still shows today's intraday market movement.
- 1D return now uses current price versus previous regular-session close.
- The headline 1D return now matches the sum of the TODAY column for the selected account.
- Preserves V5.20.1 low-write D1 hotfix and all cloud-sync behavior.

Deployment:
- GitHub: replace index.html and sw.js.
- Cloudflare Worker: no change required from V5.20.1.
- D1 schema / cron / bindings: no change required.
