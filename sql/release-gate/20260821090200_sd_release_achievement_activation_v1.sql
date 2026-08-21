begin;

-- Final activation bridge after all 49 newly server-authoritative producers exist.
-- Existing progress/unlocks are preserved; authoritative refreshes only add/raise
-- server-validated state and never trust client-submitted achievement values.
update public.sd_achievements
   set active=true
 where code = any(array[
  'bitcoin-01','bitcoin-02','bitcoin-03','bitcoin-04','bitcoin-05',
  'miner-01','miner-02','miner-03','miner-04','miner-05','miner-06','miner-07','miner-08','miner-09',
  'mukjjippa-01','mukjjippa-02',
  'sta-01','sta-02','sta-03'
 ]::text[]);

do $$
declare r record;
begin
  for r in select user_id from public.sd_bitcoin_accounts loop
    perform private.refresh_sd_bitcoin_achievements(r.user_id);
  end loop;
  for r in select user_id from public.sd_miner_accounts loop
    perform private.refresh_sd_miner_achievements(r.user_id);
  end loop;
  for r in select user_id from public.sd_mukjjippa_accounts loop
    perform private.refresh_sd_mukjjippa_achievements(r.user_id);
  end loop;
  for r in select user_id from public.sd_sta_accounts loop
    perform private.refresh_sd_sta_achievements(r.user_id);
  end loop;
end $$;

commit;
