\set ON_ERROR_STOP on
create schema auth;
create schema private;
create role anon nologin;
create role authenticated nologin;
grant usage on schema public,auth to authenticated,anon;

create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant execute on function auth.uid() to authenticated;

create table auth.users(id uuid primary key);
create table public.profiles(
 id uuid primary key references auth.users(id),nickname text not null,role text not null default 'user',status text not null default 'active',created_at timestamptz not null default now()
);
create table public.wallets(
 id uuid primary key default gen_random_uuid(),user_id uuid not null unique references auth.users(id),account_number text not null unique,balance bigint not null default 0,created_at timestamptz not null default now()
);
create sequence public.transactions_sync_seq_seq;
create table public.transactions(
 id uuid primary key default gen_random_uuid(),wallet_id uuid not null references public.wallets(id),user_id uuid not null references auth.users(id),transaction_type text not null,description text not null,amount bigint not null,balance_before bigint not null,balance_after bigint not null,request_id uuid unique,platform text not null,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),sync_seq bigint not null default nextval('public.transactions_sync_seq_seq')
);
create table public.sd_achievements(code text primary key,name text not null,active boolean not null default true);
create table public.sd_achievement_progress(
 user_id uuid not null references auth.users(id),achievement_id text not null,current_value numeric not null default 0,unlocked boolean not null default false,unlocked_at timestamptz,source_app text not null default 'unknown',metadata jsonb not null default '{}'::jsonb,updated_at timestamptz not null default now(),constraint sd_achievement_progress_pkey primary key(user_id,achievement_id)
);
insert into public.sd_achievements(code,name,active) values('ranking-01','Season 0 1위',true);

create function private.upsert_sd_authoritative_achievement(p_user_id uuid,p_achievement_id text,p_server_value numeric,p_target numeric,p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v numeric:=greatest(0,coalesce(p_server_value,0)); t numeric:=greatest(0,coalesce(p_target,0));
begin
 insert into public.sd_achievement_progress as p(user_id,achievement_id,current_value,unlocked,unlocked_at,source_app,metadata,updated_at)
 values(p_user_id,p_achievement_id,v,v>=t,case when v>=t then now() end,'server-authority',coalesce(p_metadata,'{}'::jsonb),now())
 on conflict on constraint sd_achievement_progress_pkey do update set current_value=greatest(p.current_value,excluded.current_value),unlocked=p.unlocked or excluded.unlocked,unlocked_at=coalesce(p.unlocked_at,excluded.unlocked_at),metadata=coalesce(p.metadata,'{}'::jsonb)||excluded.metadata,updated_at=now();
end $$;
revoke all on function private.upsert_sd_authoritative_achievement(uuid,text,numeric,numeric,jsonb) from public,anon,authenticated;
