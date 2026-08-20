# UX backlog — from the 2026-08-20 mobile-first audit

Three review lenses (ergonomics in the bay, taps-to-done, consistency/polish) over every
screen. Prioritized here; strike items as they ship.

## Batch 1 — defects wearing UX clothing (fix first)

- **Send link marks a draft "sent" even when the share sheet is cancelled** (quote + invoice
  pages): status flips before `navigator.share` resolves, so one aborted tap starts overdue
  math and shows approval buttons for a document nobody received. Flip after success only.
- **"+ Add this part" has no busy state** — a second tap on slow shop wifi inserts the line
  twice, silently inflating the bill. Same for deleteLine/deleteReceipt.
- **A quote for a brand-new customer can never carry a vehicle** (no vehicle fields on the
  new-customer path) → `convertToJob` later hard-blocks, and the Edit escape hatch resets an
  approved quote to draft. Show VehicleFields for new customers like JobForm does.
- **Expenses 📎 intermittently dead on iPhone**: `window.open` after an await loses the
  user-gesture token, so the popup is silently blocked. Open synchronously, then set location.
- **Photo capture forces the camera** (`capture="environment"`), so photos already taken with
  the native camera app can't be attached. Drop the attribute — iOS then offers both.
- **Create-invoice guard's Cancel isn't a cancel** — it navigates to the existing invoice
  anyway. Cancel must be a no-op; relabel the button "Open INV-xxx" when one exists.
- **Deleted quotes are unrecoverable** — Settings trash only lists customers/vehicles/jobs,
  but quotes (with their approval records) soft-delete too. Add them to the trash query.
- **Mark paid hardcodes method 'cash'** — corrupts the by-method tax tables the reports
  exist for. Small sheet: amount preset, method chips, one Record button.

## Batch 2 — greasy-thumb ergonomics

- **44px pass**: `.btn-sm` is 36px and it's nearly every button in the app; worse, overrides
  go to 30-32px on exactly the destructive controls (payment ✕, photo delete/visibility,
  recommendation status), the receipt-thumbnail ✕ is ~22px overlapping the open-receipt link,
  and the header ⚙️ is a bare emoji. `@media (pointer: coarse) { .btn-sm { min-height: 44px } }`
  + remove the undercutting overrides + hit-area padding on the stragglers. Also bump the /q
  per-line untick rows.
- **Scan review Part # input is 12px** → iOS zooms the viewport on every focus, on the one
  screen that's entirely keyboard work next to a photo. 16px font, 44px height (same grid in
  QuoteForm).
- **"+ Add part" opens its panel off-screen** (button in header, panel far below) — scroll
  into view + focus the description input on open.
- **Job action row is nine identical chips** pushing content below the fold — keep Scan
  receipt / Add part / Mark paid visible, fold the rest behind "⋯ More".

## Batch 3 — feedback and consistency

- **alert()/confirm()/prompt() walls** for routine validation while JobForm/QuoteForm already
  have the inline red-message pattern — standardize inline; prompt() for template names
  becomes a panel; confirm() stays only for genuine destruction.
- **Chip language drift**: same status, different colors/backgrounds across pages ('paid'
  green-tinted on Jobs but flat on Billing; 'declined' red on quotes, gray on
  recommendations); draft/void chips measure 3.7:1 contrast (below AA). Consolidate into
  .chip-{status} classes; one color per word; lift muted chip text to --text2.
- **Navigation state amnesia**: Billing always opens on Quotes (dashboard's "unpaid invoices"
  banner lands on the wrong tab); jobs/customers filters wipe on back-nav. Mirror tab +
  filters into URL params; make dashboard stat tiles link to filtered lists; customer-row
  phone numbers become tel: links.
- **Loading polish**: detail pages flash bare "Loading…" while list pages have skeletons —
  add a job-detail skeleton (primitives exist).
- **Undo over confirm** for payments/part lines (6-second undo toast, re-insert the captured
  row); shared "Couldn't load — check the connection [Retry]" error card instead of raw
  `TypeError: Failed to fetch`.
- Small fry: JobRow prints raw ISO dates; +/➕/✕/🗑/Delete icon language pass; /q and /i
  missing the /s doc-wrap treatment + dark loading states on customer pages; photos card
  prints with "tap to see full size" on paper (no-print); invoice footnote contradicts the
  Update-from-job button on drafts; dead `row-interactive` class on the labor row.
