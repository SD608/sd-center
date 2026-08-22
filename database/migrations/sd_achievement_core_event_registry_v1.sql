begin;

-- Chapter 3-3: common Core achievement event/stat foundation + producer registry.
-- Dependencies: Chapter 3-1 permanent identity and Chapter 3-2 migration classification.
-- This migration is intentionally additive/shadow-only: it does not cut over any
-- existing producer and does not mutate player achievement progress/earned assets.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='sd_achievements' and column_name='lineage_root_id'
  ) then
    raise exception 'Chapter 3-3 requires Chapter 3-1 permanent achievement identity first';
  end if;

  if not exists (
    select 1 from information_schema.tables
     where table_schema='public' and table_name='sd_achievement_migration_classification'
  ) then
    raise exception 'Chapter 3-3 requires Chapter 3-2 migration classification first';
  end if;

  if (select count(*) from public.sd_achievement_migration_classification)
     <> (select count(*) from public.sd_achievements) then
    raise exception 'Chapter 3-3 preflight failed: Chapter 3-2 classification coverage is incomplete';
  end if;
end $$;

create table public.sd_achievement_producer_registry (
  producer_key text primary key,
  content_key text not null,
  extension_id text,
  authority_mode text not null,
  ingress_mode text not null default 'internal_only',
  event_namespace text not null unique,
  validator_key text,
  registry_version text not null default 'chapter-3-3-v1',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sd_achievement_producer_key_format_v1
    check (producer_key ~ '^[a-z0-9][a-z0-9._-]{2,119}$'),
  constraint sd_achievement_content_key_format_v1
    check (content_key ~ '^[a-z0-9][a-z0-9_-]{1,79}$'),
  constraint sd_achievement_extension_id_format_v1
    check (extension_id is null or extension_id ~ '^[a-z0-9][a-z0-9._-]{1,119}$'),
  constraint sd_achievement_event_namespace_format_v1
    check (event_namespace ~ '^[a-z0-9][a-z0-9._-]{1,79}$'),
  constraint sd_achievement_authority_mode_v1
    check (authority_mode in ('core_state','server_state','server_event','season_finalize')),
  constraint sd_achievement_ingress_mode_v1
    check (ingress_mode in ('internal_only','authenticated_validated')),
  constraint sd_achievement_validated_ingress_has_validator_v1
    check (ingress_mode <> 'authenticated_validated' or validator_key is not null)
);

create table public.sd_achievement_event_type_registry (
  event_type text primary key,
  producer_key text not null
    references public.sd_achievement_producer_registry(producer_key)
    on update restrict on delete restrict,
  schema_version integer not null default 1,
  client_submission_allowed boolean not null default false,
  validator_key text,
  active boolean not null default true,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sd_achievement_event_type_format_v1
    check (event_type ~ '^[a-z0-9][a-z0-9._-]{2,119}$'),
  constraint sd_achievement_event_schema_version_v1
    check (schema_version >= 1),
  constraint sd_achievement_client_event_has_validator_v1
    check (not client_submission_allowed or validator_key is not null)
);

create table public.sd_achievement_stat_registry (
  stat_key text primary key,
  producer_key text not null
    references public.sd_achievement_producer_registry(producer_key)
    on update restrict on delete restrict,
  aggregation_mode text not null,
  allow_negative boolean not null default false,
  registry_version text not null default 'chapter-3-3-v1',
  active boolean not null default true,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sd_achievement_stat_key_format_v1
    check (stat_key ~ '^[a-z0-9][a-z0-9._-]{2,159}$'),
  constraint sd_achievement_stat_aggregation_v1
    check (aggregation_mode in ('sum','max','latest','flag'))
);

create table public.sd_achievement_producer_bindings (
  achievement_id uuid primary key
    references public.sd_achievements(id) on update restrict on delete restrict,
  permanent_code text not null unique,
  producer_key text not null
    references public.sd_achievement_producer_registry(producer_key)
    on update restrict on delete restrict,
  source_content_key text not null,
  target_content_key text not null,
  binding_state text not null,
  evaluation_mode text not null default 'adapter',
  stat_key text
    references public.sd_achievement_stat_registry(stat_key)
    on update restrict on delete restrict,
  target_value numeric,
  registry_version text not null default 'chapter-3-3-v1',
  notes text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sd_achievement_binding_state_v1
    check (binding_state in ('shadow','planned_move','active','legacy')),
  constraint sd_achievement_evaluation_mode_v1
    check (evaluation_mode in ('adapter','stat_threshold','legacy')),
  constraint sd_achievement_stat_threshold_shape_v1
    check (
      evaluation_mode <> 'stat_threshold'
      or (stat_key is not null and target_value is not null and target_value >= 0)
    )
);

