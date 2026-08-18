-- SD608 PC 슬롯·홀짝 온라인 서버 통합
-- Live Supabase migration: pc_game_online_bridge_and_achievements
-- PC와 모바일이 public.game_rounds / public.sd_odd_even_sessions를 함께 사용하고,
-- 완료된 게임 기록을 기준으로 슬롯·홀짝 업적을 자동 갱신합니다.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.refresh_sd_game_achievements(
  p_user_id uuid,
  p_game_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_won boolean;
  v_all_in boolean;

  v_slot_spins bigint := 0;
  v_slot_seven bigint := 0;
  v_slot_red_seven bigint := 0;
  v_slot_gold_seven bigint := 0;
  v_slot_payout numeric := 0;
  v_slot_fail_streak bigint := 0;
  v_slot_max_fail_streak bigint := 0;

  v_oe_wins bigint := 0;
  v_oe_win_streak bigint := 0;
  v_oe_max_win_streak bigint := 0;
  v_oe_loss_streak bigint := 0;
  v_oe_max_loss_streak bigint := 0;
  v_oe_allin_win_streak bigint := 0;
  v_oe_max_allin_win_streak bigint := 0;
  v_oe_odd_win_streak bigint := 0;
  v_oe_max_odd_win_streak bigint := 0;
  v_oe_even_win_streak bigint := 0;
  v_oe_max_even_win_streak bigint := 0;
  v_oe_seven_then_loss boolean := false;
  v_oe_allin_loss boolean := false;
begin
  if p_user_id is null then
    return;
  end if;

  if p_game_type = 'slot' then
    select
      count(*),
      count(*) filter (where result->>'result_key' = 'seven'),
      count(*) filter (where result->>'result_key' = 'red-seven'),
      count(*) filter (where result->>'result_key' = 'gold-seven'),
      coalesce(sum(payout), 0)
    into
      v_slot_spins,
      v_slot_seven,
      v_slot_red_seven,
      v_slot_gold_seven,
      v_slot_payout
    from public.game_rounds
    where user_id = p_user_id
      and game_type = 'slot'
      and status = 'completed';

    for v_row in
      select result
      from public.game_rounds
      where user_id = p_user_id
        and game_type = 'slot'
        and status = 'completed'
      order by coalesce(completed_at, created_at), created_at, id
    loop
      begin
        v_won := coalesce((v_row.result->>'won')::boolean, false);
      exception when others then
        v_won := false;
      end;

      if v_won then
        v_slot_fail_streak := 0;
      else
        v_slot_fail_streak := v_slot_fail_streak + 1;
        v_slot_max_fail_streak := greatest(v_slot_max_fail_streak, v_slot_fail_streak);
      end if;
    end loop;

    insert into public.sd_achievement_progress as p
      (user_id, achievement_id, current_value, unlocked, unlocked_at, source_app, metadata, updated_at)
    values
      (p_user_id, 'slot-01', v_slot_seven, v_slot_seven >= 1, case when v_slot_seven >= 1 then now() end, 'game-server', jsonb_build_object('game','slot','metric','seven_hits'), now()),
      (p_user_id, 'slot-02', v_slot_red_seven, v_slot_red_seven >= 1, case when v_slot_red_seven >= 1 then now() end, 'game-server', jsonb_build_object('game','slot','metric','red_seven_hits'), now()),
      (p_user_id, 'slot-03', v_slot_gold_seven, v_slot_gold_seven >= 1, case when v_slot_gold_seven >= 1 then now() end, 'game-server', jsonb_build_object('game','slot','metric','gold_seven_hits'), now()),
      (p_user_id, 'slot-04', v_slot_spins, v_slot_spins >= 100, case when v_slot_spins >= 100 then now() end, 'game-server', jsonb_build_object('game','slot','metric','spins'), now()),
      (p_user_id, 'slot-05', v_slot_spins, v_slot_spins >= 1000, case when v_slot_spins >= 1000 then now() end, 'game-server', jsonb_build_object('game','slot','metric','spins'), now()),
      (p_user_id, 'slot-06', v_slot_max_fail_streak, v_slot_max_fail_streak >= 50, case when v_slot_max_fail_streak >= 50 then now() end, 'game-server', jsonb_build_object('game','slot','metric','max_fail_streak'), now()),
      (p_user_id, 'slot-07', v_slot_payout, v_slot_payout >= 100000000, case when v_slot_payout >= 100000000 then now() end, 'game-server', jsonb_build_object('game','slot','metric','cumulative_payout'), now())
    on conflict on constraint sd_achievement_progress_pkey do update
      set current_value = greatest(p.current_value, excluded.current_value),
          unlocked = p.unlocked or excluded.unlocked,
          unlocked_at = case
            when p.unlocked_at is not null then p.unlocked_at
            when p.unlocked or excluded.unlocked then now()
            else null
          end,
          source_app = excluded.source_app,
          metadata = p.metadata || excluded.metadata,
          updated_at = now();
  end if;

  if p_game_type = 'odd_even' then
    for v_row in
      select choice, result, balance_after_wager
      from public.sd_odd_even_sessions
      where user_id = p_user_id
        and status = 'completed'
      order by coalesce(completed_at, created_at), created_at, id
    loop
      begin
        v_won := coalesce((v_row.result->>'won')::boolean, false);
      exception when others then
        v_won := false;
      end;
      v_all_in := coalesce(v_row.balance_after_wager, -1) = 0;

      if v_won then
        v_oe_wins := v_oe_wins + 1;
        v_oe_win_streak := v_oe_win_streak + 1;
        v_oe_max_win_streak := greatest(v_oe_max_win_streak, v_oe_win_streak);
        v_oe_loss_streak := 0;

        if v_all_in then
          v_oe_allin_win_streak := v_oe_allin_win_streak + 1;
          v_oe_max_allin_win_streak := greatest(v_oe_max_allin_win_streak, v_oe_allin_win_streak);
        else
          v_oe_allin_win_streak := 0;
        end if;

        if v_row.choice = 'odd' then
          v_oe_odd_win_streak := v_oe_odd_win_streak + 1;
          v_oe_max_odd_win_streak := greatest(v_oe_max_odd_win_streak, v_oe_odd_win_streak);
        else
          v_oe_odd_win_streak := 0;
        end if;

        if v_row.choice = 'even' then
          v_oe_even_win_streak := v_oe_even_win_streak + 1;
          v_oe_max_even_win_streak := greatest(v_oe_max_even_win_streak, v_oe_even_win_streak);
        else
          v_oe_even_win_streak := 0;
        end if;
      else
        if v_oe_win_streak >= 7 then
          v_oe_seven_then_loss := true;
        end if;
        v_oe_win_streak := 0;
        v_oe_loss_streak := v_oe_loss_streak + 1;
        v_oe_max_loss_streak := greatest(v_oe_max_loss_streak, v_oe_loss_streak);
        v_oe_allin_win_streak := 0;
        v_oe_odd_win_streak := 0;
        v_oe_even_win_streak := 0;
        if v_all_in then
          v_oe_allin_loss := true;
        end if;
      end if;
    end loop;

    insert into public.sd_achievement_progress as p
      (user_id, achievement_id, current_value, unlocked, unlocked_at, source_app, metadata, updated_at)
    values
      (p_user_id, 'oddeven-01', v_oe_max_win_streak, v_oe_max_win_streak >= 8, case when v_oe_max_win_streak >= 8 then now() end, 'game-server', jsonb_build_object('game','odd_even','metric','max_win_streak'), now()),
      (p_user_id, 'oddeven-02', v_oe_max_allin_win_streak, v_oe_max_allin_win_streak >= 8, case when v_oe_max_allin_win_streak >= 8 then now() end, 'game-server', jsonb_build_object('game','odd_even','metric','max_allin_win_streak'), now()),
      (p_user_id, 'oddeven-03', v_oe_max_loss_streak, v_oe_max_loss_streak >= 8, case when v_oe_max_loss_streak >= 8 then now() end, 'game-server', jsonb_build_object('game','odd_even','metric','max_loss_streak'), now()),
      (p_user_id, 'oddeven-04', v_oe_wins, v_oe_wins >= 1, case when v_oe_wins >= 1 then now() end, 'game-server', jsonb_build_object('game','odd_even','metric','wins'), now()),
      (p_user_id, 'oddeven-05', v_oe_wins, v_oe_wins >= 100, case when v_oe_wins >= 100 then now() end, 'game-server', jsonb_build_object('game','odd_even','metric','wins'), now()),
      (p_user_id, 'oddeven-06', v_oe_wins, v_oe_wins >= 1000, case when v_oe_wins >= 1000 then now() end, 'game-server', jsonb_build_object('game','odd_even','metric','wins'), now()),
      (p_user_id, 'oddeven-07', case when v_oe_seven_then_loss then 1 else 0 end, v_oe_seven_then_loss, case when v_oe_seven_then_loss then now() end, 'game-server', jsonb_build_object('game','odd_even','metric','seven_then_loss'), now()),
      (p_user_id, 'oddeven-08', case when v_oe_allin_loss then 1 else 0 end, v_oe_allin_loss, case when v_oe_allin_loss then now() end, 'game-server', jsonb_build_object('game','odd_even','metric','allin_loss'), now()),
      (p_user_id, 'oddeven-09', v_oe_max_odd_win_streak, v_oe_max_odd_win_streak >= 5, case when v_oe_max_odd_win_streak >= 5 then now() end, 'game-server', jsonb_build_object('game','odd_even','metric','max_odd_win_streak'), now()),
      (p_user_id, 'oddeven-10', v_oe_max_even_win_streak, v_oe_max_even_win_streak >= 5, case when v_oe_max_even_win_streak >= 5 then now() end, 'game-server', jsonb_build_object('game','odd_even','metric','max_even_win_streak'), now())
    on conflict on constraint sd_achievement_progress_pkey do update
      set current_value = greatest(p.current_value, excluded.current_value),
          unlocked = p.unlocked or excluded.unlocked,
          unlocked_at = case
            when p.unlocked_at is not null then p.unlocked_at
            when p.unlocked or excluded.unlocked then now()
            else null
          end,
          source_app = excluded.source_app,
          metadata = p.metadata || excluded.metadata,
          updated_at = now();
  end if;
end;
$$;

revoke all on function private.refresh_sd_game_achievements(uuid, text) from public, anon, authenticated;

create or replace function public.sd_game_achievement_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and new.game_type in ('slot', 'odd_even') then
    perform private.refresh_sd_game_achievements(new.user_id, new.game_type);
  end if;
  return new;
end;
$$;

revoke all on function public.sd_game_achievement_trigger() from public, anon, authenticated;

drop trigger if exists trg_sd_game_achievements on public.game_rounds;
create trigger trg_sd_game_achievements
after insert or update of status, result, payout on public.game_rounds
for each row
execute function public.sd_game_achievement_trigger();

create or replace function public.get_sd_online_game_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_wallet record;
  v_transactions jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select id, account_number, balance, updated_at
  into v_wallet
  from public.wallets
  where user_id = v_user_id;

  if v_wallet.id is null then
    raise exception '가상지갑을 찾지 못했습니다.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'type', case when t.amount < 0 then 'withdraw' else 'deposit' end,
    'memo', t.description,
    'amount', abs(t.amount),
    'createdAt', t.created_at,
    'transactionType', t.transaction_type,
    'platform', t.platform
  ) order by t.created_at desc), '[]'::jsonb)
  into v_transactions
  from (
    select id, amount, description, created_at, transaction_type, platform
    from public.transactions
    where user_id = v_user_id
    order by created_at desc
    limit 12
  ) as t;

  return jsonb_build_object(
    'connected', true,
    'user_id', v_user_id,
    'account_number', v_wallet.account_number,
    'balance', v_wallet.balance,
    'updated_at', v_wallet.updated_at,
    'transactions', v_transactions
  );
end;
$$;

revoke all on function public.get_sd_online_game_state() from public, anon;
grant execute on function public.get_sd_online_game_state() to authenticated;

-- 기존 서버 게임 기록도 즉시 업적에 반영합니다.
do $$
declare
  v record;
begin
  for v in
    select distinct user_id, game_type
    from public.game_rounds
    where status = 'completed'
      and game_type in ('slot', 'odd_even')
  loop
    perform private.refresh_sd_game_achievements(v.user_id, v.game_type);
  end loop;
end;
$$;
