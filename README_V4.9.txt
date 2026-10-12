V4.9 Purpose Full History

Worker change:
- Purpose fund performance pages only expose a short recent distribution table.
- V4.9 also reads the fund News page and the latest 18 official monthly distribution announcement pages.
- Those announcements provide record/ex date, payable date and amount, including prior-December distributions paid in January.
- Response source remains "Purpose official" so the existing front-end treats it as exact payment-date data.
- Worker dividend cache key bumped to v49, so stale short v4.8 responses are bypassed.

For testing now, only replace market-worker.js in Cloudflare and Deploy.
Then test /dividends?symbol=YTSL.TO. You should see officialAnnouncementPages > 0 and older 2026 rows such as January/February/March/April, plus Dec 2025 paid Jan 2026 when present.