create table public.sd_achievement_event_ledger (
  event_id text primary key,
  user_id uuid not null
    references public.profiles(id) on update restrict on delete restrict,
  producer_key text not null
    references public.sd_achievement_producer_registry(producer_key)
    on update restrict on delete restrict,
  event_type text not null
    references public.sd_achievement_event_type_registry(event_type)
    on update restrict on delete restrict,
  source_extension_id text,
  submitted_evidence jsonb not null,
  normalized_evidence jsonb not null,
  validator_key text,
  schema_version integer not null,
  occurred_at timestamptz not null,
  accepted_at timestamptz not null default now(),
  constraint sd_achievement_event_id_format_v1
    check (event_id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,159}$'),
  constraint sd_achievement_event_source_extension_format_v1
    check (source_extension_id is null or source_extension_id ~ '^[a-z0-9][a-z0-9._-]{1,119}$'),
  constraint sd_achievement_event_evidence_object_v1
    check (jsonb_typeof(submitted_evidence)='object' and jsonb_typeof(normalized_evidence)='object'),
  constraint sd_achievement_event_evidence_size_v1
    check (
      octet_length(submitted_evidence::text) <= 16384
      and octet_length(normalized_evidence::text) <= 16384
    ),
  constraint sd_achievement_event_schema_version_copy_v1
    check (schema_version >= 1)
);

create table public.sd_achievement_core_stats (
  user_id uuid not null
    references public.profiles(id) on update restrict on delete restrict,
  stat_key text not null
    references public.sd_achievement_stat_registry(stat_key)
    on update restrict on delete restrict,
  value numeric not null,
  as_of timestamptz not null,
  source_event_id text not null
    references public.sd_achievement_event_ledger(event_id)
    on update restrict on delete restrict,
  version bigint not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, stat_key),
  constraint sd_achievement_core_stat_version_v1 check (version >= 1),
  constraint sd_achievement_core_stat_metadata_object_v1 check (jsonb_typeof(metadata)='object')
);

create table public.sd_achievement_stat_event_applications (
  event_id text not null
    references public.sd_achievement_event_ledger(event_id)
    on update restrict on delete restrict,
  stat_key text not null
    references public.sd_achievement_stat_registry(stat_key)
    on update restrict on delete restrict,
  user_id uuid not null
    references public.profiles(id) on update restrict on delete restrict,
  input_value numeric not null,
  resulting_value numeric not null,
  metadata jsonb not null default '{}'::jsonb,
  applied_at timestamptz not null default now(),
  primary key (event_id, stat_key),
  constraint sd_achievement_stat_application_metadata_object_v1 check (jsonb_typeof(metadata)='object')
);

-- All Chapter 3-3 state is server/Core-owned. No direct client table access.
alter table public.sd_achievement_producer_registry enable row level security;
alter table public.sd_achievement_event_type_registry enable row level security;
alter table public.sd_achievement_stat_registry enable row level security;
alter table public.sd_achievement_producer_bindings enable row level security;
alter table public.sd_achievement_event_ledger enable row level security;
alter table public.sd_achievement_core_stats enable row level security;
alter table public.sd_achievement_stat_event_applications enable row level security;

revoke all on table public.sd_achievement_producer_registry from public, anon, authenticated;
revoke all on table public.sd_achievement_event_type_registry from public, anon, authenticated;
revoke all on table public.sd_achievement_stat_registry from public, anon, authenticated;
revoke all on table public.sd_achievement_producer_bindings from public, anon, authenticated;
revoke all on table public.sd_achievement_event_ledger from public, anon, authenticated;
revoke all on table public.sd_achievement_core_stats from public, anon, authenticated;
revoke all on table public.sd_achievement_stat_event_applications from public, anon, authenticated;

create policy sd_achievement_producer_registry_client_deny_v1
  on public.sd_achievement_producer_registry for all to anon, authenticated
  using (false) with check (false);
create policy sd_achievement_event_type_registry_client_deny_v1
  on public.sd_achievement_event_type_registry for all to anon, authenticated
  using (false) with check (false);
create policy sd_achievement_stat_registry_client_deny_v1
  on public.sd_achievement_stat_registry for all to anon, authenticated
  using (false) with check (false);
create policy sd_achievement_producer_bindings_client_deny_v1
  on public.sd_achievement_producer_bindings for all to anon, authenticated
  using (false) with check (false);
