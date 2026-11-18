-- Hourly background work: pg_cron calls the edge function's /cron endpoint
-- through pg_net. The schedule is installed from the owner dashboard (which
-- knows the function URL and the cron secret), so no secret lives in git.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.interniq_install_cron(p_url text, p_secret text) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  jid bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_url !~ '^https://' or length(p_secret) < 16 then
    raise exception 'invalid cron target' using errcode = '22023';
  end if;
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'interniq-hourly';
  select cron.schedule(
    'interniq-hourly',
    '7 * * * *',
    format(
      $q$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L), body := '{}'::jsonb, timeout_milliseconds := 10000)$q$,
      p_url,
      p_secret
    )
  ) into jid;
  return 'scheduled';
end;
$$;

create or replace function public.interniq_cron_status() returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'installed', exists (select 1 from cron.job where jobname = 'interniq-hourly'),
    'lastRun', (
      select max(d.end_time) from cron.job_run_details d
      join cron.job j on j.jobid = d.jobid
      where j.jobname = 'interniq-hourly'
    ),
    'lastStatus', (
      select d.status from cron.job_run_details d
      join cron.job j on j.jobid = d.jobid
      where j.jobname = 'interniq-hourly'
      order by d.end_time desc nulls last
      limit 1
    )
  );
end;
$$;

revoke all on function public.interniq_install_cron(text, text) from public, anon, authenticated;
revoke all on function public.interniq_cron_status() from public, anon, authenticated;
grant execute on function public.interniq_install_cron(text, text) to service_role;
grant execute on function public.interniq_cron_status() to service_role;
