# Build roadmap

Where Wings N Things stands against the shop-management systems (Tekmetric, Shopmonkey,
AutoLeap, AutoVitals, Mitchell 1, PartsTech), and the order to build in. Researched and
fact-checked against vendor primary sources 2026-08. Vendor prices drift — re-check before
budgeting against any of them.

Visual version: https://claude.ai/code/artifact/0149fc07-7bab-4c20-9f17-3f1ecdd6b9af

---

## Where we stand

**Ahead.** The money spine. Cost and charge on every part line, profit computed server-side,
a payments ledger driving cash and accrual P&L, quarterly sales tax and A/R aging. Tekmetric
and AutoLeap have no native ledger at all — they pipe to QuickBooks through a third party.
Nothing in the category reads a cash receipt from a local jobber; they capture cost through
purchase orders against wholesale accounts you must already hold.

**Even or better.** Mobile. The installable PWA is the whole system on a phone. Tekmetric's
own mobile page says it is deliberately not a full mobile version; their app sits at 2.8
stars, Shopmonkey's tech app at 3.4, and reviewers' stated workaround is to use the mobile
website instead.

**Behind.** Everything between the estimate and the money: no photos of the vehicle, no
partial approval, no attributable consent record, no deposit before fronting parts money, no
follow-up on recommendations already captured.

---

## Build order

The ranking in the artifact is by business value. This is the order to *build* in, which is
not the same thing. Three engineering rules drive it:

1. **Uncaptured data is gone forever.** A feature postponed can be added; a quote approved
   today without an attribution record can never have one. Capture-side gaps outrank
   display-side gaps.
2. **Model changes get more expensive every day the system is in use.** Reshaping
   `recommendations` costs nothing at two rows and a migration at two hundred.
3. **Build foundations before the things that stand on them**, and do work that touches the
   same code in one pass rather than two.

> **Status (2026-08-20):** Phases 1–5 shipped except the video half of Phase 3 and
> Phase 4's deposits (blocked on Phase 0's Stripe keys). Phase 0 remains open (owner
> errands: Stripe keys, review link). Phase 6 (customer-driven intake) committed to the
> build order, queued after deposits. Shipped beyond the plan: mid-job add-on quotes with
> atomic apply, verbal-OK method capture, quote viewed-signal, re-quote chips, photos on
> the public quote page (dark until the storage policy runs).

### Phase 0 — external dependencies, start the clock (no engineering)

Lead time, not build time. Start these before anything else so they are not the blocker later.

- **Stripe account + keys in Vercel.** Unblocks the card payment already built *and* deposits.
- **Google Business Profile review link.** One settings field once it exists.
- (Only if SMS is wanted later: A2P 10DLC registration is ~2 weeks and needs a published
  privacy policy and SMS terms page first.)

### Phase 1 — stop the leak, capture the unrecoverable

- **Parts markup rule.** `unit_charge_cents` is nullable and the code reads null as "charge at
  cost" (`lib/billing.ts`, `app/report/page.tsx`). Any line not hand-priced is sold at zero
  margin. A bracket table in Settings applied when receipt lines land. Every day without it
  writes another zero-margin job into the books.
- **Attributable approval record on quotes.** `respond_public_quote` stores a status and
  `decided_at` and nothing else — no name, no IP, no frozen copy of what was approved, and
  editing a quote resets it to draft so the approved version is not even preserved. Add typed
  name, consent checkbox, IP, user agent, and an approved-version snapshot reusing the invoice
  snapshot pattern. Also lays the groundwork for per-line approval.

### Phase 2 — the model everything hangs on

- **Structured recommendations + follow-up worklist.** Today `jobs.recommendations` is free
  text with no status, no due date, no cross-vehicle view. Give it status (open / booked /
  declined), optional target date and rough price, then one screen listing every open
  recommendation across all vehicles, oldest first, with a share button. Do the model and the
  worklist in one pass — building the worklist on free text means rewriting it.
  **Cheapest now and never cheaper.**

### Phase 3 — the one real subsystem

- **Job photos and short video.** Reuses the receipt upload / signed URL / thumbnail rails;
  the new parts are a per-job gallery, a customer-visible flag, and capture that opens the
  camera directly. Prerequisite for any inspection feature. Purely additive, so it can slot
  anywhere — but it is the largest customer-facing gap.

### Phase 4 — rides on the foundations above