create policy sd_achievement_event_ledger_client_deny_v1
  on public.sd_achievement_event_ledger for all to anon, authenticated
  using (false) with check (false);
create policy sd_achievement_core_stats_client_deny_v1
  on public.sd_achievement_core_stats for all to anon, authenticated
  using (false) with check (false);
create policy sd_achievement_stat_event_applications_client_deny_v1
  on public.sd_achievement_stat_event_applications for all to anon, authenticated
  using (false) with check (false);

-- Registry targets. extension_id is routing metadata, never proof of trust by itself.
insert into public.sd_achievement_producer_registry
  (producer_key,content_key,extension_id,authority_mode,ingress_mode,event_namespace,validator_key,notes)
select * from (values
  ('core.wallet','core_wallet',null,'core_state','internal_only','wallet',null,'Core-owned wallet state.'),
  ('core.gold','core_gold','vault','core_state','internal_only','gold',null,'Core/server-owned gold holding state; Vault is presentation/input surface only.'),
  ('official.logistics','logistics','sd-logistics-center-desktop','server_state','internal_only','logistics',null,'Official logistics server state.'),
  ('official.miner','miner','miner','server_event','internal_only','miner',null,'Official miner accepted server actions.'),
  ('official.mukjjippa','mukjjippa','sd-mukjippa','server_event','internal_only','mukjjippa',null,'Official Mukjjippa server rounds.'),
  ('official.slot','slot','sd-slot','server_event','internal_only','slot',null,'Official slot server rounds.'),
  ('official.oddeven','oddeven','odd-even','server_event','internal_only','oddeven',null,'Official odd/even server rounds.'),
  ('official.bitcoin','bitcoin','bitcoin','server_state','internal_only','bitcoin',null,'Official Bitcoin server state/actions.'),
  ('official.sta','sta','sta-expansion','server_event','internal_only','sta',null,'Official STA accepted server operations.'),
  ('official.flea-market','flea_market','sd-flea-market','server_state','internal_only','flea.market',null,'Official Flea Market server-owned marketplace state.'),
  ('core.npc-vault','npc_vault',null,'server_event','internal_only','npcvault',null,'Server-owned NPC vault rounds.'),
  ('core.sdcoin','sdcoin',null,'server_state','internal_only','sdcoin',null,'Server-owned SD Coin state/actions.'),
  ('core.season','season',null,'season_finalize','internal_only','season',null,'Server-finalized season ranking state.')
) as v(producer_key,content_key,extension_id,authority_mode,ingress_mode,event_namespace,validator_key,notes);

-- Canonical event namespaces are registered now, but every authenticated submission
-- remains disabled until Chapter 3-4 installs a specific evidence validator.
insert into public.sd_achievement_event_type_registry
  (event_type,producer_key,schema_version,client_submission_allowed,validator_key,active,description)
values
  ('wallet.state.changed','core.wallet',1,false,null,true,'Core wallet state changed.'),
  ('gold.state.changed','core.gold',1,false,null,true,'Core gold holding state changed.'),
  ('logistics.state.changed','official.logistics',1,false,null,true,'Validated logistics state changed.'),
  ('miner.action.accepted','official.miner',1,false,null,true,'Validated mining/sale action accepted by server.'),
  ('mukjjippa.round.settled','official.mukjjippa',1,false,null,true,'Mukjjippa server round settled.'),
  ('slot.round.settled','official.slot',1,false,null,true,'Slot server round settled.'),
  ('oddeven.round.settled','official.oddeven',1,false,null,true,'Odd/even server round settled.'),
  ('bitcoin.state.changed','official.bitcoin',1,false,null,true,'Validated Bitcoin server state changed.'),
  ('sta.operation.accepted','official.sta',1,false,null,true,'Validated STA operation accepted by server.'),
  ('flea.market.state.changed','official.flea-market',1,false,null,true,'Validated Flea marketplace state changed.'),
  ('npcvault.round.settled','core.npc-vault',1,false,null,true,'NPC vault server round settled.'),
  ('sdcoin.state.changed','core.sdcoin',1,false,null,true,'SD Coin server state changed.'),
  ('season.finalized','core.season',1,false,null,true,'Season ranking finalized by server authority.');

create or replace function private.enforce_sd_achievement_producer_binding_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_code text;
  v_class public.sd_achievement_migration_classification%rowtype;
  v_producer_content text;
