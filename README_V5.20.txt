Portfolio Tracker V5.20 Cloud First

What changed
- Cloudflare D1 becomes the primary synced copy when Cloud Sync is enabled.
- localStorage remains an offline cache; existing data is not deleted.
- App checks cloud revision on startup/resume and pulls a newer cloud copy automatically when safe.
- Local edits auto-sync with revision conflict protection.
- Cloud pushes maintain normalized D1 copies of accounts, transactions, investment accounts, lots, and net-worth history.
- Worker supports a scheduled daily Net Worth snapshot using current Yahoo prices, USD/CAD, and CIBC mutual-fund NAV.
- Daily server snapshots are merged back into the canonical cloud state, so the Home chart receives them next time the app opens.

Upgrade from V5.19
- Keep the existing D1 database, DB binding, and PORTFOLIO_SYNC_TOKEN secret.
- Replace index.html and sw.js on GitHub Pages.
- Replace market-worker.js in Cloudflare Worker and deploy.
- Add Cron Trigger: 15 0 * * *
- schema.sql is compatible with the existing V5.19 database; no destructive migration is required.

Verification
Open /health?v=520 and confirm:
- cloudDatabaseConfigured: true
- cloudSyncSecretConfigured: true
- cloudMode: v5.20 cloud-first
- dailyNetWorthSnapshotSupport: true
