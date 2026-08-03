# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Project conventions

Single-user car repair tracker for Jake (jfisher907@gmail.com). Next.js App Router + TypeScript + Tailwind v4 + Supabase, deployed on Vercel — same stack and conventions as `aeroair-ops` and `Hangar-Tracker`, but a completely separate system (own repo / Supabase project `kccmalbgfekapedgvhar` / Vercel project).

- **Money is integer cents everywhere** (`*_cents` columns, `lib/money.ts` helpers). Never floats, never dollars in the DB.
- **Job money math is defined once** in the `job_totals` Postgres view (server-authoritative) and mirrored in `lib/calc.ts` for optimistic UI. Keep them in sync.
- **Soft delete** (`deleted_at`) on customers/vehicles/jobs — filter `deleted_at is null` in queries; restore lives in Settings. Part lines and receipts hard-delete.
- **Auth**: single account, no signup UI. RLS on every table pins access to the owner's email via the `is_owner()` SQL function — change the email there if the account ever changes.
- **Profit is Jake-only** — it must never appear on the customer report (`app/report`).
- Client-side data access with the shared browser client (`lib/supabase.ts`, RLS enforced). Server routes (`app/api/*`) verify the caller's bearer token before doing anything.
- `ANTHROPIC_API_KEY` is a server-only env var. Never `NEXT_PUBLIC_`, never returned by an endpoint, never in client code.
- Phone-first UI: 44px touch targets, `inputMode` on numeric fields, date defaults to today.
- **Billing**: quotes (`quotes`/`quote_lines`, mirror math in `lib/billing.ts` vs the `quote_totals` view) and invoices. **Invoices are immutable snapshots** — `invoices.lines` jsonb + frozen totals are written once by `buildInvoiceSnapshot`; never recompute a saved invoice from its job. Fix a wrong invoice by voiding and reissuing.
- **Public token surface**: `/q/[token]` and `/i/[token]` are unauthenticated, backed by SECURITY DEFINER RPCs (`get_public_quote`, `respond_public_quote`, `get_public_invoice`) that must only ever return customer-safe fields — no notes, no costs, no profit. Any new field returned there is customer-visible; treat changes as security-sensitive.
