Portfolio V5.25.1 - Sell Trades + Unified Dividends

Investment > Sell Trade or Holding > Sell Trade:
- Record account, ticker, date, shares, sale price, trading fee, and USD/CAD FX when applicable.
- Validate historical available shares; prevent overselling and accidental deletion of purchases required by sales.
- Use weighted average cost per account and ticker for realized gains. Partial and full sales reduce current holdings without deleting buy lots.
- Return > Realized returns shows dated sales, profit/loss, monthly or daily bars, and a delete-trade action.
- Dividend estimates use historical shares, including sales. The purple Dividend Income page remains the only dividend detail page.
- Cloud sync and local JSON backups include Sell Trades. Signed sale rows are included in the existing Worker cloudModel for correct nightly net-worth calculations; no D1 migration is needed.

IMPORTANT: Cash Holding is manually reconciled. Recording a Sell Trade does not add sale proceeds to account cash; update Cash Balance in Settings after settlement. Do not enter the proceeds twice.

Replace index.html and sw.js (or deploy the repository). Update both phone and desktop to this version before recording sales.

V5.25.1 UI: Investment return label no longer adds "estimated"; historical data caveats remain under chart.
Return/YTD and Quotes now share one fixed row across investment accounts. No financial calculation changes.
