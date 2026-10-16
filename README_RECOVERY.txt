Portfolio V5.23.1 — Protected one-time cloud reconciliation

Deploy index.html and sw.js from this package on GitHub Pages.

On the ORIGINAL iPhone home-screen app (not Safari, not desktop):
1. Keep the verified local JSON backup in iPhone Files.
2. Enable network access if needed, open Settings -> Cloud Sync.
3. Select portfolio-local-backup-20261016-1632.json.
4. Click Check backup and cloud (read-only).
5. Only when checks pass: click Confirm one-time cloud recovery.
6. Do not restore on the phone. This version keeps automatic cloud syncing PAUSED after recovery.

Safety guards: checks >=61 lots, >=552 transactions, the three confirmed balances; ensures selected backup matches current local financial data; rejects any cloud-only trades; checks revision before PUT; PUT uses baseRevision and force=false. No SQL schema change.

Caution: It is not possible to guarantee no concurrent remote write between status and PUT unless the deployed Worker enforces atomic revision CAS. Check actual Worker version. Do not deploy this to the desktop and run recovery from the older Safari dataset.
