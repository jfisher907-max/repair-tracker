-- Business documents: the shop's own paperwork.
--
-- Business license, liability insurance certificate, EPA 609, ASE cards,
-- resale certificate — the PDFs a customer, landlord, or inspector asks for
-- at the worst moment. Files live in the existing private receipts bucket
-- under a business-docs/ prefix (owner-only policies already cover it), so
-- no storage policy changes are needed.
--
-- expires_at is optional but is the whole point for insurance and licenses:
-- the dashboard nudges 30 days out so a lapse never sneaks up.

create table if not exists public.business_documents (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  storage_path  text not null,
  mime_type     text,
  expires_at    date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.business_documents enable row level security;

drop policy if exists owner_all on public.business_documents;
create policy owner_all on public.business_documents
  for all using (is_owner()) with check (is_owner());

drop trigger if exists business_documents_updated_at on public.business_documents;
create trigger business_documents_updated_at
  before update on public.business_documents
  for each row execute function set_updated_at();
