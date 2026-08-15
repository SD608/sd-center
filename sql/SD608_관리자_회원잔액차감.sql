-- SD608 Online - 관리자 회원 가상잔액 차감
-- 목적: 잘못 지급한 SD 게임용 가상잔액을 관리자가 회수할 수 있게 합니다.
-- 주의: 실제 금융거래가 아닌 SD종합센터 시뮬레이션용 가상 장부입니다.
-- 적용: Supabase SQL Editor에서 이 파일 전체를 실행하세요.

begin;

create or replace function public.admin_debit_sd_wallet(
  p_target_user_id uuid,
  p_amount bigint,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid := auth.uid();
  v_admin_role text;
  v_admin_status text;
  v_target_nickname text;
  v_target_role text;
  v_target_status text;
  v_wallet_id uuid;
  v_balance_before bigint;
  v_balance_after bigint;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if v_admin_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select role, status
    into v_admin_role, v_admin_status
  from public.profiles
  where id = v_admin_id;

  if v_admin_role <> 'admin' or v_admin_status <> 'active' then
    raise exception '관리자 권한이 필요합니다.';
  end if;

  if p_target_user_id is null then
    raise exception '차감할 회원을 선택하세요.';
  end if;

  if p_target_user_id = v_admin_id then
    raise exception '관리자 본인 잔액은 이 기능으로 차감할 수 없습니다.';
  end if;

  if p_amount is null or p_amount < 1 or p_amount > 1000000000 then
    raise exception '차감 금액은 1원 이상 10억원 이하만 가능합니다.';
  end if;

  if v_note is not null and char_length(v_note) > 80 then
    raise exception '메모는 80자 이하로 입력하세요.';
  end if;

  select p.nickname, p.role, p.status, w.id, w.balance
    into v_target_nickname, v_target_role, v_target_status, v_wallet_id, v_balance_before
  from public.profiles p
  join public.wallets w on w.user_id = p.id
  where p.id = p_target_user_id
  for update of w;

  if v_wallet_id is null then
    raise exception '회원 가상지갑을 찾지 못했습니다.';
  end if;

  if v_target_role = 'admin' then
    raise exception '다른 관리자 계정의 잔액은 차감할 수 없습니다.';
  end if;

  if v_target_status <> 'active' then
    raise exception '현재 활성 상태가 아닌 회원입니다.';
  end if;

  if v_balance_before < p_amount then
    raise exception '현재 잔액보다 많이 차감할 수 없습니다. 현재 잔액: %원', v_balance_before;
  end if;

  v_balance_after := v_balance_before - p_amount;

  update public.wallets
  set balance = v_balance_after
  where id = v_wallet_id;

  insert into public.transactions (
    wallet_id,
    user_id,
    transaction_type,
    description,
    amount,
    balance_before,
    balance_after,
    platform,
    metadata
  ) values (
    v_wallet_id,
    p_target_user_id,
    'admin_debit',
    case
      when v_note is null then '관리자 가상잔액 차감'
      else '관리자 가상잔액 차감 · ' || v_note
    end,
    -p_amount,
    v_balance_before,
    v_balance_after,
    'admin',
    jsonb_build_object(
      'admin_user_id', v_admin_id,
      'reason', coalesce(v_note, '잘못 지급된 가상잔액 회수')
    )
  );

  return jsonb_build_object(
    'ok', true,
    'user_id', p_target_user_id,
    'nickname', v_target_nickname,
    'amount', p_amount,
    'balance_before', v_balance_before,
    'balance_after', v_balance_after,
    'message', '회원 가상잔액을 차감했습니다.'
  );
end;
$$;

revoke all on function public.admin_debit_sd_wallet(uuid, bigint, text)
  from public, anon;

grant execute on function public.admin_debit_sd_wallet(uuid, bigint, text)
  to authenticated;

commit;

-- 설치 확인: 결과가 1줄이면 함수가 설치된 것입니다.
select
  routine_schema,
  routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'admin_debit_sd_wallet';
