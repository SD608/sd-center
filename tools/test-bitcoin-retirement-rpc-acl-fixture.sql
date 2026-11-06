-- ISOLATED CI FIXTURE ONLY; never run on production.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE TABLE public.qa_asset_probe (id integer primary key, btc numeric, wallet bigint, gpu integer);

-- Minimal server-authority history fixture (not an operating database copy).
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.sd_bitcoin_accounts (
 user_id uuid PRIMARY KEY, btc_balance numeric NOT NULL DEFAULT 0,
 max_btc_balance numeric DEFAULT 0, total_mined_btc numeric DEFAULT 0,
 total_sold_btc numeric DEFAULT 0, total_sales_krw bigint DEFAULT 0,
 electricity_status text DEFAULT 'active', electricity_debt_krw bigint DEFAULT 0,
 last_billed_utc_date date, unpaid_utc_date date, updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.sd_bitcoin_rooms (
 user_id uuid NOT NULL, room_key text NOT NULL, owned boolean DEFAULT false,
 frames integer DEFAULT 0, mined_btc numeric DEFAULT 0, PRIMARY KEY(user_id,room_key)
);
CREATE TABLE public.sd_bitcoin_gpu_units (
 user_id uuid NOT NULL, room_key text NOT NULL, slot_index integer NOT NULL,
 durability integer DEFAULT 100,PRIMARY KEY(user_id,room_key,slot_index)
);
INSERT INTO public.sd_bitcoin_accounts(user_id,btc_balance,max_btc_balance,total_mined_btc)
 VALUES ('00000000-0000-0000-0000-000000000001',126.85000000,126.85000000,126.85000000);
INSERT INTO public.sd_bitcoin_rooms(user_id,room_key,owned,frames)
 VALUES ('00000000-0000-0000-0000-000000000001','A',true,3);
INSERT INTO public.sd_bitcoin_gpu_units(user_id,room_key,slot_index,durability)
 VALUES ('00000000-0000-0000-0000-000000000001','A',1,100);

INSERT INTO public.qa_asset_probe VALUES (1,126.85000000,9000,75);
CREATE FUNCTION public.sd_bitcoin_tick(uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.sd_bitcoin_buy_room(text,uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.sd_bitcoin_buy_frame(text,uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.sd_bitcoin_buy_gpu(text,uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.sd_bitcoin_sell(numeric,uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.sd_bitcoin_reactivate_electricity(uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.upsert_sd_bitcoin_snapshot(text,numeric,text,timestamptz) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.sd_bitcoin_get_state() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.get_sd_bitcoin_snapshot() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
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