- **Per-line approval on quotes** — same RPC and snapshot logic as Phase 1's approval record.
- **Deposits on approved quotes** — needs Stripe live; the session route currently only
  charges a full invoice balance.
- **Review request button** on a paid invoice.

### Phase 5 — small independent wins, slot in anytime

Core charge tracking and a "cores out" list · VIN scan via iOS Live Text · warranty
months/miles on the job · promised-back date with a this-week view · job templates from
completed jobs · mileage-projected reminders.

### Phase 6 — customer-driven intake (committed 2026-08-20; build after Stripe/deposits)

The front door: customers start the job instead of the phone. Design settled by the
2026-08-20 competitor research (precedents: MaintainX/Limble/UpKeep request portals, Jobber
Requests, Shopmonkey Work Request Forms, Autoflow QR kiosk check-in). Two entrances, one
inbox:

- **6a — the request inbox.** `job_requests` table + owner UI: dashboard badge, one-tap
  dismiss or convert (same pattern as quote conversion; convert stamps `promised_date`).
  Requests never touch the calendar or the job list directly — the human inbox IS the spam
  filter (plus honeypot + rate limit on the public write; CMMS vendors ship no captcha and
  it works). Build this first; both entrances depend on it.
- **6b — the anonymous QR entrance.** Public `/request` page, no login. PHONE NUMBER FIRST
  as the identity key (dedupe against customers → returning customers land pre-linked);
  required fields brutally minimal (name, phone, what's wrong — plate/vehicle and photos
  optional; ask plate, not VIN); the tag URL carries its source (`?src=door|dropbox|card`);
  a "my car is in your lot" checkbox self-verifies key-drop requests; instant "got it, Jake
  will text you" confirmation (duplicate-prevention, not polish); NEVER show a price —
  "not sure what's wrong" routes toward a diagnostic as the first job. Settings card renders
  the printable QR. NFC is garnish — no vendor does NFC for anonymous customers; QR must
  stand alone. WHITE SPACE we claim: the tag on the key-drop box (the incumbent is the paper
  night-drop envelope whose own vendors admit customers skip it).
- **6c — the customer portal entrance.** NO login accounts — the whole industry avoids them
  and a second RLS tier is the riskiest change this schema can take; revisit only if fleet
  clients appear. Instead `customers.public_token` (the statement link) grows into a
  no-password portal: their vehicles + balance + "report an issue" form (vehicle pre-picked,
  photo, optional time-preference chips — preference, never a slot picker). Portal requests
  arrive pre-matched to customer + vehicle. QR confirmations text new customers their
  personal link, which enrolls them for next time.

### Later, or never

- **Lite inspection on the customer link** — after photos. Smallest version only: short
  editable checklist, three statuses, a photo and a line of text per finding, on the existing
  public-link machinery.
- **Offline capture** — measure first. Log how often the offline banner actually fires. Worth
  nothing with good signal in the bay; worth a lot in driveways.
- **Two-way SMS** — real, but only once there is an automation worth sending. Links already go
  out through the iOS share sheet from a number customers recognise.

---

## Deliberately not building

| | Their price | Why not |
|---|---|---|
| Licensed labor time guide | $2,500–2,800/yr | ALLDATA $209/mo, ProDemand $204–214/mo, Identifix $229/mo — to be told times our own completed jobs already know, more accurately. Buy it as a reference subscription for repair *procedures* if wanted; keep it out of the app. |
| Marketing automation suites | $99–629/mo | The two pieces that pay at this size (review link, declined-work follow-up) are on the build list and cost nothing recurring. |
| Parts-catalog ordering, integrated | Large effort | PartsTech's free tier is genuinely good — use it standalone in a browser. Wiring it in only pays for their integrated partners and federates wholesale accounts we'd have to hold anyway. |
| Inventory / stockroom | — | Buy per job, stock nothing. Most complained-about module in the category; what solo shops actually want is parts *cost* tracking, which we have. |
| Time clock, tech board, advisor tooling | Their $439 tier | Tekmetric documents its job clock as an efficiency benchmark, "not to pay your technicians." There is one technician. |
| QuickBooks sync | — | Runs backwards: they have no native ledger and pipe out to QuickBooks. We have the ledger, both P&L bases, sales tax and A/R in-app. Only if a tax preparer demands QBO files. |
| Native iOS/Android apps | — | Their own users' workaround is to abandon the native app for the mobile website. The PWA is already the thing they want. |
