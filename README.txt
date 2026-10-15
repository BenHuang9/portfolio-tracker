Portfolio 5.21.0 - Consistent account charts

INSTALL (2 FILES ONLY)
Replace index.html and sw.js in your EXISTING GitHub website folder, then Commit and Push.
Keep the current Cloudflare Worker, D1 schema, Cron and Sync Token unchanged.
Do not clear browser data. Do not use Restore from Cloud to install this update.

CHANGES
- One renderer for Investment, Home Net Worth and bank/credit-card account value charts.
- Drag selects an actual stored/data-source point. No interpolated tooltip prices.
- The hero amount changes while dragging; release restores the current amount.
- Same vertical guide, selected dot, faded right-hand segment and chart geometry.
- Normal vertical page scrolling is preserved; chart gestures no longer fix the entire body.
- Investment 1D uses intraday one-minute quote bars and checks for updates every 60 seconds
  while the app is visible. Actual quote time is displayed, not just request time.
- Investment 1W and longer select one amount per actual date, including Questrade Cash.
- Questrade Cash with holdings is valued as holdings plus cash. Cash is never multiplied
  by the stock-growth curve. A genuinely cash-only account uses saved balance observations.
- CIBC 1D remains a single latest published NAV observation, not an intraday stock chart.
  Longer CIBC ranges use its existing dated NAV records; no invented backfill.
- Long-range chart previous-close fields are NOT used for daily return calculations.
  The preceding daily candle is selected relative to the quote's actual session date.
- Existing Total Return / Net Deposit definitions and saved user records are retained.

CLOUD CONFLICTS
A baseline-aware merge preserves non-overlapping edits and server-created daily snapshots.
True overlapping changes stop for review, rather than silently force-overwriting cloud data.
For a pre-existing conflict without enough baseline history, tap Sync This Device to review
which local balance to keep. This path preserves unrelated cloud transactions/history.
New quote checks do not perform D1 writes. The current low-write Worker stays in place.
Intraday observation storage is compact and bounded; daily observations are retained.

LIMITS / HONEST DATA LABELS
The Yahoo proxy is not a guaranteed real-time broker stream. It may be delayed or unavailable,
and its regular-session quote need not match Wealthsimple extended-hours/overnight prices.
Historical cash before this app recorded it is estimated using the latest known cash amount;
this is labeled under the chart. It is not a complete brokerage account-statement reconstruction.
Mutual-fund historical NAV is limited to the real dates already available.

TESTS
40 isolated Chromium checks passed at 393px and 320px, including CDP touch events,
quote refresh, no duplicate daily tooltip values, correct cash weighting, missing data,
cloud conflicts and no D1 writes from quote polling alone. Fixtures were simulated.
Not deployed for you; not tested on a physical iPhone / Safari. See TEST_REPORT.txt.