begin
  if tg_op='DELETE' then
    raise exception using errcode='P3320', message='ACHIEVEMENT_PRODUCER_BINDING_DELETE_FORBIDDEN';
  end if;

  if tg_op='UPDATE' and (
    new.achievement_id is distinct from old.achievement_id
    or new.permanent_code is distinct from old.permanent_code
  ) then
    raise exception using errcode='P3321', message='ACHIEVEMENT_PRODUCER_BINDING_IDENTITY_IMMUTABLE';
  end if;

  select a.code into v_code from public.sd_achievements a where a.id=new.achievement_id;
  if not found or new.permanent_code is distinct from v_code then
    raise exception using errcode='P3322', message='ACHIEVEMENT_PRODUCER_BINDING_IDENTITY_MISMATCH';
  end if;

  select * into v_class
    from public.sd_achievement_migration_classification c
   where c.achievement_id=new.achievement_id;
  if not found then
    raise exception using errcode='P3323', message='ACHIEVEMENT_PRODUCER_BINDING_CLASSIFICATION_MISSING';
  end if;

  if new.source_content_key is distinct from v_class.current_content_key
     or new.target_content_key is distinct from v_class.target_content_key then
    raise exception using errcode='P3324', message='ACHIEVEMENT_PRODUCER_BINDING_CLASSIFICATION_MISMATCH';
  end if;

  select p.content_key into v_producer_content
    from public.sd_achievement_producer_registry p
   where p.producer_key=new.producer_key;
  if not found or v_producer_content is distinct from new.target_content_key then
    raise exception using errcode='P3325', message='ACHIEVEMENT_PRODUCER_BINDING_TARGET_MISMATCH';
  end if;

  if v_class.disposition='move_producer' and new.binding_state not in ('planned_move','active') then
    raise exception using errcode='P3326', message='ACHIEVEMENT_PRODUCER_MOVE_STATE_INVALID';
  elsif v_class.disposition='retain' and new.binding_state not in ('shadow','active') then
    raise exception using errcode='P3327', message='ACHIEVEMENT_PRODUCER_RETAIN_STATE_INVALID';
  elsif v_class.disposition='legacy' and new.binding_state <> 'legacy' then
    raise exception using errcode='P3328', message='ACHIEVEMENT_PRODUCER_LEGACY_STATE_INVALID';
  elsif v_class.disposition='successor' and new.binding_state not in ('shadow','active') then
    raise exception using errcode='P3329', message='ACHIEVEMENT_PRODUCER_SUCCESSOR_STATE_INVALID';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_sd_achievement_producer_binding_v1() from public, anon, authenticated;

create trigger sd_achievement_producer_binding_guard_v1
before insert or update or delete on public.sd_achievement_producer_bindings
for each row execute function private.enforce_sd_achievement_producer_binding_v1();

-- Bind every classified permanent identity to the Chapter 3 target producer in shadow/planned mode.
with producer_map(content_key, producer_key) as (values
  ('core_wallet','core.wallet'),
  ('core_gold','core.gold'),
  ('logistics','official.logistics'),
  ('miner','official.miner'),
  ('mukjjippa','official.mukjjippa'),
  ('slot','official.slot'),
  ('oddeven','official.oddeven'),
  ('bitcoin','official.bitcoin'),
  ('sta','official.sta'),
  ('flea_market','official.flea-market'),
  ('npc_vault','core.npc-vault'),
  ('sdcoin','core.sdcoin'),
  ('season','core.season')
)
insert into public.sd_achievement_producer_bindings(
  achievement_id,permanent_code,producer_key,source_content_key,target_content_key,
  binding_state,evaluation_mode,stat_key,target_value,registry_version,notes
)
select c.achievement_id,c.permanent_code,m.producer_key,c.current_content_key,c.target_content_key,
       case c.disposition
         when 'move_producer' then 'planned_move'
         when 'legacy' then 'legacy'
         else 'shadow'
       end,
       case when c.disposition='legacy' then 'legacy' else 'adapter' end,
       null,null,'chapter-3-3-v1',
       'Chapter 3-3 registry only; no producer cutover until Chapter 3-4.'
  from public.sd_achievement_migration_classification c
  join producer_map m on m.content_key=c.target_content_key;

do $$
begin
  if (select count(*) from public.sd_achievement_producer_bindings)
     <> (select count(*) from public.sd_achievements) then
    raise exception 'Chapter 3-3 producer binding coverage is incomplete';
  end if;

  if exists (
    select 1
      from public.sd_achievement_migration_classification c
      left join public.sd_achievement_producer_bindings b on b.achievement_id=c.achievement_id
     where b.achievement_id is null
        or b.permanent_code is distinct from c.permanent_code
        or b.source_content_key is distinct from c.current_content_key
        or b.target_content_key is distinct from c.target_content_key
  ) then
    raise exception 'Chapter 3-3 producer binding does not exactly preserve Chapter 3-2 classification';
  end if;

  if exists (select 1 from public.sd_achievement_producer_bindings where binding_state='active') then
    raise exception 'Chapter 3-3 must not activate generic producer bindings before Chapter 3-4';
  end if;

  if exists (
    select 1 from public.sd_achievement_producer_registry
     where ingress_mode <> 'internal_only'
  ) or exists (
    select 1 from public.sd_achievement_event_type_registry
     where client_submission_allowed
  ) then
    raise exception 'Chapter 3-3 must remain fail-closed to authenticated event submission';
  end if;
