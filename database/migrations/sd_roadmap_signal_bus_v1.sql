begin;

create table if not exists public.sd_roadmap_events (
  event_id text primary key,
  step_id text not null,
  signal text not null,
  occurred_at timestamptz not null default now(),
  evidence_type text null,
  evidence_ref text null,
  source text not null default 'project_ai',
  created_at timestamptz not null default now(),
  constraint sd_roadmap_events_event_id_chk
    check (event_id ~ '^roadmap-(?:[1-9]|1[0-4])-[1-8]-(?:started|complete)-v[1-9][0-9]*$'),
  constraint sd_roadmap_events_step_id_chk
    check (step_id ~ '^(?:[1-9]|1[0-4])-[1-8]$'),
  constraint sd_roadmap_events_signal_chk
    check (signal in ('started', 'complete')),
  constraint sd_roadmap_events_evidence_type_chk
    check (evidence_type is null or char_length(evidence_type) between 1 and 40),
  constraint sd_roadmap_events_evidence_ref_chk
    check (evidence_ref is null or char_length(evidence_ref) between 1 and 240),
  constraint sd_roadmap_events_source_chk
    check (char_length(source) between 1 and 40)
);

comment on table public.sd_roadmap_events is
  'Append-only project roadmap signals. Not user economy data. Clients must not write directly.';

create index if not exists sd_roadmap_events_step_time_idx
  on public.sd_roadmap_events(step_id, occurred_at, created_at);

alter table public.sd_roadmap_events enable row level security;
revoke all on table public.sd_roadmap_events from public, anon, authenticated;

create or replace function public.sd_admin_v1_list_roadmap_events()
returns table(
  event_id text,
  step_id text,
  signal text,
  occurred_at timestamptz,
  evidence_type text,
  evidence_ref text,
  source text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_admin uuid := auth.uid();
begin
  if v_admin is null or not exists (
    select 1
    from public.profiles p
    where p.id = v_admin
      and p.role = 'admin'
      and p.status = 'active'
  ) then
    raise exception using errcode = 'P1005', message = 'ADMIN_REQUIRED';
  end if;

  return query
  select
    e.event_id,
    e.step_id,
    e.signal,
    e.occurred_at,
    e.evidence_type,
    e.evidence_ref,
    e.source,
    e.created_at
  from public.sd_roadmap_events e
  order by e.created_at, e.event_id;
end;
$function$;

revoke all on function public.sd_admin_v1_list_roadmap_events() from public, anon;
grant execute on function public.sd_admin_v1_list_roadmap_events() to authenticated;

commit;
