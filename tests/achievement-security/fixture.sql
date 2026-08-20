\set ON_ERROR_STOP on

create schema auth;
create schema private;
create role anon nologin;
create role authenticated nologin;
grant usage on schema public to anon,authenticated;
grant usage on schema auth to authenticated;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant execute on function auth.uid() to authenticated;

create table auth.users(id uuid primary key);
create table public.wallets(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id),
  balance bigint not null default 0
);
create table public.vaults(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id),
  gold_bars bigint not null default 0,
  gold_grams numeric not null default 0
);
create table public.sd_achievements(
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  icon text,
  title_reward text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  hidden boolean not null default false
);
create table public.sd_achievement_progress(
  user_id uuid not null references auth.users(id),
  achievement_id text not null,
  current_value numeric not null default 0,
  unlocked boolean not null default false,
  unlocked_at timestamptz,
  source_app text not null default 'unknown',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint sd_achievement_progress_pkey primary key(user_id,achievement_id)
);
create table public.sd_user_achievements(
  user_id uuid not null references auth.users(id),
  achievement_id uuid not null references public.sd_achievements(id),
  unlocked_at timestamptz not null default now(),
  primary key(user_id,achievement_id)
);

alter table public.sd_achievement_progress enable row level security;
create policy sd_achievement_progress_select_own on public.sd_achievement_progress for select to authenticated using(user_id=auth.uid());
create policy sd_achievement_progress_insert_own on public.sd_achievement_progress for insert to authenticated with check(user_id=auth.uid());
create policy sd_achievement_progress_update_own on public.sd_achievement_progress for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy sd_achievement_progress_delete_own on public.sd_achievement_progress for delete to authenticated using(user_id=auth.uid());
grant select,insert,update,delete,truncate on public.sd_achievement_progress to authenticated;
grant select on public.wallets,public.vaults to authenticated;

create or replace function private.bridge_sd_achievement_title()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.unlocked is true then
    insert into public.sd_user_achievements(user_id,achievement_id,unlocked_at)
    select new.user_id,a.id,coalesce(new.unlocked_at,new.updated_at,now())
    from public.sd_achievements a
    where a.code=new.achievement_id and a.active=true
    on conflict(user_id,achievement_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.bridge_sd_achievement_title() from public,anon,authenticated;
create trigger trg_sd_achievement_title_bridge
after insert or update of unlocked,unlocked_at on public.sd_achievement_progress
for each row execute function private.bridge_sd_achievement_title();

-- Vulnerable legacy sync used by the fixture before hardening.
create or replace function public.sync_sd_achievement_progress(p_items jsonb,p_source_app text default 'unknown')
returns table(achievement_id text,current_value numeric,unlocked boolean,unlocked_at timestamptz,source_app text,updated_at timestamptz)
language plpgsql set search_path='public' as $$
declare v_user_id uuid:=auth.uid(); v_item jsonb; v_id text; v_value numeric; v_unlocked boolean;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_id:=lower(trim(coalesce(v_item->>'achievement_id',v_item->>'id','')));
    v_value:=greatest(0,coalesce((v_item->>'current_value')::numeric,(v_item->>'value')::numeric,0));
    v_unlocked:=coalesce((v_item->>'unlocked')::boolean,false);
    insert into public.sd_achievement_progress as p(user_id,achievement_id,current_value,unlocked,unlocked_at,source_app,metadata,updated_at)
    values(v_user_id,v_id,v_value,v_unlocked,case when v_unlocked then now() end,p_source_app,'{}'::jsonb,now())
    on conflict on constraint sd_achievement_progress_pkey do update
      set current_value=greatest(p.current_value,excluded.current_value),unlocked=p.unlocked or excluded.unlocked,
          unlocked_at=case when p.unlocked_at is not null then p.unlocked_at when p.unlocked or excluded.unlocked then now() end,
          source_app=excluded.source_app,updated_at=now();
  end loop;
  return query select p.achievement_id,p.current_value,p.unlocked,p.unlocked_at,p.source_app,p.updated_at
  from public.sd_achievement_progress p where p.user_id=v_user_id order by p.achievement_id;
end;
$$;
grant execute on function public.sync_sd_achievement_progress(jsonb,text) to authenticated;

insert into auth.users(id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.wallets(user_id,balance) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0);
insert into public.vaults(user_id,gold_bars,gold_grams) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,0);

-- Exact catalog: 50 server-validated + 49 pending candidates = 99.
with codes(code) as (
  select unnest(array[
    'flea-05','flea-06','flea-07','flea-12','flea-13','flea-19',
    'slot-01','slot-02','slot-03','slot-04','slot-05','slot-06','slot-07',
    'oddeven-01','oddeven-02','oddeven-03','oddeven-04','oddeven-05','oddeven-06','oddeven-07','oddeven-08','oddeven-09','oddeven-10',
    'npcvault-01','npcvault-02','npcvault-03','npcvault-04','npcvault-05','npcvault-06','npcvault-07','npcvault-08',
    'sdcoin-01','sdcoin-02','sdcoin-03','sdcoin-coin-01','sdcoin-coin-02','sdcoin-coin-03','sdcoin-coin-04','sdcoin-coin-05','sdcoin-coin-06',
    'wallet-01','wallet-02','wallet-03','wallet-04','wallet-05','wallet-06','wallet-07',
    'gold-01','gold-02','gold-03',
    'bitcoin-01','bitcoin-02','bitcoin-03','bitcoin-04','bitcoin-05',
    'flea-01','flea-02','flea-03','flea-04','flea-08','flea-09','flea-10','flea-11','flea-14','flea-15','flea-16','flea-17','flea-18',
    'logistics-01','logistics-02','logistics-03','logistics-04','logistics-05','logistics-06','logistics-07','logistics-08','logistics-09','logistics-10','logistics-11','logistics-12','logistics-13','logistics-14','logistics-15','logistics-16',
    'miner-01','miner-02','miner-03','miner-04','miner-05','miner-06','miner-07','miner-08','miner-09',
    'mukjjippa-01','mukjjippa-02','ranking-01','sta-01','sta-02','sta-03'
  ]::text[])
)
insert into public.sd_achievements(code,name,title_reward,sort_order,active,hidden)
select code,code,code,row_number() over(order by code),true,code='bitcoin-05' from codes;

-- Simulate a previously legitimate local-only unlock. It must survive deactivation.
insert into public.sd_achievement_progress(user_id,achievement_id,current_value,unlocked,unlocked_at,source_app)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bitcoin-01',1,true,now()-interval '1 day','legacy-valid');