end $$;

create or replace function private.reject_sd_achievement_audit_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  raise exception using errcode='P3330', message='ACHIEVEMENT_EVENT_AUDIT_IS_APPEND_ONLY';
end;
$$;
revoke all on function private.reject_sd_achievement_audit_mutation_v1() from public, anon, authenticated;

create trigger sd_achievement_event_ledger_append_only_v1
before update or delete on public.sd_achievement_event_ledger
for each row execute function private.reject_sd_achievement_audit_mutation_v1();

create trigger sd_achievement_stat_application_append_only_v1
before update or delete on public.sd_achievement_stat_event_applications
for each row execute function private.reject_sd_achievement_audit_mutation_v1();

create or replace function private.apply_sd_achievement_stat_v1(
  p_user_id uuid,
  p_stat_key text,
  p_value numeric,
  p_event_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns numeric
language plpgsql
security definer
set search_path=''
as $$
declare
  v_def public.sd_achievement_stat_registry%rowtype;
  v_event public.sd_achievement_event_ledger%rowtype;
  v_existing public.sd_achievement_core_stats%rowtype;
  v_application public.sd_achievement_stat_event_applications%rowtype;
  v_result numeric;
  v_input numeric;
  v_metadata jsonb:=coalesce(p_metadata,'{}'::jsonb);
begin
  if p_user_id is null or p_stat_key is null or p_event_id is null then
    raise exception using errcode='P3309', message='ACHIEVEMENT_STAT_REQUIRED_FIELD_MISSING';
  end if;

  if p_value is null or p_value::text in ('NaN','Infinity','-Infinity') then
    raise exception using errcode='P3310', message='ACHIEVEMENT_STAT_VALUE_INVALID';
  end if;

  if jsonb_typeof(v_metadata) <> 'object' or octet_length(v_metadata::text) > 8192 then
    raise exception using errcode='P3310', message='ACHIEVEMENT_STAT_METADATA_INVALID';
  end if;

  select * into v_def
    from public.sd_achievement_stat_registry s
   where s.stat_key=p_stat_key and s.active;
  if not found then
    raise exception using errcode='P3309', message='ACHIEVEMENT_STAT_NOT_REGISTERED';
  end if;

  if not v_def.allow_negative and p_value < 0 then
    raise exception using errcode='P3310', message='ACHIEVEMENT_STAT_NEGATIVE_VALUE_FORBIDDEN';
  end if;

  select * into v_event
    from public.sd_achievement_event_ledger e
   where e.event_id=p_event_id;
  if not found then
    raise exception using errcode='P3311', message='ACHIEVEMENT_STAT_EVENT_NOT_FOUND';
  end if;

  if v_event.user_id is distinct from p_user_id
     or v_event.producer_key is distinct from v_def.producer_key then
    raise exception using errcode='P3311', message='ACHIEVEMENT_STAT_EVENT_PRODUCER_MISMATCH';
  end if;

  -- Serialize every update for one user/stat key. This protects SUM from concurrent
  -- double increments and makes exact event replay deterministic.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || '|' || p_stat_key, 3303));

  select * into v_application
    from public.sd_achievement_stat_event_applications a
   where a.event_id=p_event_id and a.stat_key=p_stat_key;
  if found then
    if v_application.user_id is distinct from p_user_id
       or v_application.input_value is distinct from p_value
       or v_application.metadata is distinct from v_metadata then
      raise exception using errcode='P3301', message='ACHIEVEMENT_STAT_EVENT_REPLAY_CONFLICT';
    end if;
    return v_application.resulting_value;
  end if;

  v_input:=case when v_def.aggregation_mode='flag' then case when p_value>0 then 1 else 0 end else p_value end;

  select * into v_existing
    from public.sd_achievement_core_stats s
   where s.user_id=p_user_id and s.stat_key=p_stat_key
   for update;

  if not found then
    v_result:=v_input;
    insert into public.sd_achievement_core_stats(
      user_id,stat_key,value,as_of,source_event_id,version,metadata,updated_at
    ) values(
      p_user_id,p_stat_key,v_result,v_event.occurred_at,p_event_id,1,v_metadata,now()
    );
  else
    if v_def.aggregation_mode='sum' then
      v_result:=v_existing.value + v_input;
      update public.sd_achievement_core_stats
         set value=v_result,
             as_of=greatest(v_existing.as_of,v_event.occurred_at),
             source_event_id=p_event_id,
             version=v_existing.version+1,
             metadata=coalesce(v_existing.metadata,'{}'::jsonb) || v_metadata,
             updated_at=now()
       where user_id=p_user_id and stat_key=p_stat_key;
    elsif v_def.aggregation_mode='max' or v_def.aggregation_mode='flag' then
      v_result:=greatest(v_existing.value,v_input);
      update public.sd_achievement_core_stats
         set value=v_result,
             as_of=case when v_input>=v_existing.value then v_event.occurred_at else v_existing.as_of end,
             source_event_id=case when v_input>=v_existing.value then p_event_id else v_existing.source_event_id end,
             version=v_existing.version+1,
             metadata=coalesce(v_existing.metadata,'{}'::jsonb) || v_metadata,
             updated_at=now()
       where user_id=p_user_id and stat_key=p_stat_key;
    elsif v_def.aggregation_mode='latest' then
      if v_event.occurred_at >= v_existing.as_of then
        v_result:=v_input;
        update public.sd_achievement_core_stats
           set value=v_result,
               as_of=v_event.occurred_at,
               source_event_id=p_event_id,
               version=v_existing.version+1,
               metadata=coalesce(v_existing.metadata,'{}'::jsonb) || v_metadata,
               updated_at=now()
         where user_id=p_user_id and stat_key=p_stat_key;
      else
        v_result:=v_existing.value;
      end if;
    else
      raise exception using errcode='P3310', message='ACHIEVEMENT_STAT_AGGREGATION_INVALID';
    end if;
  end if;

  insert into public.sd_achievement_stat_event_applications(
    event_id,stat_key,user_id,input_value,resulting_value,metadata,applied_at
  ) values(p_event_id,p_stat_key,p_user_id,p_value,v_result,v_metadata,now());

  return v_result;
