-- ISOLATED CI FIXTURE ONLY; never run on production.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE TABLE public.qa_asset_probe (id integer primary key, btc numeric, wallet bigint, gpu integer);
INSERT INTO public.qa_asset_probe VALUES (1,126.85000000,9000,75);
CREATE FUNCTION public.sd_bitcoin_tick(uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.sd_bitcoin_buy_room(text,uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.sd_bitcoin_buy_frame(text,uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.sd_bitcoin_buy_gpu(text,uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.sd_bitcoin_sell(numeric,uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.sd_bitcoin_reactivate_electricity(uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.upsert_sd_bitcoin_snapshot(text,numeric,text,timestamptz) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.sd_bitcoin_get_state() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
CREATE FUNCTION public.get_sd_bitcoin_snapshot() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
CREATE FUNCTION public.push_sd_link_transaction(text,text,text,text,bigint,timestamptz,jsonb) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
-- A purposely exposed baseline tests the exact revoke statements.
DO $$
DECLARE p text;
BEGIN
  IF NOT has_function_privilege('authenticated','public.sd_bitcoin_tick(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'test baseline not granted';
  END IF;
END $$;
