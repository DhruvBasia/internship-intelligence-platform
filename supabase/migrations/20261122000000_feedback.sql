-- Feedback from testers: written by the server for the signed-in student, read
-- only by the owner dashboard. Students never read this table directly.

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null default '',
  created_at timestamptz not null default now(),
  kind text not null default 'other' check (kind in ('bug', 'idea', 'other')),
  message text not null check (char_length(message) between 1 and 4000),
  page text not null default '',
  device text not null default '',
  version text not null default '',
  status text not null default 'new' check (status in ('new', 'done'))
);
create index feedback_created on public.feedback (created_at desc);

alter table public.feedback enable row level security;
-- No policies: anon and authenticated see nothing; the service role bypasses RLS.
revoke all on public.feedback from anon, authenticated;
grant select, insert, update, delete on public.feedback to service_role;
