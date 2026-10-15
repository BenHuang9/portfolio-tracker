Portfolio 5.21.1 - Stable chart interaction
Based on the supplied portfolio_charts_consistent_v5_21.zip.

INSTALL
Replace ONLY index.html and sw.js in your existing GitHub website folder.
Commit and Push. Close/reopen the web app after deployment.
No Python, no dependency installation, no database migration.
Do not clear browser data. Do not use Restore from Cloud to install this update.
Keep the existing Cloudflare Worker, D1 database, Cron and Sync Token unchanged.

FIXES
- Chart gestures have one owner and a direction decision: a horizontal drag or
  deliberate hold selects points; a vertical-first drag scrolls the nearest page
  container without briefly showing and cancelling a historical amount.
- Vertical drift during an already-active scrub no longer gives the gesture back
  to browser scrolling. The whole body is never fixed or repositioned.
- Still finger = still value. Text is changed only on entering a different real
  data point; a small boundary tolerance prevents flicker near the midpoint.
- Quote/history responses arriving while a chart is held do not dispose the chart
  or reset the selected value. Automatic cloud pulls also wait for the gesture.
- Quiet refresh retains the existing graph; identical series keep the same SVG.
- Chart/hero geometry is held fixed while selecting dates. Bank-account date
  labels have reserved space so they cannot push the chart downward.
- Pointer release/cancel/lost-capture cleanup is idempotent; current amounts are
  restored once, not repeatedly. Pending visual refresh is coalesced after release.

UNCHANGED
- Values, quote sources, current-amount calculations and return formulas.
- Daily vs intraday chart data and real-point-only selection.
- Cash Balance Save Fix; transaction, account and investment records.
- Cloud merge/write logic, Worker/D1/Cron behavior and low-write protection.

TEST LIMITS
Tested with isolated system Chromium at 393px and 320px mobile dimensions using
CDP touch input and mocked market/cloud responses. Not deployed for the user.
Not tested on a physical iPhone or Safari. See TEST_REPORT.txt.
