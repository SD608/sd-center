begin;

create table if not exists public.sd_bitcoin_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  btc_balance numeric(30,8) not null default 0 check (btc_balance >= 0),
  max_btc_balance numeric(30,8) not null default 0 check (max_btc_balance >= 0),
  total_mined_btc numeric(30,8) not null default 0 check (total_mined_btc >= 0),
  total_sold_btc numeric(30,8) not null default 0 check (total_sold_btc >= 0),
  total_sales_krw bigint not null default 0 check (total_sales_krw >= 0),
  ever_acquired boolean not null default false,
  hit_exact_404 boolean not null default false,
  electricity_status text not null default 'active' check (electricity_status in ('active','suspended')),
  electricity_debt_krw bigint not null default 0 check (electricity_debt_krw >= 0),
  last_billed_utc_date date,
  unpaid_utc_date date,
  last_tick_at timestamptz,
  legacy_btc_baseline numeric(30,8) not null default 0 check (legacy_btc_baseline >= 0),
  legacy_gpu_cap integer not null default 0 check (legacy_gpu_cap between 0 and 75),
  legacy_imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sd_bitcoin_rooms (
  user_id uuid not null references auth.users(id) on delete cascade,
  room_key text not null check (room_key in ('A','B','C','D','E')),
  owned boolean not null default false,
  frames integer not null default 0 check (frames between 0 and 3),
  mined_btc numeric(30,8) not null default 0 check (mined_btc >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,room_key)
);

create table if not exists public.sd_bitcoin_gpu_units (
  user_id uuid not null references auth.users(id) on delete cascade,
  room_key text not null check (room_key in ('A','B','C','D','E')),
  slot_index integer not null check (slot_index between 0 and 14),
  durability integer not null default 100 check (durability between 0 and 100),
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,room_key,slot_index),
  foreign key(user_id,room_key) references public.sd_bitcoin_rooms(user_id,room_key) on delete cascade
);

create table if not exists public.sd_bitcoin_actions (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action_type text not null,
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input)='object'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);
create index if not exists sd_bitcoin_actions_user_created_idx on public.sd_bitcoin_actions(user_id,created_at desc);

alter table public.sd_bitcoin_accounts enable row level security;
alter table public.sd_bitcoin_rooms enable row level security;
alter table public.sd_bitcoin_gpu_units enable row level security;
alter table public.sd_bitcoin_actions enable row level security;

revoke all on public.sd_bitcoin_accounts,public.sd_bitcoin_rooms,public.sd_bitcoin_gpu_units,public.sd_bitcoin_actions from public,anon,authenticated;

