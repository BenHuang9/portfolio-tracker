Portfolio V5.24.8 - Wealthsimple-style Returns

Deploy only index.html and sw.js to the existing GitHub Pages repository. Commit and Push. Do not delete your iPhone PWA or clear Safari site data.

What changed
- Returns entry for Wealthsimple TFSA, Questrade TFSA, Questrade Cash.
- Returns landing page now matches the Wealthsimple walkthrough structure: large hero total, inline account performance metrics, 1D/1W/1M/3M/6M/YTD/1Y/ALL tabs, tappable Realized Return and Dividends cards with holdings composition.
- Dividends earned page: interactive monthly bar chart; tap a bar for that month's dividend breakdown by holding, tap again to return to whole period.
- Realized returns remains Not tracked until actual Sell trades are recorded. It intentionally does not display fake $0.00.
- For limited historical periods, account value changes are explicitly NOT represented as investment returns because dated deposits/withdrawals are not recorded.
- Time-weighted return cannot be computed; shows Not available rather than inventing a percentage.
- No changes to D1/Worker data, positions, cash or sync protocol.

Verification: JS syntax / local UI checks; production iPhone behavior must still be checked after deployment.
