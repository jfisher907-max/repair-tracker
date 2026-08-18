-- Photos of the actual vehicle, attached to the job.
--
-- Until now the only images the system held were receipts — proof of what was
-- bought, never of what was wrong. A photo of the seized caliper is what makes
-- a customer who isn't standing in the shop believe the work is needed, and
-- it's the only record that a scratch was already there when the car arrived.
--
-- Files live in the existing private `receipts` bucket under a `job-photos/`
-- prefix; its storage policies are bucket-wide, so no policy change is needed.

create table if not exists public.job_photos (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.jobs(id) on delete cascade,
  storage_path     text not null,
  caption          text,
  -- Marks a photo as fit for the customer's eyes. Nothing renders on a
  -- customer-facing surface yet; this is the switch that will govern it.
  customer_visible boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists job_photos_job_idx on public.job_photos (job_id, created_at);

alter table public.job_photos enable row level security;

drop policy if exists owner_all on public.job_photos;
create policy owner_all on public.job_photos for all using (is_owner()) with check (is_owner());

drop trigger if exists job_photos_updated_at on public.job_photos;
create trigger job_photos_updated_at
  before update on public.job_photos
  for each row execute function set_updated_at();
