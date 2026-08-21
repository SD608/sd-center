begin;

-- SD Core production cutover closes new legacy PC wallet migration claims.
-- Existing historical migration rows and completed user assets are preserved unchanged.
create or replace function public.request_sd_wallet_migration(
  p_local_wallet_fingerprint text,
  p_previous_account_number text,
  p_local_username text,
  p_local_owner_name text,
  p_migrated_balance bigint,
  p_source_summary jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_existing public.wallet_migrations%rowtype;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  p_local_wallet_fingerprint:=lower(trim(coalesce(p_local_wallet_fingerprint,'')));
  if p_local_wallet_fingerprint !~ '^[0-9a-f]{64}$' then raise exception using errcode='P1019',message='INVALID_WALLET_FINGERPRINT'; end if;
  select * into v_existing from public.wallet_migrations
   where user_id=v_user or local_wallet_fingerprint=p_local_wallet_fingerprint
   order by case when user_id=v_user then 0 else 1 end limit 1;
  if found then
    if v_existing.user_id is distinct from v_user then raise exception using errcode='P1005',message='WALLET_MIGRATION_OWNER_MISMATCH'; end if;
    return pg_catalog.jsonb_build_object(
      'ok',true,'migration_id',v_existing.id,'status',v_existing.status,
      'migrated_balance',v_existing.migrated_balance,'cutover_closed',true,
      'message','기존 지갑 이전 상태를 확인했습니다.'
    );
  end if;
  raise exception using errcode='P1030',message='WALLET_MIGRATION_CLOSED';
end;
$$;
revoke execute on function public.request_sd_wallet_migration(text,text,text,text,bigint,jsonb) from public,anon;
grant execute on function public.request_sd_wallet_migration(text,text,text,text,bigint,jsonb) to authenticated;

create or replace function public.admin_approve_sd_wallet_migration(p_migration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_admin uuid:=auth.uid();
  v_status text;
  v_balance bigint;
begin
  if v_admin is null or not exists(
    select 1 from public.profiles p where p.id=v_admin and p.role='admin' and p.status='active'
  ) then raise exception using errcode='P1005',message='ADMIN_REQUIRED'; end if;
  select m.status,w.balance into v_status,v_balance
    from public.wallet_migrations m join public.wallets w on w.id=m.wallet_id
   where m.id=p_migration_id;
  if v_status is null then raise exception using errcode='P1027',message='WALLET_MIGRATION_NOT_FOUND'; end if;
  if v_status='completed' then
    return pg_catalog.jsonb_build_object('ok',true,'status','completed','duplicate',true,'balance_after',v_balance,'cutover_closed',true);
  end if;
  raise exception using errcode='P1030',message='WALLET_MIGRATION_CLOSED';
end;
$$;
revoke execute on function public.admin_approve_sd_wallet_migration(uuid) from public,anon;
grant execute on function public.admin_approve_sd_wallet_migration(uuid) to authenticated;

comment on function public.request_sd_wallet_migration(text,text,text,text,bigint,jsonb) is 'Legacy cutover status/readback only. New client-submitted wallet migration claims are closed after SD Core production cutover.';
comment on function public.admin_approve_sd_wallet_migration(uuid) is 'Legacy cutover readback only. No post-cutover migration can credit a wallet.';

commit;
