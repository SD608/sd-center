create or replace function public.upsert_sd_flea_gold_snapshot(p_gold_bars bigint, p_gold_grams numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_bars bigint:=0; v_grams numeric:=0;
begin
 if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 select coalesce(v.gold_bars,0),coalesce(v.gold_grams,0) into v_bars,v_grams from public.vaults v where v.user_id=v_user;
 if not found then raise exception using errcode='P1028',message='VAULT_NOT_FOUND'; end if;
 insert into public.sd_flea_gold_snapshots(user_id,gold_bars,gold_grams,updated_at) values(v_user,v_bars,v_grams,now())
 on conflict(user_id) do update set gold_bars=excluded.gold_bars,gold_grams=excluded.gold_grams,updated_at=now();
 return pg_catalog.jsonb_build_object('ok',true,'gold_bars',v_bars,'gold_grams',v_grams,'authority','server','ignored_client_values',true,'deprecated',true);
end$$;

create or replace function public.record_sd_flea_slot_result(p_score numeric,p_label text,p_icon text,p_jackpot boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); s public.sd_flea_slot_stats%rowtype;
begin
 if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 select * into s from public.sd_flea_slot_stats where user_id=v_user;
 return pg_catalog.jsonb_build_object('ok',true,'deprecated',true,'authority','server','ignored_client_values',true,'best_score',coalesce(s.best_score,0),'best_label',coalesce(s.best_label,''),'best_icon',coalesce(s.best_icon,''),'jackpot',coalesce(s.jackpot,false));
end$$;

insert into public.sd_flea_gold_snapshots(user_id,gold_bars,gold_grams,updated_at)
select v.user_id,coalesce(v.gold_bars,0),coalesce(v.gold_grams,0),now()
from public.vaults v
on conflict(user_id) do update
set gold_bars=excluded.gold_bars,gold_grams=excluded.gold_grams,updated_at=now();
