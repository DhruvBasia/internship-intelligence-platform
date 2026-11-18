-- InternIQ v3: multi-user schema.
--
-- Every user-owned row carries user_id and is protected by row-level security, so a
-- signed-in student can only ever read or change their own rows, even if they call the
-- REST API directly with their token. Secrets (AI keys, Gmail refresh tokens) live in
-- tables no client role can read at all; the edge function reaches them with the service
-- role and they are encrypted with a key that only the function knows.

-- ---------------------------------------------------------------------------
-- Profiles: one row per signed-in user, created on first API call.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  name text not null default '',
  school text not null default '',
  degree text not null default '',
  grad_year int,
  skills text[] not null default '{}',
  target_roles text[] not null default '{}',
  locations text[] not null default '{}',
  work_modes text[] not null default '{}',
  needs_sponsorship boolean not null default false,
  resume_text text not null default '',
  links jsonb not null default '{}',
  settings jsonb not null default '{}',
  blocked boolean not null default false,
  ics_token text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Small per-user state (usage counters, last refresh report, model cache, ...).
create table public.user_kv (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Encrypted AI keys. No client access at all.
create table public.user_secrets (
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  ciphertext text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, name)
);

-- Gmail connection (read-only scope). Encrypted refresh token; no client access.
create table public.gmail_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  refresh_token_enc text not null,
  scope text not null default '',
  status text not null default 'active',
  last_error text not null default '',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Lease locks: one writer per user at a time (UI calls and the hourly worker).
create table public.user_locks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  holder text not null,
  expires_at timestamptz not null
);

create table public.rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (user_id, bucket)
);

-- Shared cache of public job sources (SimplifyJobs, company boards, feeds): fetched
-- once and reused by every user for a few hours. Written only by the service role.
create table public.source_cache (
  key text primary key,
  fetched_at timestamptz not null default now(),
  status int not null default 200,
  error text not null default '',
  body jsonb not null default '[]'
);

-- ---------------------------------------------------------------------------
-- Tracker data

create table public.jobs (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  company text not null default '',
  role text not null default '',
  location text not null default '',
  work_mode text not null default 'unknown',
  stage text not null default 'discovered',
  score int not null default 0,
  starred boolean not null default false,
  url text not null default '',
  source text not null default '',
  source_label text not null default '',
  source_ref text not null default '',
  tags jsonb not null default '[]',
  posted_at timestamptz,
  deadline text not null default '',
  deadline_text text not null default '',
  stage_changed_at timestamptz,
  applied_at timestamptz,
  follow_up_at text not null default '',
  notes text not null default '',
  snippet text not null default '',
  match_result jsonb,
  ai_status text not null default 'none',
  ai_error text not null default '',
  ai_attempts int not null default 0,
  canonical_url text not null default '',
  role_key text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index jobs_user_created on public.jobs (user_id, created_at);
create index jobs_user_stage on public.jobs (user_id, stage);

create table public.job_texts (
  user_id uuid not null,
  id text not null,
  description text not null default '',
  requirements text not null default '',
  local_match jsonb,
  enriched_at timestamptz,
  primary key (user_id, id),
  foreign key (user_id, id) references public.jobs (user_id, id) on delete cascade
);

create table public.cover_letters (
  user_id uuid not null,
  id text not null,
  cover_letter text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, id) references public.jobs (user_id, id) on delete cascade
);

create table public.activity (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  at timestamptz not null default now(),
  job_id text not null default '',
  type text not null default '',
  message text not null default '',
  primary key (user_id, id)
);
create index activity_user_at on public.activity (user_id, at);

