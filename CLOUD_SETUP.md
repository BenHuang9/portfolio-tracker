# V5.19 Cloud Foundation — setup

V5.19 is intentionally conservative: **localStorage remains intact and remains usable even if cloud sync is offline**. Cloud sync only starts after you explicitly configure it.

## 1. Create the D1 database

In Cloudflare Dashboard:

1. Open **Workers & Pages → D1 SQL Database**.
2. Create a database, for example `portfolio-tracker`.
3. Open its SQL Console and run the entire `schema.sql` file included in this ZIP.

## 2. Bind D1 to your existing Worker

Open the existing Worker used by the app (`portfolio-market-data...workers.dev`).

Under **Settings → Bindings**, add a D1 database binding:

- Variable name: `DB`
- Database: the D1 database you just created

The variable name must be exactly `DB`.

## 3. Add a private sync token

Under the Worker's **Settings → Variables and Secrets**, add a **Secret**:

- Name: `PORTFOLIO_SYNC_TOKEN`
- Value: a long random private token (at least 32 random characters)

Do not put this token directly into `market-worker.js` or GitHub.

## 4. Deploy the V5.19 Worker

Replace the current Worker code with the included `market-worker.js`, then Deploy.

Check:

- `/health` should show `cloudDatabaseConfigured: true`
- `/health` should show `cloudSyncSecretConfigured: true`

## 5. Replace the front-end files

On GitHub Pages replace:

- `index.html`
- `sw.js`

No other front-end files are required.

## 6. Make the first backup

In the app:

1. Open **Settings**.
2. Under **Cloud Backup**, enter the same private sync token.
3. Turn on **Automatic cloud backup**.
4. Tap **Back Up This Device**.

This first operation copies the current device state to D1. It does **not** delete local data.

## Safety behavior

- Existing localStorage is never deleted by cloud backup.
- Automatic backup uses revision checking. A stale device cannot silently overwrite newer cloud data.
- If the cloud has a newer revision, auto-sync stops with a conflict message instead of overwriting it.
- **Back Up This Device** intentionally forces the current device to become the cloud copy.
- **Restore from Cloud** requires confirmation and first stores an emergency local JSON copy in `portfolioLocalBeforeCloudRestoreV519`.
- D1 also keeps one pre-overwrite backup per day in `portfolio_backups`.

## What V5.19 syncs

The lossless cloud state includes the important persistent data:

- investment lots
- Wealthsimple/Questrade cash and net-deposit settings
- manual Cash/Chequing/Savings/Credit Card accounts
- transactions
- Net Worth history
- one-time migration/import flags needed to prevent duplicate historical imports

Market quote caches and CIBC NAV caches are intentionally not synced; they can be rebuilt from the Worker.

## What comes next

The schema already includes normalized tables (`accounts`, `transactions`, `investment_accounts`, `investment_lots`, `net_worth_daily`). V5.19 does not switch the app to those tables yet. The safe sequence is:

1. Back up the exact current state to `portfolio_state`.
2. Verify D1 and restore on a second device.
3. Then migrate each feature to normalized cloud tables without risking the original data.
