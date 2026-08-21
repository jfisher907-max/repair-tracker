# UX backlog — from the 2026-08-20 mobile-first audit

Three review lenses (ergonomics in the bay, taps-to-done, consistency/polish) over every
screen. **Batches 1–3 shipped 2026-08-20** (commits 66ba90d, 06d676d, b544450); what's left
is at the bottom.

## Batch 1 — defects wearing UX clothing — SHIPPED

- ~~Send link marked a draft "sent" even when the share sheet was cancelled~~ — status now
  flips only after the share/copy succeeds (quote + invoice).
- ~~"+ Add this part" had no busy state~~ — double-tap could insert twice; guarded, with
  inline validation replacing alert().
- ~~A quote for a brand-new customer could never carry a vehicle~~ — VehicleFields now show
  on the new-customer path, so conversion isn't blocked later.
- ~~Expenses 📎 intermittently dead on iPhone~~ — window opened synchronously, then filled.
- ~~Photo capture forced the camera~~ — `capture` dropped, so the camera roll is offered.
- ~~Create-invoice guard's Cancel navigated anyway~~ — button now reads "🧾 Open INV-xxx".
- ~~Deleted quotes unrecoverable~~ — quotes joined the Settings trash.
- ~~Mark paid hardcoded 'cash'~~ — inline sheet with method chips before recording.

## Batch 2 — greasy-thumb ergonomics — SHIPPED

- ~~44px pass~~ — `@media (pointer: coarse) { .btn-sm { min-height: 44px } }`, every
  30/32/34px override removed, receipt-delete and header-gear given real hit areas, scan-row
  delete column widened, /q untick rows raised.
- ~~Scan review Part # was 12px~~ (iOS zoom on the core phone flow) — now 16px.
- ~~"+ Add part" opened its panel off-screen~~ — scrolls into view and focuses.
- ~~Job action row was nine identical chips~~ — Scan receipt / Add part / Create-or-open
  invoice / Mark paid stay visible; Print, template, Quote extra work fold behind "⋯ More".

## Batch 3 — feedback and consistency — SHIPPED

- ~~Chip language drift + contrast~~ — `.chip-{status}` classes are the single source; muted
  chips moved to `--text2` (3.73:1 → 6.67:1 measured).
- ~~Billing always opened on Quotes~~ — `?tab=invoices`, used by the dashboard banner and
  invoice back-links.
- ~~Customer-row phone numbers weren't tappable~~ — `tel:` links at 44px.
- ~~Invoice footnote contradicted the Update-from-job button on drafts~~ — status-aware now.
- ~~JobRow printed raw ISO dates~~ — `formatDateShort`.
- ~~Photos card printed with "tap a photo to see it full size"~~ — `no-print`.
- ~~Dead `row-interactive` class~~ — removed.
- Also shipped alongside: **dashboard cash basis** (Billed / Collected / Parts spend / Cash
  profit / Unpaid, with pre-ledger jobs counted via `collectedForJob`).

## Still open

- **alert()/confirm()/prompt() sweep** — the job page's hot paths are inline now, but
  RecommendationList, expenses, customers, followups and several error paths still pop system
  dialogs. Medium effort, high everyday value.
- **Undo instead of confirm** for payments and part lines (6-second toast that re-inserts the
  captured row); keep confirm for storage-backed deletes where the file is really gone.
- **Shared error card** — "Couldn't load — check the connection [Retry]" instead of raw
  `TypeError: Failed to fetch` on dashboard/jobs/job detail; followups still alert()s.
- **Filter state in the URL** for jobs and customers (search/status/date wipe on back-nav,
  and nothing can deep-link to "unpaid jobs"); then make the dashboard stat tiles link to
  filtered lists.
- **Detail-page skeletons** — job/quote/invoice/customer/vehicle still flash bare "Loading…"
  while list pages shimmer.
- **/q and /i lack the /s doc-wrap treatment**, and their loading/invalid states render dark
  app chrome on the customer's light document page.
- **Icon language pass** — +/➕ and ✕/🗑/Delete still mix in a few places.