create table public.programs (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  key text not null default '',
  region text not null default '',
  name text not null default '',
  org text not null default '',
  url text not null default '',
  deadline text not null default '',
  deadline_text text not null default '',
  confirmed boolean not null default true,
  funding text not null default 'none',
  money text not null default '',
  requirements text not null default '',
  fit text not null default '',
  note text not null default '',
  stage text not null default 'shortlisted',
  starred boolean not null default false,
  docs jsonb not null default '{}',
  my_notes text not null default '',
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create unique index programs_user_key on public.programs (user_id, key) where key <> '';

create table public.exams (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  key text not null default '',
  name text not null default '',
  body text not null default '',
  category text not null default '',
  field text not null default 'general',
  eligibility text not null default '',
  for_you text not null default 'check',
  for_you_note text not null default '',
  age text not null default '',
  url text not null default '',
  confidence text not null default 'expected',
  events jsonb not null default '[]',
  notes text not null default '',
  stage text not null default 'watching',
  starred boolean not null default false,
  my_notes text not null default '',
  application_no text not null default '',
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create unique index exams_user_key on public.exams (user_id, key) where key <> '';

create table public.tasks (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  title text not null default '',
  due text not null default '',
  all_day boolean not null default true,
  area text not null default 'general',
  status text not null default 'todo',
  source text not null default 'manual',
  link text not null default '',
  notes text not null default '',
  ref_type text not null default '',
  ref_id text not null default '',
  mail_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.mail_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  thread_id text not null default '',
  sender text not null default '',
  from_name text not null default '',
  subject text not null default '',
  snippet text not null default '',
  received_at timestamptz,
  category text not null default 'other',
  area text not null default 'general',
  company text not null default '',
  role text not null default '',
  due text not null default '',
  all_day boolean not null default true,
  suggested_stage text not null default '',
  job_id text not null default '',
  task_id text not null default '',
  status text not null default 'new',
  url text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index mail_items_user_received on public.mail_items (user_id, received_at);

-- ---------------------------------------------------------------------------
-- Row-level security

alter table public.profiles enable row level security;
alter table public.user_kv enable row level security;
alter table public.user_secrets enable row level security;
alter table public.gmail_connections enable row level security;
alter table public.user_locks enable row level security;
alter table public.rate_limits enable row level security;
alter table public.source_cache enable row level security;
alter table public.jobs enable row level security;
alter table public.job_texts enable row level security;
alter table public.cover_letters enable row level security;
alter table public.activity enable row level security;
alter table public.programs enable row level security;
alter table public.exams enable row level security;
alter table public.tasks enable row level security;
alter table public.mail_items enable row level security;

create policy own_profile_read on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy own_profile_write on public.profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['user_kv', 'jobs', 'job_texts', 'cover_letters', 'activity', 'programs', 'exams', 'tasks', 'mail_items'] loop
    execute format(
      'create policy own_rows on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end $$;
-- user_secrets, gmail_connections, user_locks, rate_limits, source_cache: no policies,
-- so anon and authenticated see nothing. The service role bypasses RLS.

-- Least privilege: the browser never needs anonymous table access, and signed-in users
-- may only change the profile fields that are theirs to change (not email or blocked).
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on public.user_kv, public.jobs, public.job_texts, public.cover_letters,
  public.activity, public.programs, public.exams, public.tasks, public.mail_items to authenticated;
grant select on public.profiles to authenticated;
grant update (name, school, degree, grad_year, skills, target_roles, locations, work_modes, needs_sponsorship,
  resume_text, links, settings, updated_at) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Functions (called by the edge function through PostgREST)

-- The calling user: their own id, or any id when the caller is the service role.
create function public.interniq_subject(p_user uuid) returns uuid
language plpgsql stable
set search_path = ''
as $$
begin
  if p_user is not null then
    if coalesce(auth.role(), '') <> 'service_role' and p_user is distinct from auth.uid() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    return p_user;
  end if;
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- Everything a request needs up front, in one round trip: the profile (created on first
-- sign-in), small state, encrypted secrets and the Gmail connection status.
create function public.interniq_context(p_user uuid default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.interniq_subject(p_user);
  prof public.profiles;
  kv jsonb;
  secrets jsonb;
  gmail jsonb;
begin
  insert into public.profiles (user_id, email)
  select u.id, coalesce(u.email, '') from auth.users u where u.id = uid
  on conflict (user_id) do nothing;

  if p_user is null then
    update public.profiles set last_seen_at = now()
    where user_id = uid and last_seen_at < now() - interval '5 minutes';
  end if;

  select * into prof from public.profiles where user_id = uid;
  if not found then
    raise exception 'unknown user' using errcode = '42501';
  end if;
  select coalesce(jsonb_object_agg(k.key, k.value), '{}'::jsonb) into kv from public.user_kv k where k.user_id = uid;
  select coalesce(jsonb_object_agg(s.name, s.ciphertext), '{}'::jsonb) into secrets from public.user_secrets s where s.user_id = uid;
  select jsonb_build_object('email', g.email, 'status', g.status, 'lastError', g.last_error, 'connectedAt', g.connected_at)
    into gmail from public.gmail_connections g where g.user_id = uid;

  return jsonb_build_object('profile', to_jsonb(prof), 'kv', kv, 'secrets', secrets, 'gmail', gmail);
end;
$$;

-- Lease lock: true when acquired (or already held by the same holder).
create function public.interniq_lock(p_user uuid, p_holder text, p_ttl_seconds int) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.interniq_subject(p_user);
begin
  insert into public.user_locks as l (user_id, holder, expires_at)
  values (uid, p_holder, now() + make_interval(secs => greatest(1, least(p_ttl_seconds, 600))))
  on conflict (user_id) do update set holder = excluded.holder, expires_at = excluded.expires_at
    where l.expires_at < now() or l.holder = excluded.holder;
  return found;
end;
$$;

create function public.interniq_unlock(p_user uuid, p_holder text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.interniq_subject(p_user);
begin
  delete from public.user_locks where user_id = uid and holder = p_holder;
end;
$$;

-- Fixed-window rate limit: true while the caller is under p_limit hits per window.
create function public.interniq_rate(p_user uuid, p_bucket text, p_limit int, p_window_seconds int) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.interniq_subject(p_user);
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  c int;
begin
  insert into public.rate_limits as r (user_id, bucket, window_start, count)
  values (uid, p_bucket, w, 1)
  on conflict (user_id, bucket) do update set
    count = case when r.window_start = excluded.window_start then r.count + 1 else 1 end,
    window_start = excluded.window_start
  returning r.count into c;
  return c <= p_limit;
end;
$$;

-- Keep storage bounded on the free tier: drop untouched discovered postings that are old,
-- and keep at most p_keep discovered postings per user (newest win).
create function public.interniq_prune(p_user uuid, p_days int, p_keep int) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := public.interniq_subject(p_user);
  n int := 0;
  m int := 0;
begin
  delete from public.jobs
  where user_id = uid and stage = 'discovered' and not starred and ai_status <> 'queued'
    and created_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  delete from public.jobs j
  where j.user_id = uid and (j.user_id, j.id) in (
    select x.user_id, x.id from public.jobs x
    where x.user_id = uid and x.stage = 'discovered' and not x.starred
    order by x.created_at desc
    offset p_keep
  );
  get diagnostics m = row_count;
  return n + m;
end;
$$;

-- Owner dashboard numbers. Service role only.
create function public.interniq_admin_overview() returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'active7d', (select count(*) from public.profiles where last_seen_at > now() - interval '7 days'),
    'active1d', (select count(*) from public.profiles where last_seen_at > now() - interval '1 day'),
    'gmailConnected', (select count(*) from public.gmail_connections where status = 'active'),
    'jobs', (select count(*) from public.jobs),
    'applied', (select count(*) from public.jobs where stage in ('applied', 'interviewing', 'offer')),
    'signups', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n) order by d.day), '[]'::jsonb)
      from (
        select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*) as n
        from public.profiles
        where created_at > now() - interval '30 days'
        group by 1
      ) d
    ),
    'recent', (
      select coalesce(jsonb_agg(r order by r."lastSeenAt" desc), '[]'::jsonb)
      from (
        select p.user_id as "userId", p.email, p.name, p.school, p.blocked,
               p.created_at as "createdAt", p.last_seen_at as "lastSeenAt",
               (select count(*) from public.jobs j where j.user_id = p.user_id) as jobs,
               (select count(*) from public.jobs j where j.user_id = p.user_id and j.stage in ('applied', 'interviewing', 'offer')) as applied,
               exists (select 1 from public.gmail_connections g where g.user_id = p.user_id and g.status = 'active') as gmail
        from public.profiles p
        order by p.last_seen_at desc
        limit 300
      ) r
    )
  );