create or replace function private.sd_bitcoin_action_replay(
  p_user_id uuid,p_request_id uuid,p_action_type text,p_input jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.sd_bitcoin_actions%rowtype;
begin
  if p_request_id is null then raise exception using errcode='P1007',message='REQUEST_ID_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into v from public.sd_bitcoin_actions where request_id=p_request_id;
  if v.request_id is null then return null; end if;
  if v.user_id is distinct from p_user_id or v.action_type is distinct from p_action_type or v.input is distinct from coalesce(p_input,'{}'::jsonb) then
    raise exception using errcode='P1015',message='BITCOIN_REQUEST_IDEMPOTENCY_CONFLICT';
  end if;
  return v.result;
end;
$$;

create or replace function private.sd_bitcoin_save_action(
  p_user_id uuid,p_request_id uuid,p_action_type text,p_input jsonb,p_result jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  insert into public.sd_bitcoin_actions(request_id,user_id,action_type,input,result)
  values(p_request_id,p_user_id,p_action_type,coalesce(p_input,'{}'::jsonb),coalesce(p_result,'{}'::jsonb));
  return p_result;
end;
$$;

create or replace function private.sd_bitcoin_ensure_account(p_user_id uuid)
returns public.sd_bitcoin_accounts language plpgsql security definer set search_path='' as $$
declare v public.sd_bitcoin_accounts%rowtype; k text;
begin
  insert into public.sd_bitcoin_accounts(user_id) values(p_user_id) on conflict(user_id) do nothing;
  foreach k in array array['A','B','C','D','E'] loop
    insert into public.sd_bitcoin_rooms(user_id,room_key) values(p_user_id,k) on conflict(user_id,room_key) do nothing;
  end loop;
  select * into v from public.sd_bitcoin_accounts where user_id=p_user_id;
  return v;
end;
$$;

create or replace function private.sd_bitcoin_sample_successes(p_trials bigint,p_durability integer)
returns integer language plpgsql volatile security definer set search_path='' as $$
declare
  v_trials bigint:=greatest(0,coalesce(p_trials,0));
  v_dur int:=greatest(0,least(100,coalesce(p_durability,0)));
  v_success int:=0;
  v_mean numeric;
  v_sd numeric;
  v_z numeric;
  i bigint;
  u1 double precision;
  u2 double precision;
begin
  if v_trials<=0 or v_dur<=0 then return 0; end if;
  if v_trials<=100000 then
    for i in 1..v_trials loop
      if random()<0.0002 then v_success:=v_success+1; exit when v_success>=v_dur; end if;
    end loop;
    return least(v_dur,v_success);
  end if;
  v_mean:=v_trials*0.0002;
  v_sd:=sqrt(v_trials*0.0002*0.9998);
  u1:=greatest(1e-12,random()); u2:=greatest(1e-12,random());
  v_z:=sqrt(-2*ln(u1))*cos(2*pi()*u2);
  v_success:=greatest(0,least(v_trials,round(v_mean+v_sd*v_z)::bigint))::int;
  return least(v_dur,v_success);
end;
$$;

create or replace function private.refresh_sd_bitcoin_achievements(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare a public.sd_bitcoin_accounts%rowtype;
begin
  if p_user_id is null then return; end if;
  perform private.sd_bitcoin_ensure_account(p_user_id);
  select * into a from public.sd_bitcoin_accounts where user_id=p_user_id;
  perform private.upsert_sd_authoritative_achievement(p_user_id,'bitcoin-01',case when a.ever_acquired then 1 else 0 end,1,jsonb_build_object('authority','bitcoin-server','metric','ever_acquired'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'bitcoin-02',a.max_btc_balance,10,jsonb_build_object('authority','bitcoin-server','metric','max_btc_balance'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'bitcoin-03',a.max_btc_balance,100,jsonb_build_object('authority','bitcoin-server','metric','max_btc_balance'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'bitcoin-04',a.max_btc_balance,1000,jsonb_build_object('authority','bitcoin-server','metric','max_btc_balance'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'bitcoin-05',case when a.hit_exact_404 then 1 else 0 end,1,jsonb_build_object('authority','bitcoin-server','metric','exact_404'));
end;
$$;

revoke all on function private.sd_bitcoin_action_replay(uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function private.sd_bitcoin_save_action(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function private.sd_bitcoin_ensure_account(uuid) from public,anon,authenticated;
revoke all on function private.sd_bitcoin_sample_successes(bigint,integer) from public,anon,authenticated;
revoke all on function private.refresh_sd_bitcoin_achievements(uuid) from public,anon,authenticated;

-- Production cutover backfill: preserve the existing server-side legacy BTC snapshot once.
do $$
declare r record; v_gpu int; v_date date; v_room text; v_remaining int; v_frames int; v_room_gpus int; i int;
begin
  if to_regclass('public.sd_bitcoin_snapshots') is null then return; end if;
  for r in execute 'select user_id,btc_quantity from public.sd_bitcoin_snapshots' loop
    select least(75,greatest(0,coalesce(round(abs(t.amount)/100000.0)::int,0))), (t.created_at at time zone 'UTC')::date
      into v_gpu,v_date
    from public.transactions t
    where t.user_id=r.user_id and t.description like 'SD비트코인 · UTC % 전기세'
    order by t.created_at desc limit 1;
    v_gpu:=coalesce(v_gpu,0);
    insert into public.sd_bitcoin_accounts(user_id,btc_balance,max_btc_balance,ever_acquired,legacy_btc_baseline,legacy_gpu_cap,legacy_imported_at,last_billed_utc_date,last_tick_at)
    values(r.user_id,round(greatest(0,r.btc_quantity),8),round(greatest(0,r.btc_quantity),8),r.btc_quantity>0,round(greatest(0,r.btc_quantity),8),v_gpu,now(),v_date,now())
    on conflict(user_id) do nothing;
    perform private.sd_bitcoin_ensure_account(r.user_id);
    v_remaining:=v_gpu;
    foreach v_room in array array['A','B','C','D','E'] loop
      v_room_gpus:=least(15,v_remaining);
      v_frames:=case when v_room_gpus>0 then ceil(v_room_gpus/5.0)::int else 0 end;
      update public.sd_bitcoin_rooms set owned=(v_room_gpus>0),frames=v_frames,updated_at=now() where user_id=r.user_id and room_key=v_room;
      for i in 0..greatest(-1,v_room_gpus-1) loop
        if i>=0 then insert into public.sd_bitcoin_gpu_units(user_id,room_key,slot_index,durability) values(r.user_id,v_room,i,100) on conflict do nothing; end if;
      end loop;
      v_remaining:=greatest(0,v_remaining-v_room_gpus);
    end loop;
    perform private.refresh_sd_bitcoin_achievements(r.user_id);
  end loop;
end $$;

commit;