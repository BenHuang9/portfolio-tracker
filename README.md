# Portfolio reconciliation — confirmed balances (read-only)

**Prepared after confirmation of iPhone balances**: Cash CAD 7,080.00; CIBC Chequing CAD 11,998.72; CIBC Credit Card CAD 302.08.

Sources: local iPhone JSON export on 2026-10-16, current D1 revision 59 CSV. Files remain unchanged.

## Decision

- Prefer iPhone financial records where the two snapshots differ. The iPhone has 2 additional holding lots (MRVL and NBIS) and 5 extra ledger transactions, while the cloud snapshot has no unique lots or transactions relative to the phone.
- Keep the exact mobile account balances; do NOT sum the phone and cloud balances or replay ledger entries against already-updated balances.
- Preserve dated NAV entries from both sources only when valid and non-contradictory; verify time-series snapshot semantics before using it for charts.
- Historical net worth values and portfolio observations require review since there are different entries for the same dates.
- D1 payload has a **derived `cloudModel`** besides `storage`. It must be regenerated consistently with the storage and latest market data; do NOT submit the JSON candidate directly. Revision 59 must also be rechecked before any future write.

## Package contents

`proposed_storage_REVIEW_ONLY.json` is a non-executable **review artifact**. `cloudModel` is deliberately null to prevent passing a stale derived summary as if consistent. `comparison_summary.json` enumerates the differing keys and other safeguards.

## Safe next step

Implement a tested recovery/import flow that can validate and rebuild derived model fields, create an immutable server-side pre-restore backup, use conditional revision checks, and record all conflicts. Do not unpause cloud sync on both clients until the restored version and ledger counts have been independently verified.

Never paste a raw SQL UPDATE into D1 for this operation. Do not clear PWA storage or delete the iPhone app.