end;
$$;

-- Users the hourly worker should visit. Service role only.
create function public.interniq_due_users() returns table (user_id uuid, settings jsonb, gmail boolean)
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select p.user_id, p.settings,
           exists (select 1 from public.gmail_connections g where g.user_id = p.user_id and g.status = 'active')
    from public.profiles p
    where not p.blocked
      and p.last_seen_at > now() - interval '45 days'
      and (
        coalesce((p.settings -> 'automation' ->> 'enabled')::boolean, false)
        or exists (select 1 from public.gmail_connections g where g.user_id = p.user_id and g.status = 'active')
      );
end;
$$;

revoke all on function public.interniq_subject(uuid) from public, anon;
revoke all on function public.interniq_context(uuid) from public, anon;
revoke all on function public.interniq_lock(uuid, text, int) from public, anon;
revoke all on function public.interniq_unlock(uuid, text) from public, anon;
revoke all on function public.interniq_rate(uuid, text, int, int) from public, anon;
revoke all on function public.interniq_prune(uuid, int, int) from public, anon;
revoke all on function public.interniq_admin_overview() from public, anon, authenticated;
revoke all on function public.interniq_due_users() from public, anon, authenticated;
grant execute on function public.interniq_subject(uuid) to authenticated, service_role;
grant execute on function public.interniq_context(uuid) to authenticated, service_role;
grant execute on function public.interniq_lock(uuid, text, int) to authenticated, service_role;
grant execute on function public.interniq_unlock(uuid, text) to authenticated, service_role;
grant execute on function public.interniq_rate(uuid, text, int, int) to authenticated, service_role;
grant execute on function public.interniq_prune(uuid, int, int) to authenticated, service_role;
grant execute on function public.interniq_admin_overview() to service_role;
grant execute on function public.interniq_due_users() to service_role;
