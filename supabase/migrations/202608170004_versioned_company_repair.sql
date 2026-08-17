-- Normal company loading must be read-only. Repairs are versioned so a schema
-- repair runs once only when an administrator deliberately bumps the version.
alter table public.companies
  add column if not exists bootstrap_version integer not null default 1
  check (bootstrap_version between 0 and 1000000);

notify pgrst, 'reload schema';
