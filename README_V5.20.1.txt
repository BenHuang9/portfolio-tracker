Portfolio Tracker V5.20.1 — D1 Write Hotfix

Fixes Cloudflare D1 free-tier write amplification in V5.20.

Changes:
- Device sync now writes only the authoritative portfolio_state + daily backup row.
- Structured accounts/transactions/lots tables are rebuilt only once per day by Cron, not on every sync.
- Automatic Net Worth market refresh updates today's local chart point without triggering cloud writes every refresh.
- Cloud sync debounce increased to 2 seconds to combine related user changes.
- The post-midnight Cron snapshot is labeled as the day that just ended.
- Recommended Cron remains 15 8 * * * UTC.

Existing D1 data and localStorage are preserved. No schema migration is required.
