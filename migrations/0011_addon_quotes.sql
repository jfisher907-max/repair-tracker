-- Add-on quotes: authorization for extra work found mid-job.
--
-- A quote created WITH job_id already set is an add-on to that existing job
-- (the industry's "change order" / DVI upsell): same customer-facing /q link,
-- same per-line approval and consent record, but instead of creating a new
-- job, applying it adds the approved lines and labor hours to the job it
-- belongs to. quotes.job_id previously only ever meant "the job this quote
-- created at conversion".
--
-- applied_at marks when a quote's lines actually landed on a job — for
-- regular quotes that is conversion time, for add-ons apply time. It is the
-- guard that stops a quote being applied twice.

alter table public.quotes add column if not exists applied_at timestamptz;

-- Every already-converted quote has, by definition, been applied.
update public.quotes set applied_at = coalesce(decided_at, updated_at)
where job_id is not null and applied_at is null;
