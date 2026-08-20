-- SD Achievement server authority hardening v1
-- 1) Client writes to progress are denied.
-- 2) Legacy sync RPC remains callable but becomes canonical readback only.
-- 3) Wallet + gold achievements are derived from server-owned tables.
-- 4) Achievements without a server validator are inactive for NEW acquisition only.
-- Existing sd_achievement_progress / sd_user_achievements rows are preserved.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Progress is server-owned. Authenticated users can read their own rows but cannot mutate them.
revoke insert, update, delete, truncate on table public.sd_achievement_progress from anon, authenticated;
grant select on table public.sd_achievement_progress to authenticated;

drop policy if exists sd_achievement_progress_insert_own on public.sd_achievement_progress;
drop policy if exists sd_achievement_progress_update_own on public.sd_achievement_progress;
drop policy if exists sd_achievement_progress_delete_own on public.sd_achievement_progress;

-- Compatibility surface for old SD Link / web clients.
-- Submitted progress is intentionally ignored. The function returns canonical server state only.
create or replace function public.sync_sd_achievement_progress(
  p_items jsonb,
  p_source_app text default 'unknown'
)
returns table(
  achievement_id text,
  current_value numeric,
  unlocked boolean,
  unlocked_at timestamptz,
  source_app text,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode='P1001', message='AUTH_REQUIRED';
  end if;

  -- p_items / p_source_app are accepted only for backward compatibility.
  -- Never copy client current_value, unlocked, metadata, or achievement_id into server state.
  return query
    select p.achievement_id,
           p.current_value,
           p.unlocked,
           p.unlocked_at,
           p.source_app,
           p.updated_at
      from public.sd_achievement_progress p
     where p.user_id = v_user_id
     order by p.achievement_id;
end;
$$;
revoke execute on function public.sync_sd_achievement_progress(jsonb,text) from public, anon;
grant execute on function public.sync_sd_achievement_progress(jsonb,text) to authenticated;
comment on function public.sync_sd_achievement_progress(jsonb,text) is
  'Backward-compatible readback only. Client-submitted achievement progress/unlock values are never trusted or persisted.';

create or replace function private.upsert_sd_authoritative_achievement(
  p_user_id uuid,
  p_achievement_id text,
  p_server_value numeric,
  p_target numeric,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value numeric := greatest(0, coalesce(p_server_value,0));
  v_target numeric := greatest(0, coalesce(p_target,0));
begin
  if p_user_id is null then return; end if;

  insert into public.sd_achievement_progress as p
    (user_id,achievement_id,current_value,unlocked,unlocked_at,source_app,metadata,updated_at)
  values(
    p_user_id,
    p_achievement_id,
    v_value,
    v_value >= v_target,
    case when v_value >= v_target then now() else null end,
    'server-authority',
    coalesce(p_metadata,'{}'::jsonb),
    now()
  )
  on conflict on constraint sd_achievement_progress_pkey do update
    set current_value = greatest(p.current_value, excluded.current_value),
        unlocked = p.unlocked or excluded.unlocked,
        unlocked_at = case
          when p.unlocked_at is not null then p.unlocked_at
          when p.unlocked or excluded.unlocked then now()
          else null
        end,
        source_app = case when excluded.current_value >= p.current_value then excluded.source_app else p.source_app end,
        metadata = coalesce(p.metadata,'{}'::jsonb) || excluded.metadata,
        updated_at = now();
end;
$$;
revoke all on function private.upsert_sd_authoritative_achievement(uuid,text,numeric,numeric,jsonb)
  from public, anon, authenticated;

create or replace function private.refresh_sd_wallet_achievements(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance numeric := 0;
begin
  if p_user_id is null then return; end if;

  select greatest(0,coalesce(w.balance,0))
    into v_balance
  from public.wallets w
  where w.user_id=p_user_id;

  if not found then return; end if;

  perform private.upsert_sd_authoritative_achievement(p_user_id,'wallet-01',case when v_balance=0 then 1 else 0 end,1,jsonb_build_object('metric','balance_zero','balance',v_balance));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'wallet-02',v_balance,10000000,jsonb_build_object('metric','balance','balance',v_balance));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'wallet-03',v_balance,100000000,jsonb_build_object('metric','balance','balance',v_balance));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'wallet-04',v_balance,1000000000,jsonb_build_object('metric','balance','balance',v_balance));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'wallet-05',v_balance,10000000000,jsonb_build_object('metric','balance','balance',v_balance));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'wallet-06',v_balance,100000000000,jsonb_build_object('metric','balance','balance',v_balance));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'wallet-07',v_balance,1000000000000,jsonb_build_object('metric','balance','balance',v_balance));