end;
$$;
revoke all on function private.apply_sd_achievement_stat_v1(uuid,text,numeric,text,jsonb) from public, anon, authenticated;

create or replace function private.accept_sd_achievement_event_v1(
  p_user_id uuid,
  p_producer_key text,
  p_event_type text,
  p_event_id text,
  p_source_extension_id text,
  p_submitted_evidence jsonb,
  p_normalized_evidence jsonb,
  p_stats jsonb default '[]'::jsonb,
  p_validator_key text default 'server-internal',
  p_occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_producer public.sd_achievement_producer_registry%rowtype;
  v_event_type public.sd_achievement_event_type_registry%rowtype;
  v_existing public.sd_achievement_event_ledger%rowtype;
  v_stat jsonb;
  v_stat_key text;
  v_stat_value numeric;
  v_stat_metadata jsonb;
  v_inserted integer:=0;
begin
  if p_user_id is null then
    raise exception using errcode='P1001', message='AUTH_REQUIRED';
  end if;

  if p_event_id is null or p_event_id !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,159}$' then
    raise exception using errcode='P3302', message='ACHIEVEMENT_EVENT_ID_INVALID';
  end if;

  if jsonb_typeof(coalesce(p_submitted_evidence,'null'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_normalized_evidence,'null'::jsonb)) <> 'object'
     or octet_length(coalesce(p_submitted_evidence,'{}'::jsonb)::text) > 16384
     or octet_length(coalesce(p_normalized_evidence,'{}'::jsonb)::text) > 16384 then
    raise exception using errcode='P3306', message='ACHIEVEMENT_EVENT_EVIDENCE_INVALID';
  end if;

  if jsonb_typeof(coalesce(p_stats,'null'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_stats,'[]'::jsonb)) > 64 then
    raise exception using errcode='P3315', message='ACHIEVEMENT_EVENT_STATS_INVALID';
  end if;

  -- Accepted events remain replayable even if a producer/event type is disabled later.
  select * into v_existing
    from public.sd_achievement_event_ledger e
   where e.event_id=p_event_id;
  if found then
    if v_existing.user_id is distinct from p_user_id
       or v_existing.producer_key is distinct from p_producer_key
       or v_existing.event_type is distinct from p_event_type
       or v_existing.source_extension_id is distinct from p_source_extension_id
       or v_existing.submitted_evidence is distinct from p_submitted_evidence then
      raise exception using errcode='P3301', message='ACHIEVEMENT_EVENT_ID_CONFLICT';
    end if;
    return jsonb_build_object('accepted',true,'duplicate',true,'event_id',p_event_id);
  end if;

  select * into v_producer
    from public.sd_achievement_producer_registry p
   where p.producer_key=p_producer_key and p.active;
  if not found then
    raise exception using errcode='P3303', message='ACHIEVEMENT_PRODUCER_NOT_ACTIVE';
  end if;

  select * into v_event_type
    from public.sd_achievement_event_type_registry e
   where e.event_type=p_event_type and e.active;
  if not found or v_event_type.producer_key is distinct from p_producer_key then
    raise exception using errcode='P3304', message='ACHIEVEMENT_EVENT_TYPE_NOT_REGISTERED_FOR_PRODUCER';
  end if;

  if v_producer.extension_id is distinct from p_source_extension_id then
    raise exception using errcode='P3305', message='ACHIEVEMENT_EVENT_SOURCE_EXTENSION_MISMATCH';
  end if;

  insert into public.sd_achievement_event_ledger(
    event_id,user_id,producer_key,event_type,source_extension_id,
    submitted_evidence,normalized_evidence,validator_key,schema_version,occurred_at,accepted_at
  ) values(
    p_event_id,p_user_id,p_producer_key,p_event_type,p_source_extension_id,
    p_submitted_evidence,p_normalized_evidence,p_validator_key,v_event_type.schema_version,
    coalesce(p_occurred_at,now()),now()
  ) on conflict(event_id) do nothing;
  get diagnostics v_inserted=row_count;

  if v_inserted=0 then
    select * into v_existing from public.sd_achievement_event_ledger where event_id=p_event_id;
    if not found
       or v_existing.user_id is distinct from p_user_id
       or v_existing.producer_key is distinct from p_producer_key
       or v_existing.event_type is distinct from p_event_type
       or v_existing.source_extension_id is distinct from p_source_extension_id
       or v_existing.submitted_evidence is distinct from p_submitted_evidence then
      raise exception using errcode='P3301', message='ACHIEVEMENT_EVENT_ID_CONFLICT';
    end if;
    return jsonb_build_object('accepted',true,'duplicate',true,'event_id',p_event_id);
  end if;

  for v_stat in select value from jsonb_array_elements(p_stats)
  loop
    if jsonb_typeof(v_stat) <> 'object'
       or coalesce(v_stat->>'stat_key','') = ''
       or not (v_stat ? 'value') then
      raise exception using errcode='P3315', message='ACHIEVEMENT_EVENT_STAT_ITEM_INVALID';
    end if;

    v_stat_key:=v_stat->>'stat_key';
    begin
      v_stat_value:=(v_stat->>'value')::numeric;
    exception when others then
      raise exception using errcode='P3315', message='ACHIEVEMENT_EVENT_STAT_VALUE_INVALID';
    end;
    v_stat_metadata:=coalesce(v_stat->'metadata','{}'::jsonb);
    perform private.apply_sd_achievement_stat_v1(
      p_user_id,v_stat_key,v_stat_value,p_event_id,v_stat_metadata
    );
  end loop;

  return jsonb_build_object('accepted',true,'duplicate',false,'event_id',p_event_id);
