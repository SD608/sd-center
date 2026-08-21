begin;

create table if not exists public.sd_sta_accounts(
 user_id uuid primary key references auth.users(id) on delete cascade,
 completed_operations bigint not null default 0 check(completed_operations>=0),
 zero_hit_completions bigint not null default 0 check(zero_hit_completions>=0),
 hacking_rounds_completed bigint not null default 0 check(hacking_rounds_completed>=0),
 max_raw_cash bigint not null default 0 check(max_raw_cash>=0),
 max_payout bigint not null default 0 check(max_payout>=0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.sd_sta_server_operations(
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
 entry_fee bigint not null default 50000 check(entry_fee=50000),status text not null default 'active' check(status in('active','failed','completed')),
 phase text not null default 'hacking' check(phase in('hacking','raid_ready','raid_laser','raid_vault','raid_loot','transport_ready','transport','payout','failed','completed')),
 hacking_round integer not null default 1 check(hacking_round between 1 and 3),hacking_connections jsonb not null default '[]'::jsonb check(jsonb_typeof(hacking_connections)='array'),
 laser_hits integer not null default 0 check(laser_hits>=0),laser_checkpoint integer not null default 0 check(laser_checkpoint between 0 and 2),
 vault_progress integer not null default 0 check(vault_progress between 0 and 100),last_vault_hit_at timestamptz,
 raw_cash bigint not null default 0 check(raw_cash>=0 and raw_cash<=1000000),loot_started_at timestamptz,loot_ends_at timestamptz,last_loot_click_at timestamptz,loot_clicks integer not null default 0 check(loot_clicks between 0 and 500),
 transport_hits integer not null default 0 check(transport_hits>=0),transport_checkpoint integer not null default 0 check(transport_checkpoint between 0 and 2),last_transport_hit_at timestamptz,
 next_operation_unlock_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),ended_at timestamptz
);
create unique index if not exists sd_sta_one_active on public.sd_sta_server_operations(user_id) where status='active';
create table if not exists public.sd_sta_actions(
 request_id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,action_type text not null,operation_id uuid,
 input jsonb not null default '{}'::jsonb check(jsonb_typeof(input)='object'),result jsonb not null default '{}'::jsonb check(jsonb_typeof(result)='object'),created_at timestamptz not null default now()
);

alter table public.sd_sta_accounts enable row level security; alter table public.sd_sta_server_operations enable row level security; alter table public.sd_sta_actions enable row level security;
revoke all on public.sd_sta_accounts,public.sd_sta_server_operations,public.sd_sta_actions from public,anon,authenticated;

create or replace function private.sd_sta_replay(p_user uuid,p_req uuid,p_action text,p_op uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare v public.sd_sta_actions%rowtype; begin
 if p_req is null then raise exception using errcode='P1007',message='REQUEST_ID_REQUIRED'; end if; perform pg_advisory_xact_lock(hashtextextended(p_req::text,0)); select * into v from public.sd_sta_actions where request_id=p_req;
 if v.request_id is null then return null; end if; if v.user_id is distinct from p_user or v.action_type is distinct from p_action or v.operation_id is distinct from p_op or v.input is distinct from coalesce(p_input,'{}'::jsonb) then raise exception using errcode='P1015',message='STA_REQUEST_IDEMPOTENCY_CONFLICT'; end if; return v.result; end$$;
create or replace function private.sd_sta_save(p_user uuid,p_req uuid,p_action text,p_op uuid,p_input jsonb,p_result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin insert into public.sd_sta_actions values(p_req,p_user,p_action,p_op,coalesce(p_input,'{}'::jsonb),coalesce(p_result,'{}'::jsonb),now()); return p_result; end$$;
create or replace function private.refresh_sd_sta_achievements(p_user uuid) returns void language plpgsql security definer set search_path='' as $$declare a public.sd_sta_accounts%rowtype; begin
 insert into public.sd_sta_accounts(user_id) values(p_user) on conflict do nothing; select * into a from public.sd_sta_accounts where user_id=p_user;
 perform private.upsert_sd_authoritative_achievement(p_user,'sta-01',a.zero_hit_completions,1,jsonb_build_object('authority','sta-server','metric','zero_hit_completion'));
 perform private.upsert_sd_authoritative_achievement(p_user,'sta-02',a.max_raw_cash,1000000,jsonb_build_object('authority','sta-server','metric','max_raw_cash_single_operation'));
 perform private.upsert_sd_authoritative_achievement(p_user,'sta-03',a.hacking_rounds_completed,100,jsonb_build_object('authority','sta-server','metric','hacking_rounds_completed'));
 end$$;
revoke all on function private.sd_sta_replay(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function private.sd_sta_save(uuid,uuid,text,uuid,jsonb,jsonb) from public,anon,authenticated;
revoke all on function private.refresh_sd_sta_achievements(uuid) from public,anon,authenticated;

commit;