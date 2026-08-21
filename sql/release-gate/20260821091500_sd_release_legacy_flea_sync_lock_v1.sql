begin;

-- v0.24 cutover: legacy PC flea inventory sync endpoints remain as compatibility
-- surfaces only. Client-submitted inventory/value/logistics state is never persisted.
create or replace function public.sync_sd_flea_pc_inventory(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_status text;
  v_ids jsonb:='[]'::jsonb;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  select status into v_status from public.profiles where id=v_user;
  if coalesce(v_status,'')<>'active' then raise exception using errcode='P1002',message='ACCOUNT_INACTIVE'; end if;
  if p_items is null then p_items:='[]'::jsonb; end if;
  if pg_catalog.jsonb_typeof(p_items)<>'array' then raise exception using errcode='P1027',message='INVALID_FLEA_ITEMS'; end if;
  if pg_catalog.jsonb_array_length(p_items)>5000 then raise exception using errcode='P1027',message='TOO_MANY_FLEA_ITEMS'; end if;
  select coalesce(pg_catalog.jsonb_agg(left(trim(coalesce(e->>'local_item_id','')),120)) filter(where trim(coalesce(e->>'local_item_id',''))<>''),'[]'::jsonb)
    into v_ids from pg_catalog.jsonb_array_elements(p_items) e;
  return pg_catalog.jsonb_build_object(
    'ok',true,'synced_count',0,'owned_local_item_ids',coalesce(v_ids,'[]'::jsonb),
    'ignored_client_inventory',true,'authority','server','deprecated',true
  );
end;
$$;
revoke execute on function public.sync_sd_flea_pc_inventory(jsonb) from public,anon;
grant execute on function public.sync_sd_flea_pc_inventory(jsonb) to authenticated;

create or replace function public.sync_sd_flea_pc_inventory_by_device(
  p_user_id uuid,p_device_key text,p_items jsonb,p_logistics_rep bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_device uuid;
  v_status text;
  v_ids jsonb:='[]'::jsonb;
  v_rep bigint:=0;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  if p_user_id is null or p_user_id is distinct from v_user then raise exception using errcode='P1005',message='USER_MISMATCH'; end if;
  p_device_key:=lower(trim(coalesce(p_device_key,'')));
  if p_device_key !~ '^[0-9a-f]{64}$' then raise exception using errcode='P1019',message='INVALID_DEVICE_KEY'; end if;
  select d.id into v_device from public.devices d
   where d.user_id=v_user and d.device_key=p_device_key and d.platform='windows'
     and d.revoked_at is null and coalesce(d.link_status,'active')='active' limit 1;
  if v_device is null then raise exception using errcode='P1003',message='DEVICE_NOT_FOUND'; end if;
  select status into v_status from public.profiles where id=v_user;
  if coalesce(v_status,'')<>'active' then raise exception using errcode='P1002',message='ACCOUNT_INACTIVE'; end if;
  if p_items is null then p_items:='[]'::jsonb; end if;
  if pg_catalog.jsonb_typeof(p_items)<>'array' then raise exception using errcode='P1027',message='INVALID_FLEA_ITEMS'; end if;
  if pg_catalog.jsonb_array_length(p_items)>5000 then raise exception using errcode='P1027',message='TOO_MANY_FLEA_ITEMS'; end if;
  select coalesce(pg_catalog.jsonb_agg(left(trim(coalesce(e->>'local_item_id','')),120)) filter(where trim(coalesce(e->>'local_item_id',''))<>''),'[]'::jsonb)
    into v_ids from pg_catalog.jsonb_array_elements(p_items) e;
  if to_regclass('public.sd_logistics_accounts') is not null then
    select coalesce(a.logistics_rep,0) into v_rep from public.sd_logistics_accounts a where a.user_id=v_user;
  end if;
  return pg_catalog.jsonb_build_object(
    'ok',true,'synced_count',0,'owned_local_item_ids',coalesce(v_ids,'[]'::jsonb),
    'logistics_rep',coalesce(v_rep,0),'device_verified',true,
    'ignored_client_inventory',true,'ignored_client_logistics_rep',p_logistics_rep is not null,
    'authority','server','deprecated',true
  );
end;
$$;
revoke execute on function public.sync_sd_flea_pc_inventory_by_device(uuid,text,jsonb,bigint) from public,anon;
grant execute on function public.sync_sd_flea_pc_inventory_by_device(uuid,text,jsonb,bigint) to authenticated;

comment on function public.sync_sd_flea_pc_inventory(jsonb) is 'Legacy compatibility readback/no-op. Client PC inventory values are not persisted after v0.24 Core cutover.';
comment on function public.sync_sd_flea_pc_inventory_by_device(uuid,text,jsonb,bigint) is 'Legacy authenticated compatibility readback/no-op. Requires own active device; client inventory and logistics_rep are ignored.';

commit;