end;
$$;
revoke all on function private.refresh_sd_wallet_achievements(uuid) from public, anon, authenticated;

create or replace function private.refresh_sd_gold_achievements(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bars numeric := 0;
begin
  if p_user_id is null then return; end if;

  select greatest(0,coalesce(v.gold_bars,0))
    into v_bars
  from public.vaults v
  where v.user_id=p_user_id;

  if not found then return; end if;

  perform private.upsert_sd_authoritative_achievement(p_user_id,'gold-01',v_bars,10,jsonb_build_object('metric','gold_bars','gold_bars',v_bars));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'gold-02',v_bars,100,jsonb_build_object('metric','gold_bars','gold_bars',v_bars));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'gold-03',v_bars,1000,jsonb_build_object('metric','gold_bars','gold_bars',v_bars));
end;
$$;
revoke all on function private.refresh_sd_gold_achievements(uuid) from public, anon, authenticated;

create or replace function public.sd_authoritative_wallet_achievement_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_sd_wallet_achievements(new.user_id);
  return new;
end;
$$;
revoke all on function public.sd_authoritative_wallet_achievement_trigger() from public, anon, authenticated;

drop trigger if exists trg_sd_authoritative_wallet_achievements on public.wallets;
create trigger trg_sd_authoritative_wallet_achievements
after insert or update of balance on public.wallets
for each row execute function public.sd_authoritative_wallet_achievement_trigger();

create or replace function public.sd_authoritative_gold_achievement_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_sd_gold_achievements(new.user_id);
  return new;
end;
$$;
revoke all on function public.sd_authoritative_gold_achievement_trigger() from public, anon, authenticated;

drop trigger if exists trg_sd_authoritative_gold_achievements on public.vaults;
create trigger trg_sd_authoritative_gold_achievements
after insert or update of gold_bars on public.vaults
for each row execute function public.sd_authoritative_gold_achievement_trigger();

-- These 49 achievements currently lack a server-final validator.
-- Keep rows/titles already earned, but stop NEW acquisition until a validator exists.
update public.sd_achievements
   set active=false
 where code = any(array[
  'bitcoin-01','bitcoin-02','bitcoin-03','bitcoin-04','bitcoin-05',
  'flea-01','flea-02','flea-03','flea-04','flea-08','flea-09','flea-10','flea-11','flea-14','flea-15','flea-16','flea-17','flea-18',
  'logistics-01','logistics-02','logistics-03','logistics-04','logistics-05','logistics-06','logistics-07','logistics-08','logistics-09','logistics-10','logistics-11','logistics-12','logistics-13','logistics-14','logistics-15','logistics-16',
  'miner-01','miner-02','miner-03','miner-04','miner-05','miner-06','miner-07','miner-08','miner-09',
  'mukjjippa-01','mukjjippa-02','ranking-01','sta-01','sta-02','sta-03'
 ]::text[]);

-- Explicitly keep the server-validated set active.
update public.sd_achievements
   set active=true
 where code = any(array[
  'flea-05','flea-06','flea-07','flea-12','flea-13','flea-19',
  'slot-01','slot-02','slot-03','slot-04','slot-05','slot-06','slot-07',
  'oddeven-01','oddeven-02','oddeven-03','oddeven-04','oddeven-05','oddeven-06','oddeven-07','oddeven-08','oddeven-09','oddeven-10',
  'npcvault-01','npcvault-02','npcvault-03','npcvault-04','npcvault-05','npcvault-06','npcvault-07','npcvault-08',
  'sdcoin-01','sdcoin-02','sdcoin-03','sdcoin-coin-01','sdcoin-coin-02','sdcoin-coin-03','sdcoin-coin-04','sdcoin-coin-05','sdcoin-coin-06',
  'wallet-01','wallet-02','wallet-03','wallet-04','wallet-05','wallet-06','wallet-07',
  'gold-01','gold-02','gold-03'
 ]::text[]);

-- Backfill current authoritative states. Existing maxima/unlocks are never reduced.
do $$
declare v record;
begin
  for v in select user_id from public.wallets loop
    perform private.refresh_sd_wallet_achievements(v.user_id);
  end loop;
  for v in select user_id from public.vaults loop
    perform private.refresh_sd_gold_achievements(v.user_id);
  end loop;
end;
$$;

commit;
