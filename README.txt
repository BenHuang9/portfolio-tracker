Cash Balance Save Fix - 5.20.10

Based on the latest CIBC NAV Daily Chart front-end.

INSTALL
1. Replace index.html and sw.js in your existing GitHub repository folder.
2. Commit and Push to your normal branch.
3. Open the app after the site deployment completes.
4. Settings now has a Save button at the top. Enter Cash Balance and tap Save.

No Cloudflare Worker change, D1 schema update, Cron change or Python is required.
Do not clear browser data and do not restore an older cloud copy to install this fix.

BEHAVIOUR
- Valid investment account amounts save when you finish editing a field,
  tap Save, close Settings, or tap Refresh Now.
- Investment and Home totals update immediately from the saved local value.
- Cash-only edits do not alter Net Deposits or create expense/income transactions.
- Empty or invalid input does not erase a previous balance.
- The top status distinguishes local saving from pending cloud sync.
- Automatic cloud pulls are paused while Settings is open and rechecked before apply.
- A slow earlier cloud upload cannot clear the pending flag for a newer edit.
- The existing low-write cloud endpoints, CIBC NAV chart and stock return formulas remain in use.

TESTING
16 isolated tests passed with full-page Chromium DOM rendering at 393px and 320px.
Tests used mocked local storage and network responses, not a live phone or production D1.
Coverage includes all 3 accounts, refresh/close/save, invalid input, saved zero, a fresh page boot,
local storage failure, failed cloud sync, concurrent uploads, and delayed cloud pulls.
JavaScript syntax checks passed. Not deployed to your website or tested in iPhone Safari.
