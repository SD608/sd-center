-- SD Core trusted server wallet delta helper v1

begin;

create table if not exists public.sd_core_server_wallet_events (
  event_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_app text not null check (char_length(source_app) between 1 and 80),
  event_key text not null check (char_length(event_key) between 1 and 120),
  amount bigint not null check (amount <> 0 and abs(amount) <= 1000000000000),
  transaction_id uuid null unique references public.transactions(id) on delete restrict,
  result jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(result)='object'),
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

alter table public.sd_core_server_wallet_events enable row level security;
drop policy if exists sd_core_server_wallet_events_select_own on public.sd_core_server_wallet_events;
create policy sd_core_server_wallet_events_select_own
  on public.sd_core_server_wallet_events for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.sd_core_server_wallet_events from anon;
revoke insert,update,delete on public.sd_core_server_wallet_events from authenticated;
grant select on public.sd_core_server_wallet_events to authenticated;

create or replace function sd_core_private.apply_server_wallet_delta_impl(
  p_user_id uuid,
  p_event_id uuid,
  p_event_key text,
  p_amount bigint,
  p_source_app text,
  p_description text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event public.sd_core_server_wallet_events%rowtype;
  v_inserted uuid;
  v_status text;
  v_wallet_id uuid;
  v_before bigint;
  v_after bigint;
  v_tx uuid;
  v_seq bigint;
begin
  if p_user_id is null or p_event_id is null then
    raise exception using errcode='P1007', message='INVALID_SERVER_EVENT';
  end if;
  p_event_key := lower(trim(coalesce(p_event_key,'')));
  p_source_app := lower(trim(coalesce(p_source_app,'')));
  p_description := left(trim(coalesce(p_description,'')),160);
  p_metadata := coalesce(p_metadata,'{}'::jsonb);
  if char_length(p_event_key)<1 or char_length(p_event_key)>120 then
    raise exception using errcode='P1010', message='INVALID_SERVER_EVENT_KEY';
  end if;
  if char_length(p_source_app)<1 or char_length(p_source_app)>80 then
    raise exception using errcode='P1023', message='INVALID_SOURCE_APP';
  end if;
  if p_amount is null or p_amount=0 or abs(p_amount)>1000000000000 then
    raise exception using errcode='P1011', message='INVALID_AMOUNT';
  end if;
  if pg_catalog.jsonb_typeof(p_metadata)<>'object' then
    raise exception using errcode='P1026', message='INVALID_METADATA';
  end if;

  insert into public.sd_core_server_wallet_events(event_id,user_id,source_app,event_key,amount)
  values(p_event_id,p_user_id,p_source_app,p_event_key,p_amount)
  on conflict do nothing
  returning event_id into v_inserted;

  if v_inserted is null then
    select * into v_event
    from public.sd_core_server_wallet_events
    where event_id=p_event_id;
    if v_event.user_id is distinct from p_user_id
       or v_event.source_app is distinct from p_source_app
       or v_event.event_key is distinct from p_event_key
       or v_event.amount is distinct from p_amount then
      raise exception using errcode='P1015', message='SERVER_EVENT_IDEMPOTENCY_CONFLICT';
    end if;
    if v_event.transaction_id is null then
      raise exception using errcode='P1031', message='SERVER_EVENT_INCOMPLETE';
    end if;
    select t.sync_seq,t.balance_after into v_seq,v_after
    from public.transactions t where t.id=v_event.transaction_id;
    return pg_catalog.jsonb_build_object(
      'ok',true,'duplicate',true,'event_id',p_event_id,
      'transaction_id',v_event.transaction_id,'sync_seq',v_seq,
      'balance_after',v_after,'amount',p_amount
    );
  end if;

  select p.status,w.id,w.balance
    into v_status,v_wallet_id,v_before
  from public.profiles p
  join public.wallets w on w.user_id=p.id
  where p.id=p_user_id
  for update of w;

  if v_wallet_id is null then raise exception using errcode='P1016',message='WALLET_NOT_FOUND'; end if;
  if v_status<>'active' then raise exception using errcode='P1002',message='ACCOUNT_INACTIVE'; end if;

  v_after := v_before+p_amount;
  if v_after<0 then raise exception using errcode='P1013',message='INSUFFICIENT_FUNDS'; end if;

  insert into public.transactions(
    wallet_id,user_id,transaction_type,description,amount,
    balance_before,balance_after,request_id,platform,metadata
  ) values(
    v_wallet_id,p_user_id,'sd_server_'||p_event_key,
    coalesce(nullif(p_description,''),'SD 서버 거래'),p_amount,
    v_before,v_after,p_event_id,'server',
    p_metadata || pg_catalog.jsonb_build_object(
      'source_app',p_source_app,'server_event_id',p_event_id,'server_event_key',p_event_key
    )
  ) returning id,sync_seq into v_tx,v_seq;

  update public.wallets set balance=v_after,updated_at=now() where id=v_wallet_id;
  update public.sd_core_server_wallet_events
     set transaction_id=v_tx,
         result=pg_catalog.jsonb_build_object('balance_before',v_before,'balance_after',v_after,'sync_seq',v_seq),
         completed_at=now()
   where event_id=p_event_id;

  return pg_catalog.jsonb_build_object(
    'ok',true,'duplicate',false,'event_id',p_event_id,
    'transaction_id',v_tx,'sync_seq',v_seq,'balance_before',v_before,
    'balance_after',v_after,'amount',p_amount
  );
end;
$$;
revoke all on function sd_core_private.apply_server_wallet_delta_impl(uuid,uuid,text,bigint,text,text,jsonb)
  from public,anon,authenticated;

commit;
