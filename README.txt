Portfolio V5.24.5 - Net Worth timeline + dotted Net Asset Base

Deploy only index.html and sw.js to your existing GitHub Pages portfolio-tracker repo.
- Net Worth chart excludes legacy manual snapshots before 2026-10-12 in every range.
- Historical snapshots are NOT deleted from D1 or user backups. No database migration or destructive SQL.
- Dotted gray series = Net Asset Base (cash/bank assets + investment deposits/book value), using recorded historical base values; no invented history.
- Touch-and-hold shows Net Worth and Base for the selected date.
- Removed unused manual Add Snapshot modal and callbacks; automatic daily Net Worth history still runs.
- All other investment charts (including Questrade Cash) and V5.24.4 quote-history fixes unchanged.
- Automatic Cloud Sync remains on; no change to Cloudflare Worker or D1.

IMPORTANT: Cloudflare Worker snapshots and existing backups are preserved.
