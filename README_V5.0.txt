Portfolio Tracker V5.0 - Expanded Official Dividend Sources

Changes:
- Purpose official dividend lookup now supports Cboe Canada Yahoo symbols ending in .NE (e.g. YTSL.NE, YGOG.NE).
- Added Hamilton official distribution history for HYLD.TO.
- Added Vanguard Canada official distribution history for VFV.TO.
- Added Evolve official distribution history for BANK.TO.
- Front-end treats all of those official providers as exact payment-date sources.
- Dividend metadata/cache keys were bumped so existing phones refresh the histories immediately.

Important:
- Dividend eligibility still uses the lot purchase date versus the ex-dividend date.
- If Wealthsimple shows a dividend but the app does not even with correct official history, verify that the lot purchase date/share history in the app matches the shares actually held on that ex-date.
