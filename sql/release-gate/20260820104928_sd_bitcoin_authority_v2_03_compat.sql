begin;

create or replace function public.upsert_sd_bitcoin_snapshot(
  p_device_key text,
  p_btc_quantity numeric,
  p_source_hint text default null,
  p_local_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid();
  v_device uuid;
  a public.sd_bitcoin_accounts%rowtype;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  p_device_key:=lower(trim(coalesce(p_device_key,'')));
  select d.id into v_device from public.devices d
   where d.user_id=v_user and lower(d.device_key)=p_device_key and d.platform='windows'
     and d.revoked_at is null and coalesce(d.link_status,'active')='active' limit 1;
  if v_device is null then raise exception using errcode='P1032',message='BITCOIN_DEVICE_NOT_REGISTERED'; end if;
  perform private.sd_bitcoin_ensure_account(v_user);
  select * into a from public.sd_bitcoin_accounts where user_id=v_user;
  return jsonb_build_object(
    'ok',true,'btc_quantity',a.btc_balance,'synced_at',now(),'authority','server',
    'ignored_client_quantity',true,'legacy_submitted_quantity',round(greatest(0,coalesce(p_btc_quantity,0)),8)
  );
end;
$$;

create or replace function public.get_sd_bitcoin_snapshot()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid();
  a public.sd_bitcoin_accounts%rowtype;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  perform private.sd_bitcoin_ensure_account(v_user);
  select * into a from public.sd_bitcoin_accounts where user_id=v_user;
  return jsonb_build_object(
    'available',true,'btc_quantity',a.btc_balance,'synced_at',a.updated_at,
    'local_updated_at',null,'source_hint','SD Core Bitcoin Authority',
    'notice','BTC 잔액은 SD Core 서버 상태를 기준으로 합니다.','authority','server'
  );
end;
$$;

revoke execute on function public.upsert_sd_bitcoin_snapshot(text,numeric,text,timestamptz) from public,anon;
revoke execute on function public.get_sd_bitcoin_snapshot() from public,anon;
grant execute on function public.upsert_sd_bitcoin_snapshot(text,numeric,text,timestamptz) to authenticated;
grant execute on function public.get_sd_bitcoin_snapshot() to authenticated;

commit;