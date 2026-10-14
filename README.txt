Portfolio Tracker UI Consistency Pass

Scope reviewed: Home, Investment, CIBC Mutual Fund, Transactions, Stats, Settings and sheet/dialog component classes.

Issues observed in source CSS:
- Card variants defined different corner radii (18/20/22/24px), shadows, borders.
- Title styles varied across screen headers and card headings.
- Green success/gain colors differed across portfolio and ledger components.
- CIBC detail sections had a different typography scale from the rest of Investment.
- Inputs and modal header sizes were inconsistent.

Changes:
- Added a shared CSS token layer and unified screen/card/control typography.
- Normalized corner radii, borders, shadows, positive/negative financial colors, and modal controls.
- Improved narrow-iPhone typography and reduced-motion behavior.
- Preserved existing markup, page routing, calculators, chart algorithms, data storage and Worker API.

Deployment: Replace index.html and sw.js in GitHub Pages repository.
Do NOT touch D1, market-worker.js, Cron, or Sync Token.

Verification: Inline JavaScript syntax checked with Node. Static CSS reviewed. Actual iPhone screenshots and interactive flows remain to be visually acceptance tested after deployment.
