Portfolio 5.21.3 - Scroll-first chart input

Files to deploy:
  index.html
  sw.js
Replace these two files in the existing website repository, commit and push.
Wait for the site deployment to finish, then close and reopen the app.
Settings now shows "UI version 5.21.3" below the exchange-rate note so the
installed UI can be identified.

Do NOT change the Worker, D1 schema, cron or sync token.
Do NOT clear browser/app data or restore a cloud copy for this UI update.
No account balances, transactions, cash settings or chart data are reset.

Changes from 5.21.2:
- Chart touchmove is passive. Chart touch handlers never preventDefault.
- No touch pointer capture, global scroll lock or manual scrollTop/scrollTo.
- Chart touches no longer change hero heights during a gesture.
- Native page scrolling takes priority over inspecting a value.
- Horizontal reading, stationary hold, release and keyboard/mouse input remain.
- A small build label identifies the installed version in Settings.

Known browser behaviour:
A long, clearly horizontal swipe can be direction-railed by the browser. A
same-finger turn to vertical may not scroll until the finger is lifted. This
build stops the chart selection and leaves the next vertical gesture usable;
it does NOT claim to force native scrolling to change direction mid-gesture.

Tests are simulated mobile Chromium, not a physical iPhone/Safari run.
