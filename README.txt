Portfolio 5.24.4 - Sparse historical quote fix (All Accounts / Questrade TFSA)

Replace GitHub root index.html and sw.js, commit and push.

Fix:
- For sparse Yahoo quote histories, retry with a broader daily window.
- If an older ticker still lacks historical prices, preserve available
  portfolio history with a clearly labeled estimated component instead of
  discarding every date and showing a single dot.
- Dates before actual CIBC fund NAV availability remain unavailable: no
  historic NAVs are invented.
- Questrade Cash, CIBC-only NAV chart, sync data and cloud logic unchanged.

Estimated account chart values are not exact historical investment values.
No portfolio transactions, balances, or D1 data are modified.
