-- SD608 PC 필수 업데이트 서버 차단
-- 목적: 일반 회원이 구 SD종합센터/구 SD Link/구 물류센터로 만든 PC 거래를 서버에 반영하지 못하게 합니다.
-- 관리자(profiles.role='admin' AND status='active')는 테스트를 위해 예외입니다.
-- 적용 위치: Supabase Dashboard -> SQL Editor -> 전체 실행

begin;

create or replace function public.sd_client_semver_number(p_value text)
returns bigint
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_match text[];
begin
  v_match := regexp_match(coalesce(p_value, ''), '([0-9]+)\.([0-9]+)\.([0-9]+)');
  if v_match is null then
    return 0;
  end if;
  return v_match[1]::bigint * 1000000000
       + v_match[2]::bigint * 1000000
       + v_match[3]::bigint;
exception when others then
  return 0;
end;
$$;

create or replace function public.enforce_sd_pc_required_versions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_status text;
  v_sdlink_version text;
  v_center_version text;
  v_local_id text;
  v_logistics_match text[];
begin
  if new.platform is distinct from 'windows'
     or new.transaction_type not in ('sd_link_local_deposit', 'sd_link_local_withdraw') then
    return new;
  end if;

  select p.role, p.status
    into v_role, v_status
  from public.profiles p
  where p.id = new.user_id;

  if v_role = 'admin' and v_status = 'active' then
    return new;
  end if;

  v_sdlink_version := coalesce(new.metadata ->> 'sd_link_version', '0.0.0');
  v_center_version := coalesce(new.metadata ->> 'center_version', '0.0.0');
  v_local_id := coalesce(new.metadata ->> 'sd_link_local_transaction_id', '');

  if public.sd_client_semver_number(v_sdlink_version)
       < public.sd_client_semver_number('1.2.4') then
    raise exception using
      errcode = 'P0001',
      message = '필수 업데이트: SD Link v1.2.4 이상이 필요합니다. 홈페이지에서 SD종합센터 v2.1.2를 설치하세요.';
  end if;

  if public.sd_client_semver_number(v_center_version)
       < public.sd_client_semver_number('2.1.2') then
    raise exception using
      errcode = 'P0001',
      message = '필수 업데이트: SD종합센터 v2.1.2 이상이 필요합니다. 구 센터에서는 PC 거래를 동기화할 수 없습니다.';
  end if;

  if v_local_id like 'sdlogistics-%' then
    v_logistics_match := regexp_match(
      v_local_id,
      '^sdlogistics-c([0-9]+\.[0-9]+\.[0-9]+)-v([0-9]+\.[0-9]+\.[0-9]+)-'
    );

    if v_logistics_match is null then
      raise exception using
        errcode = 'P0001',
        message = '필수 업데이트: SD 물류센터 v1.0.7 이상이 필요합니다. 구 물류센터 수익은 서버에 반영되지 않습니다.';
    end if;

    if public.sd_client_semver_number(v_logistics_match[1])
         < public.sd_client_semver_number('2.1.2') then
      raise exception using
        errcode = 'P0001',
        message = '필수 업데이트: SD 물류센터를 SD종합센터 v2.1.2 이상에서 실행해야 합니다.';
    end if;

    if public.sd_client_semver_number(v_logistics_match[2])
         < public.sd_client_semver_number('1.0.7') then
      raise exception using
        errcode = 'P0001',
        message = '필수 업데이트: SD 물류센터 v1.0.7 이상이 필요합니다.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_sd_pc_required_versions on public.transactions;
create trigger trg_enforce_sd_pc_required_versions
before insert on public.transactions
for each row
execute function public.enforce_sd_pc_required_versions();

revoke all on function public.sd_client_semver_number(text) from public, anon;
grant execute on function public.sd_client_semver_number(text) to authenticated;
revoke all on function public.enforce_sd_pc_required_versions() from public, anon, authenticated;

commit;

select
  trigger_name,
  event_manipulation,
  action_timing
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'transactions'
  and trigger_name = 'trg_enforce_sd_pc_required_versions';
