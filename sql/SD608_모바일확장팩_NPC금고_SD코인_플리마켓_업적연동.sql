-- SD608 모바일 확장팩 업적 서버 연동
-- NPC 금고 따기 / SD코인 / 플리마켓
-- Live Supabase migration: mobile_npc_sdcoin_flea_achievement_sync
--
-- 원칙
-- 1) 모바일 확장팩의 서버 기록을 공용 sd_achievement_progress에 반영합니다.
-- 2) 기존 기록을 즉시 백필합니다.
-- 3) 앞으로의 기록은 DB trigger로 즉시 반영합니다.
-- 4) PC 전용 플리마켓 업적(은행 습격/루팅 등)은 여기서 추정하지 않습니다.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.refresh_sd_npc_vault_achievements(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_total_success numeric := 0;
  v_normal_success numeric := 0;
  v_large_success numeric := 0;
  v_mega_success numeric := 0;
  v_type_count numeric := 0;
  v_streak numeric := 0;
  v_max_streak numeric := 0;
begin
  if p_user_id is null then return; end if;

  select
    count(*) filter (where status = 'success'),
    count(*) filter (where status = 'success' and difficulty = 'normal'),
    count(*) filter (where status = 'success' and difficulty = 'large'),
    count(*) filter (where status = 'success' and difficulty = 'mega')
  into v_total_success, v_normal_success, v_large_success, v_mega_success
  from public.npc_vault_runs
  where user_id = p_user_id
    and status in ('success', 'failed');

  v_type_count :=
    (case when v_normal_success > 0 then 1 else 0 end) +
    (case when v_large_success > 0 then 1 else 0 end) +
    (case when v_mega_success > 0 then 1 else 0 end);

  for v_row in
    select status
    from public.npc_vault_runs
    where user_id = p_user_id
      and status in ('success', 'failed')
    order by coalesce(completed_at, created_at), created_at, id
  loop
    if v_row.status = 'success' then
      v_streak := v_streak + 1;
      v_max_streak := greatest(v_max_streak, v_streak);
    else
      v_streak := 0;
    end if;
  end loop;

  insert into public.sd_achievement_progress as p
    (user_id, achievement_id, current_value, unlocked, unlocked_at, source_app, metadata, updated_at)
  values
    (p_user_id, 'npcvault-01', v_normal_success, v_normal_success >= 1, case when v_normal_success >= 1 then now() end, 'mobile-extension-server', jsonb_build_object('extension','npc-vault','metric','normal_successes'), now()),
    (p_user_id, 'npcvault-02', v_large_success, v_large_success >= 1, case when v_large_success >= 1 then now() end, 'mobile-extension-server', jsonb_build_object('extension','npc-vault','metric','large_successes'), now()),
    (p_user_id, 'npcvault-03', v_mega_success, v_mega_success >= 1, case when v_mega_success >= 1 then now() end, 'mobile-extension-server', jsonb_build_object('extension','npc-vault','metric','mega_successes'), now()),
    (p_user_id, 'npcvault-04', v_total_success, v_total_success >= 10, case when v_total_success >= 10 then now() end, 'mobile-extension-server', jsonb_build_object('extension','npc-vault','metric','total_successes'), now()),
    (p_user_id, 'npcvault-05', v_total_success, v_total_success >= 100, case when v_total_success >= 100 then now() end, 'mobile-extension-server', jsonb_build_object('extension','npc-vault','metric','total_successes'), now()),
    (p_user_id, 'npcvault-06', v_mega_success, v_mega_success >= 10, case when v_mega_success >= 10 then now() end, 'mobile-extension-server', jsonb_build_object('extension','npc-vault','metric','mega_successes'), now()),
    (p_user_id, 'npcvault-07', v_type_count, v_type_count >= 3, case when v_type_count >= 3 then now() end, 'mobile-extension-server', jsonb_build_object('extension','npc-vault','metric','vault_types_cleared'), now()),
    (p_user_id, 'npcvault-08', v_max_streak, v_max_streak >= 10, case when v_max_streak >= 10 then now() end, 'mobile-extension-server', jsonb_build_object('extension','npc-vault','metric','max_success_streak'), now())
  on conflict on constraint sd_achievement_progress_pkey do update
    set current_value = greatest(p.current_value, excluded.current_value),
        unlocked = p.unlocked or excluded.unlocked,
        unlocked_at = case
          when p.unlocked_at is not null then p.unlocked_at
          when p.unlocked or excluded.unlocked then now()
          else null
        end,
        source_app = excluded.source_app,
        metadata = coalesce(p.metadata, '{}'::jsonb) || excluded.metadata,
        updated_at = now();
end;
$$;

revoke all on function private.refresh_sd_npc_vault_achievements(uuid) from public, anon, authenticated;

create or replace function private.refresh_sdcoin_achievements(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ddj numeric := 0;
  v_hsh numeric := 0;
  v_set numeric := 0;
  v_hiz numeric := 0;
  v_kng numeric := 0;
  v_sdc numeric := 0;
  v_owned_types numeric := 0;
  v_first_buy numeric := 0;
  v_max_any numeric := 0;
begin
  if p_user_id is null then return; end if;

  with movements as (
    select
      c.code,
      t.created_at,
      t.id,
      case when t.side = 'buy' then t.quantity else -t.quantity end as delta
    from public.sd_coin_trades t
    join public.sd_coins c on c.id = t.coin_id
    where t.user_id = p_user_id
      and c.code in ('DDJ','HSH','SET','HIZ','KNG','SDC')
  ), running as (
    select
      code,
      sum(delta) over (
        partition by code
        order by created_at, id
        rows between unbounded preceding and current row
      ) as quantity
    from movements
  ), historical as (
    select code, greatest(coalesce(max(quantity), 0), 0) as quantity
    from running
    group by code
  ), current_holdings as (
    select c.code, greatest(h.quantity, 0) as quantity
    from public.sd_coin_holdings h
    join public.sd_coins c on c.id = h.coin_id
    where h.user_id = p_user_id
      and c.code in ('DDJ','HSH','SET','HIZ','KNG','SDC')
  ), combined as (
    select code, max(quantity) as quantity
    from (
      select code, quantity from historical
      union all
      select code, quantity from current_holdings
    ) q
    group by code
  )
  select
    coalesce(max(quantity) filter (where code='DDJ'), 0),
    coalesce(max(quantity) filter (where code='HSH'), 0),
    coalesce(max(quantity) filter (where code='SET'), 0),
    coalesce(max(quantity) filter (where code='HIZ'), 0),
    coalesce(max(quantity) filter (where code='KNG'), 0),
    coalesce(max(quantity) filter (where code='SDC'), 0),
    count(*) filter (where quantity > 0),
    coalesce(max(quantity), 0)
  into v_ddj, v_hsh, v_set, v_hiz, v_kng, v_sdc, v_owned_types, v_max_any
  from combined;

  select case when exists (
    select 1
    from public.sd_coin_trades
    where user_id = p_user_id and side = 'buy'
  ) then 1 else 0 end
  into v_first_buy;

  insert into public.sd_achievement_progress as p
    (user_id, achievement_id, current_value, unlocked, unlocked_at, source_app, metadata, updated_at)
  values
    (p_user_id, 'sdcoin-coin-01', v_ddj, v_ddj >= 10000, case when v_ddj >= 10000 then now() end, 'mobile-extension-server', jsonb_build_object('extension','sdcoin','coin_code','DDJ','metric','max_owned'), now()),
    (p_user_id, 'sdcoin-coin-02', v_hsh, v_hsh >= 10000, case when v_hsh >= 10000 then now() end, 'mobile-extension-server', jsonb_build_object('extension','sdcoin','coin_code','HSH','metric','max_owned'), now()),
    (p_user_id, 'sdcoin-coin-03', v_set, v_set >= 10000, case when v_set >= 10000 then now() end, 'mobile-extension-server', jsonb_build_object('extension','sdcoin','coin_code','SET','metric','max_owned'), now()),
    (p_user_id, 'sdcoin-coin-04', v_hiz, v_hiz >= 10000, case when v_hiz >= 10000 then now() end, 'mobile-extension-server', jsonb_build_object('extension','sdcoin','coin_code','HIZ','metric','max_owned'), now()),
    (p_user_id, 'sdcoin-coin-05', v_kng, v_kng >= 10000, case when v_kng >= 10000 then now() end, 'mobile-extension-server', jsonb_build_object('extension','sdcoin','coin_code','KNG','metric','max_owned'), now()),
    (p_user_id, 'sdcoin-coin-06', v_sdc, v_sdc >= 10000, case when v_sdc >= 10000 then now() end, 'mobile-extension-server', jsonb_build_object('extension','sdcoin','coin_code','SDC','metric','max_owned'), now()),
    (p_user_id, 'sdcoin-01', v_first_buy, v_first_buy >= 1, case when v_first_buy >= 1 then now() end, 'mobile-extension-server', jsonb_build_object('extension','sdcoin','metric','first_buy'), now()),
    (p_user_id, 'sdcoin-02', v_owned_types, v_owned_types >= 6, case when v_owned_types >= 6 then now() end, 'mobile-extension-server', jsonb_build_object('extension','sdcoin','metric','coin_types_ever_owned'), now()),
    (p_user_id, 'sdcoin-03', v_max_any, v_max_any >= 100000, case when v_max_any >= 100000 then now() end, 'mobile-extension-server', jsonb_build_object('extension','sdcoin','metric','max_single_coin_owned'), now())
  on conflict on constraint sd_achievement_progress_pkey do update
    set current_value = greatest(p.current_value, excluded.current_value),
        unlocked = p.unlocked or excluded.unlocked,
        unlocked_at = case
          when p.unlocked_at is not null then p.unlocked_at
          when p.unlocked or excluded.unlocked then now()
          else null
        end,
        source_app = excluded.source_app,
        metadata = coalesce(p.metadata, '{}'::jsonb) || excluded.metadata,
        updated_at = now();
end;
$$;

revoke all on function private.refresh_sdcoin_achievements(uuid) from public, anon, authenticated;

create or replace function private.refresh_sd_flea_mobile_achievements(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale_count numeric := 0;
  v_sale_amount numeric := 0;
  v_other_buy_count numeric := 0;
  v_sale_amount_existing numeric := 0;
  v_sale_amount_old_server numeric := 0;
  v_sale_amount_base numeric := null;
  v_sale_amount_final numeric := 0;
  v_sale_count_existing numeric := 0;
  v_sale_count_old_server numeric := 0;
  v_sale_count_base numeric := null;
  v_sale_count_final numeric := 0;
begin
  if p_user_id is null then return; end if;

  select
    count(*) filter (where action_type = 'sell'),
    coalesce(sum(case when action_type = 'sell' then greatest(coalesce((result->>'payout')::numeric, 0), 0) else 0 end), 0)
  into v_sale_count, v_sale_amount
  from public.sd_flea_market_actions
  where user_id = p_user_id;

  select count(*)
  into v_other_buy_count
  from public.sd_flea_market_actions b
  join lateral (
    select s.user_id
    from public.sd_flea_market_actions s
    where s.action_type = 'sell'
      and s.result->>'item_id' = b.result->>'item_id'
      and s.created_at < b.created_at
    order by s.created_at desc
    limit 1
  ) seller on true
  where b.user_id = p_user_id
    and b.action_type = 'buy'
    and seller.user_id <> b.user_id;

  -- PC/SD Link에서 이미 같은 누적 수치가 올라온 경우 그 값을 기준점으로 보존하고
  -- 모바일 서버 판매 기록을 그 뒤에 이어 붙입니다.
  select
    coalesce(max(current_value), 0),
    coalesce(max(case when metadata ? 'server_value' then (metadata->>'server_value')::numeric end), 0),
    max(case when metadata ? 'progress_base_value' then (metadata->>'progress_base_value')::numeric end)
  into v_sale_amount_existing, v_sale_amount_old_server, v_sale_amount_base
  from public.sd_achievement_progress
  where user_id = p_user_id
    and achievement_id in ('flea-05','flea-06','flea-07');

  if v_sale_amount_base is null then
    v_sale_amount_base := v_sale_amount_existing;
  elsif v_sale_amount_existing > v_sale_amount_base + v_sale_amount_old_server then
    v_sale_amount_base := v_sale_amount_base + (v_sale_amount_existing - (v_sale_amount_base + v_sale_amount_old_server));
  end if;
  v_sale_amount_final := v_sale_amount_base + v_sale_amount;

  select
    coalesce(current_value, 0),
    coalesce(case when metadata ? 'server_value' then (metadata->>'server_value')::numeric end, 0),
    case when metadata ? 'progress_base_value' then (metadata->>'progress_base_value')::numeric end
  into v_sale_count_existing, v_sale_count_old_server, v_sale_count_base
  from public.sd_achievement_progress
  where user_id = p_user_id and achievement_id = 'flea-13';

  if not found then
    v_sale_count_existing := 0;
    v_sale_count_old_server := 0;
    v_sale_count_base := 0;
  elsif v_sale_count_base is null then
    v_sale_count_base := v_sale_count_existing;
  elsif v_sale_count_existing > v_sale_count_base + v_sale_count_old_server then
    v_sale_count_base := v_sale_count_base + (v_sale_count_existing - (v_sale_count_base + v_sale_count_old_server));
  end if;
  v_sale_count_final := v_sale_count_base + v_sale_count;

  insert into public.sd_achievement_progress as p
    (user_id, achievement_id, current_value, unlocked, unlocked_at, source_app, metadata, updated_at)
  values
    (p_user_id, 'flea-05', v_sale_amount_final, v_sale_amount_final >= 10000000, case when v_sale_amount_final >= 10000000 then now() end, 'mobile-extension-server', jsonb_build_object('extension','flea-market','metric','sales_amount','server_value',v_sale_amount,'progress_base_value',v_sale_amount_base), now()),
    (p_user_id, 'flea-06', v_sale_amount_final, v_sale_amount_final >= 100000000, case when v_sale_amount_final >= 100000000 then now() end, 'mobile-extension-server', jsonb_build_object('extension','flea-market','metric','sales_amount','server_value',v_sale_amount,'progress_base_value',v_sale_amount_base), now()),
    (p_user_id, 'flea-07', v_sale_amount_final, v_sale_amount_final >= 1000000000, case when v_sale_amount_final >= 1000000000 then now() end, 'mobile-extension-server', jsonb_build_object('extension','flea-market','metric','sales_amount','server_value',v_sale_amount,'progress_base_value',v_sale_amount_base), now()),
    (p_user_id, 'flea-12', case when v_sale_count > 0 then 1 else 0 end, v_sale_count > 0, case when v_sale_count > 0 then now() end, 'mobile-extension-server', jsonb_build_object('extension','flea-market','metric','first_sale'), now()),
    (p_user_id, 'flea-13', v_sale_count_final, v_sale_count_final >= 1000, case when v_sale_count_final >= 1000 then now() end, 'mobile-extension-server', jsonb_build_object('extension','flea-market','metric','items_sold','server_value',v_sale_count,'progress_base_value',v_sale_count_base), now()),
    (p_user_id, 'flea-19', v_other_buy_count, v_other_buy_count >= 50, case when v_other_buy_count >= 50 then now() end, 'mobile-extension-server', jsonb_build_object('extension','flea-market','metric','other_user_market_buys'), now())
  on conflict on constraint sd_achievement_progress_pkey do update
    set current_value = greatest(p.current_value, excluded.current_value),
        unlocked = p.unlocked or excluded.unlocked,
        unlocked_at = case
          when p.unlocked_at is not null then p.unlocked_at
          when p.unlocked or excluded.unlocked then now()
          else null
        end,
        source_app = excluded.source_app,
        metadata = coalesce(p.metadata, '{}'::jsonb) || excluded.metadata,
        updated_at = now();
end;
$$;

revoke all on function private.refresh_sd_flea_mobile_achievements(uuid) from public, anon, authenticated;

create or replace function public.sd_mobile_extension_achievement_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'npc_vault_runs' then
    if new.status in ('success','failed') then
      perform private.refresh_sd_npc_vault_achievements(new.user_id);
    end if;
  elsif tg_table_name = 'sd_coin_trades' then
    perform private.refresh_sdcoin_achievements(new.user_id);
  elsif tg_table_name = 'sd_flea_market_actions' then
    perform private.refresh_sd_flea_mobile_achievements(new.user_id);
  end if;
  return new;
end;
$$;

revoke all on function public.sd_mobile_extension_achievement_trigger() from public, anon, authenticated;

drop trigger if exists trg_sd_npc_vault_achievements on public.npc_vault_runs;
create trigger trg_sd_npc_vault_achievements
after insert or update of status, difficulty on public.npc_vault_runs
for each row
when (new.status in ('success','failed'))
execute function public.sd_mobile_extension_achievement_trigger();

drop trigger if exists trg_sdcoin_achievements on public.sd_coin_trades;
create trigger trg_sdcoin_achievements
after insert on public.sd_coin_trades
for each row
execute function public.sd_mobile_extension_achievement_trigger();

drop trigger if exists trg_sd_flea_mobile_achievements on public.sd_flea_market_actions;
create trigger trg_sd_flea_mobile_achievements
after insert on public.sd_flea_market_actions
for each row
execute function public.sd_mobile_extension_achievement_trigger();

-- 기존 모바일 서버 기록도 즉시 업적에 반영합니다.
do $$
declare
  v record;
begin
  for v in select distinct user_id from public.npc_vault_runs where user_id is not null loop
    perform private.refresh_sd_npc_vault_achievements(v.user_id);
  end loop;

  for v in select distinct user_id from public.sd_coin_trades where user_id is not null loop
    perform private.refresh_sdcoin_achievements(v.user_id);
  end loop;

  for v in select distinct user_id from public.sd_flea_market_actions where user_id is not null loop
    perform private.refresh_sd_flea_mobile_achievements(v.user_id);
  end loop;
end;
$$;