end;
$$;
revoke all on function private.accept_sd_achievement_event_v1(uuid,text,text,text,text,jsonb,jsonb,jsonb,text,timestamptz)
  from public, anon, authenticated;

-- Chapter 3-4 will replace this dispatcher with explicit validator_key cases.
-- Never dynamically execute a function name supplied by a client/registry row.
create or replace function private.validate_sd_achievement_event_v1(
  p_validator_key text,
  p_user_id uuid,
  p_extension_id text,
  p_event_type text,
  p_event_id text,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  raise exception using errcode='P3312', message='ACHIEVEMENT_EVENT_VALIDATOR_NOT_IMPLEMENTED';
end;
$$;
revoke all on function private.validate_sd_achievement_event_v1(text,uuid,text,text,text,jsonb)
  from public, anon, authenticated;

create or replace function public.submit_sd_achievement_event_v1(
  p_extension_id text,
  p_event_type text,
  p_event_id text,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_existing public.sd_achievement_event_ledger%rowtype;
  v_event_type public.sd_achievement_event_type_registry%rowtype;
  v_producer public.sd_achievement_producer_registry%rowtype;
  v_validation jsonb;
  v_normalized jsonb;
  v_stats jsonb;
begin
  if v_user_id is null then
    raise exception using errcode='P1001', message='AUTH_REQUIRED';
  end if;

  if p_event_id is null or p_event_id !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,159}$' then
    raise exception using errcode='P3302', message='ACHIEVEMENT_EVENT_ID_INVALID';
  end if;

  if jsonb_typeof(coalesce(p_evidence,'null'::jsonb)) <> 'object'
     or octet_length(coalesce(p_evidence,'{}'::jsonb)::text) > 16384 then
    raise exception using errcode='P3306', message='ACHIEVEMENT_EVENT_EVIDENCE_INVALID';
  end if;

  -- Lost-response retry of a previously accepted exact request is duplicate-only,
  -- even if the producer is later disabled or its validator changes.
  select * into v_existing
    from public.sd_achievement_event_ledger e
   where e.event_id=p_event_id;
  if found then
    if v_existing.user_id is distinct from v_user_id
       or v_existing.event_type is distinct from p_event_type
       or v_existing.source_extension_id is distinct from p_extension_id
       or v_existing.submitted_evidence is distinct from p_evidence then
      raise exception using errcode='P3301', message='ACHIEVEMENT_EVENT_ID_CONFLICT';
    end if;
    return jsonb_build_object('accepted',true,'duplicate',true,'event_id',p_event_id);
  end if;

  select * into v_event_type
    from public.sd_achievement_event_type_registry e
   where e.event_type=p_event_type and e.active;
  if not found then
    raise exception using errcode='P3304', message='ACHIEVEMENT_EVENT_TYPE_NOT_ACTIVE';
  end if;

  select * into v_producer
    from public.sd_achievement_producer_registry p
   where p.producer_key=v_event_type.producer_key and p.active;
  if not found then
    raise exception using errcode='P3303', message='ACHIEVEMENT_PRODUCER_NOT_ACTIVE';
  end if;

  if not v_event_type.client_submission_allowed
     or v_producer.ingress_mode <> 'authenticated_validated' then
    raise exception using errcode='P3307', message='ACHIEVEMENT_EVENT_CLIENT_SUBMISSION_DISABLED';
  end if;

  if v_producer.extension_id is distinct from p_extension_id then
    raise exception using errcode='P3305', message='ACHIEVEMENT_EVENT_SOURCE_EXTENSION_MISMATCH';
  end if;

  if v_event_type.validator_key is null
     or v_producer.validator_key is null
     or v_event_type.validator_key is distinct from v_producer.validator_key then
    raise exception using errcode='P3312', message='ACHIEVEMENT_EVENT_VALIDATOR_NOT_REGISTERED';
  end if;

  v_validation:=private.validate_sd_achievement_event_v1(
    v_event_type.validator_key,v_user_id,p_extension_id,p_event_type,p_event_id,p_evidence
  );

  if jsonb_typeof(coalesce(v_validation,'null'::jsonb)) <> 'object'
     or coalesce((v_validation->>'accepted')::boolean,false) is not true then
    raise exception using errcode='P3313', message='ACHIEVEMENT_EVENT_VALIDATOR_REJECTED';
  end if;

  v_normalized:=coalesce(v_validation->'normalized_evidence','{}'::jsonb);
  v_stats:=coalesce(v_validation->'stats','[]'::jsonb);
  if jsonb_typeof(v_normalized) <> 'object' or jsonb_typeof(v_stats) <> 'array' then
    raise exception using errcode='P3314', message='ACHIEVEMENT_EVENT_VALIDATOR_OUTPUT_INVALID';
  end if;

  return private.accept_sd_achievement_event_v1(
    v_user_id,v_producer.producer_key,p_event_type,p_event_id,p_extension_id,
    p_evidence,v_normalized,v_stats,v_event_type.validator_key,now()
  );
end;
$$;

revoke all on function public.submit_sd_achievement_event_v1(text,text,text,jsonb) from public, anon;
grant execute on function public.submit_sd_achievement_event_v1(text,text,text,jsonb) to authenticated;

comment on table public.sd_achievement_producer_registry is
  'Chapter 3-3 Core producer ownership registry. extension_id is routing metadata, not a trust proof.';
comment on table public.sd_achievement_event_ledger is
  'Append-only accepted achievement event ledger. event_id is globally exactly-once; conflicting replay is rejected.';
comment on table public.sd_achievement_core_stats is
  'Server/Core-owned common achievement statistics derived only from accepted events.';
comment on function public.submit_sd_achievement_event_v1(text,text,text,jsonb) is
  'Authenticated achievement event contract. Chapter 3-3 is fail-closed; Chapter 3-4 enables only explicitly validated event types.';

commit;
