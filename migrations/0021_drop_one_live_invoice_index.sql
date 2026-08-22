-- Revert the one-live-invoice-per-job unique index added in 0020.
--
-- It was too strict: `where status <> 'void'` counts a PAID invoice as live,
-- so it blocked the legitimate "invoice → customer pays → do add-on work →
-- invoice again" flow, where a paid invoice and the new invoice correctly
-- coexist on one job (the new one shows the already-paid money carried over
-- under the job-scoped paid-to-date rule). Verified by repro: the insert of
-- the second invoice failed with unique_violation.
--
-- The real protection against two UNSETTLED invoices stays in the client:
-- createInvoice refuses to open a second draft/sent invoice for a job and
-- navigates to the existing one instead. A duplicate of already-paid work is
-- an owner action, reversible with void/delete — not a silent system fault.

drop index if exists public.invoices_one_live_per_job;
