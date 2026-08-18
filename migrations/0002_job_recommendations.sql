-- Recommendations: what the shop flagged for next time, attached to the JOB
-- (an observation about the vehicle) rather than to one invoice. Invoices
-- snapshot it into their own memo at creation, so a document the customer has
-- already received never changes underneath them.

alter table public.jobs
  add column if not exists recommendations text;

comment on column public.jobs.recommendations is
  'Customer-facing notes for future work (pads getting low, flush due). Seeds invoice.memo; shown in the vehicle service history.';
