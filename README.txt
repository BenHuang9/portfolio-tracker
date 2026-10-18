Portfolio V5.24.6 - Net Worth chart color / tooltip fix

Deployment: Replace index.html and sw.js in your GitHub Pages portfolio-tracker repository, then commit and push.

Changes:
- Net Worth series is always green (var(--teal)), regardless of the direction of the historical series. Other investment charts keep their original dynamic colors.
- During Net Worth long-press, show selected date and Net Worth only, without a second Base amount. The main Net Asset Base summary above the chart remains and follows the selected date.
- Dotted gray Net Asset Base series and its crosshair marker remain unchanged.
- Historical snapshots since Oct 12, 2026, Yahoo price history, touch interactions, and Cloudflare auto sync are unchanged.
- No cloud database or account values are modified.

Only index.html and sw.js need to be deployed.
