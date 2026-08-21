begin;

create table if not exists public.sd_miner_accounts(
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_mined bigint not null default 0 check(total_mined>=0),
  total_sales_krw bigint not null default 0 check(total_sales_krw>=0),
  auto_mining_unlocked boolean not null default false,
  highest_tier_found boolean not null default false,
  current_diamond_streak integer not null default 0 check(current_diamond_streak>=0),
  max_diamond_streak integer not null default 0 check(max_diamond_streak>=0),
  legacy_sales_baseline bigint not null default 0 check(legacy_sales_baseline>=0),
  last_mine_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sd_miner_inventory(
  user_id uuid not null references auth.users(id) on delete cascade,
  ore_key text not null check(ore_key in('stone','copper','iron','emerald','diamond')),
  quantity bigint not null default 0 check(quantity>=0),
  acquired_count bigint not null default 0 check(acquired_count>=0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,ore_key)
);

create table if not exists public.sd_miner_actions(
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action_type text not null,
  input jsonb not null default '{}'::jsonb check(jsonb_typeof(input)='object'),
  result jsonb not null default '{}'::jsonb check(jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);
create index if not exists sd_miner_actions_user_created_idx on public.sd_miner_actions(user_id,created_at desc);

alter table public.sd_miner_accounts enable row level security;
alter table public.sd_miner_inventory enable row level security;
alter table public.sd_miner_actions enable row level security;
revoke all on public.sd_miner_accounts,public.sd_miner_inventory,public.sd_miner_actions from public,anon,authenticated;

create or replace function private.sd_miner_action_replay(p_user_id uuid,p_request_id uuid,p_action_type text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.sd_miner_actions%rowtype;
begin
  if p_request_id is null then raise exception using errcode='P1007',message='REQUEST_ID_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into v from public.sd_miner_actions where request_id=p_request_id;
  if v.request_id is null then return null; end if;
  if v.user_id is distinct from p_user_id or v.action_type is distinct from p_action_type or v.input is distinct from coalesce(p_input,'{}'::jsonb) then
    raise exception using errcode='P1015',message='MINER_REQUEST_IDEMPOTENCY_CONFLICT';
  end if;
  return v.result;
end;$$;

create or replace function private.sd_miner_save_action(p_user_id uuid,p_request_id uuid,p_action_type text,p_input jsonb,p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  insert into public.sd_miner_actions(request_id,user_id,action_type,input,result)
  values(p_request_id,p_user_id,p_action_type,coalesce(p_input,'{}'::jsonb),coalesce(p_result,'{}'::jsonb));
  return p_result;
end;$$;

create or replace function private.sd_miner_ensure_account(p_user_id uuid)
returns public.sd_miner_accounts language plpgsql security definer set search_path='' as $$
declare a public.sd_miner_accounts%rowtype; k text;
begin
  insert into public.sd_miner_accounts(user_id) values(p_user_id) on conflict(user_id) do nothing;
  foreach k in array array['stone','copper','iron','emerald','diamond'] loop
    insert into public.sd_miner_inventory(user_id,ore_key) values(p_user_id,k) on conflict(user_id,ore_key) do nothing;
  end loop;
  select * into a from public.sd_miner_accounts where user_id=p_user_id;
  return a;
end;$$;

create or replace function private.sd_miner_roll_ore()
returns text language plpgsql volatile security definer set search_path='' as $$
declare r integer:=floor(random()*1000)::int;
begin
  if r<476 then return 'stone';
  elsif r<714 then return 'copper';
  elsif r<857 then return 'iron';
  elsif r<952 then return 'emerald';
  else return 'diamond'; end if;
end;$$;

create or replace function private.sd_miner_ore_price(p_key text)
returns bigint language sql immutable security definer set search_path='' as $$
  select case p_key when 'stone' then 100 when 'copper' then 500 when 'iron' then 1200 when 'emerald' then 3000 when 'diamond' then 8000 else null end::bigint
$$;

create or replace function private.refresh_sd_miner_achievements(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare a public.sd_miner_accounts%rowtype; v_kinds bigint:=0;
begin
  if p_user_id is null then return; end if;
  perform private.sd_miner_ensure_account(p_user_id);
  select * into a from public.sd_miner_accounts where user_id=p_user_id;
  select count(*) into v_kinds from public.sd_miner_inventory where user_id=p_user_id and acquired_count>0;
  perform private.upsert_sd_authoritative_achievement(p_user_id,'miner-01',a.total_mined,1000,jsonb_build_object('authority','miner-server','metric','total_mined'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'miner-02',a.total_sales_krw,1000000,jsonb_build_object('authority','miner-server','metric','sales_krw'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'miner-03',a.total_sales_krw,5000000,jsonb_build_object('authority','miner-server','metric','sales_krw'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'miner-04',a.total_sales_krw,10000000,jsonb_build_object('authority','miner-server','metric','sales_krw'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'miner-05',a.total_mined,10000,jsonb_build_object('authority','miner-server','metric','total_mined'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'miner-06',case when a.highest_tier_found then 1 else 0 end,1,jsonb_build_object('authority','miner-server','metric','diamond_found'));
  -- The current game emits one ore per mining action. To make the active "금맥" achievement actually obtainable,
  -- "연속 획득" is defined as diamond on two consecutive accepted server mining actions.
  perform private.upsert_sd_authoritative_achievement(p_user_id,'miner-07',a.max_diamond_streak,2,jsonb_build_object('authority','miner-server','metric','consecutive_diamond','target',2));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'miner-08',v_kinds,5,jsonb_build_object('authority','miner-server','metric','ore_kinds','target',5));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'miner-09',a.total_sales_krw,100000000,jsonb_build_object('authority','miner-server','metric','sales_krw'));
end;$$;

revoke all on function private.sd_miner_action_replay(uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function private.sd_miner_save_action(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function private.sd_miner_ensure_account(uuid) from public,anon,authenticated;
revoke all on function private.sd_miner_roll_ore() from public,anon,authenticated;
revoke all on function private.sd_miner_ore_price(text) from public,anon,authenticated;
revoke all on function private.refresh_sd_miner_achievements(uuid) from public,anon,authenticated;

-- Preserve only server-evidenced legacy economics as cutover baseline; do not trust old local inventory/mined counters for new unlocks.
do $$ declare r record;
begin
  for r in
    select u.id user_id,
      coalesce(sum(case when t.description like 'SD광산 · %판매%' and t.amount>0 then t.amount else 0 end),0)::bigint sales,
      bool_or(t.description='SD광산 · 자동 채굴 업그레이드' and t.amount<0) auto_owned
    from auth.users u left join public.transactions t on t.user_id=u.id
    group by u.id
  loop
    perform private.sd_miner_ensure_account(r.user_id);
    update public.sd_miner_accounts set total_sales_krw=greatest(total_sales_krw,r.sales),legacy_sales_baseline=greatest(legacy_sales_baseline,r.sales),
      auto_mining_unlocked=auto_mining_unlocked or coalesce(r.auto_owned,false),updated_at=now() where user_id=r.user_id;
    perform private.refresh_sd_miner_achievements(r.user_id);
  end loop;
end $$;

commit;