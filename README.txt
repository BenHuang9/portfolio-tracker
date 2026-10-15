Portfolio 5.21.2 - Native scrolling recovery

INSTALL
Replace only index.html and sw.js in your existing GitHub website folder.
Commit and Push. After Pages deploys, close and reopen the app.
Keep all other website files (manifest and icons) in place.
No Python, terminal commands, database changes or Worker changes are required.
Do not clear browser data, remove the app, or use Restore from Cloud for this update.

FIX
Vertical gestures stay native, including a vertical drag after a pause/hold.
The chart no longer simulates scrollTop or captures every finger immediately.
Horizontal dragging still selects actual recorded points. Still finger = still value.
Vertical page motion cancels inspection cleanly; release/cancel/backgrounding
also releases it. Native scrolling is no longer blocked by BODY overflow rules.
Quote-result rendering waits until scrolling has stopped.
Removed the global double-tap touchend preventDefault handler which could
swallow quick navigation taps.

Account amounts, investment formulas, saved cash, ledger, cloud sync and daily
snapshot logic are unchanged. See TEST_REPORT.txt for tested cases and limits.
