# V5.20 Cloud First — deployment

V5.20 keeps the existing Cloudflare D1 database and turns the cloud copy into the primary synced state. localStorage remains as an offline cache, so the app still opens if the Worker is temporarily unavailable.

## Already completed from V5.19

- D1 database: `portfolio-tracker`
- D1 binding name: `DB`
- Worker secret: `PORTFOLIO_SYNC_TOKEN`
- Existing schema tables

You do **not** need to recreate the database or rerun `schema.sql` if V5.19 is already working.

## Deploy V5.20

1. Replace the Worker code with `market-worker.js` and deploy.
2. Replace GitHub Pages `index.html` and `sw.js`.
3. Keep the existing D1 binding and secret unchanged.
4. In Cloudflare Worker **Settings → Trigger events → Cron Triggers**, add:

```text
15 0 * * *
```

This runs at 00:15 UTC, which is after the North American market close in Vancouver year-round.

## Verify the Worker

Open:

```text
https://portfolio-market-data.benhuang011.workers.dev/health?v=520
```

Expected fields include:

```json
{
  "cloudDatabaseConfigured": true,
  "cloudSyncSecretConfigured": true,
  "cloudMode": "v5.20 cloud-first",
  "dailyNetWorthSnapshotSupport": true
}
```

## What changes in V5.20

- On startup/resume, the app checks the cloud revision.
- If cloud is newer and this device has no unsynced local edits, the latest cloud state is pulled automatically.
- Local edits are debounced and pushed automatically.
- Revision conflicts stop overwrites instead of silently choosing a side.
- Every cloud push also refreshes the normalized D1 tables for accounts, transactions, investment accounts, lots, and net-worth history.
- The scheduled Worker calculates a daily Net Worth snapshot from current Yahoo prices, USD/CAD, CIBC NAV, investment cash, manual accounts, and debts, then writes it into both `net_worth_daily` and the canonical cloud state.
- The next time a device opens the app, that server-generated history is pulled into the chart automatically.

## Optional manual daily-snapshot test

After V5.20 has synced once, you can POST to `/api/cloud/daily/refresh` with the same Bearer token. The app does not require this for normal use; the Cron Trigger does it automatically.

## Safety

- Existing D1 state is not deleted.
- Existing localStorage is not deleted.
- Before a manual restore, the device keeps an emergency local copy.
- A newer remote revision cannot be overwritten automatically by an older device.
