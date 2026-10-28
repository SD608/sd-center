-- SD광부 Server Run Authority A / disposable PostgreSQL QA ONLY
-- This is NOT an installable production migration. Never run on SD608-Online.
-- Source, exit and device truth are injected by privileged fixtures, NOT verified here.
BEGIN;
DO $roles$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='miner_a_engine_qa') THEN
    CREATE ROLE miner_a_engine_qa NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='miner_a_client_qa') THEN
    CREATE ROLE miner_a_client_qa NOLOGIN;
  END IF;
END $roles$;
CREATE SCHEMA miner_a_sandbox;
REVOKE ALL ON SCHEMA miner_a_sandbox FROM PUBLIC;
GRANT USAGE ON SCHEMA miner_a_sandbox TO miner_a_engine_qa;
CREATE TABLE miner_a_sandbox.classes(
  class_id text PRIMARY KEY, points integer NOT NULL CHECK(points BETWEEN 0 AND 24)
);
INSERT INTO miner_a_sandbox.classes VALUES
 ('ore1',1),('ore2',2),('ore3',4),('ore4',8),('ore5',16),
 ('small_regular',2),('small_rare',6),('medium_regular',3),('medium_rare',9),
 ('large_regular',4),('large_rare',12),('elite_regular',6),('elite_rare',18),
 ('midboss_regular',8),('midboss_rare',24),
 ('abister_scale',6),('abister_spine',8),('abister_membrane',10),
 ('abister_armor',12),('abister_plate',24),('story_core',0);
CREATE TABLE miner_a_sandbox.runs(
 run_id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'ACTIVE'
 CHECK(status IN ('ACTIVE','CLOSED'))
);
CREATE TABLE miner_a_sandbox.players(
 run_id uuid NOT NULL REFERENCES miner_a_sandbox.runs(run_id),
 player_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DEAD','RETURNED')),
 exit_verified boolean NOT NULL DEFAULT false, shipping_known boolean NOT NULL DEFAULT true,
 PRIMARY KEY(run_id,player_id)
);
CREATE TABLE miner_a_sandbox.sources(
 run_id uuid NOT NULL REFERENCES miner_a_sandbox.runs(run_id),
 source_id uuid NOT NULL, class_id text NOT NULL REFERENCES miner_a_sandbox.classes(class_id),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100000),
 claimed_by_event uuid,
 PRIMARY KEY(run_id,source_id),
 UNIQUE(claimed_by_event)
);
CREATE TABLE miner_a_sandbox.lots(
 event_id uuid PRIMARY KEY, run_id uuid NOT NULL, player_id uuid NOT NULL,
 source_id uuid NOT NULL, class_id text NOT NULL REFERENCES miner_a_sandbox.classes(class_id),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100000),
 shipped integer NOT NULL DEFAULT 0 CHECK(shipped >= 0 AND shipped <= quantity),
 FOREIGN KEY(run_id,player_id) REFERENCES miner_a_sandbox.players(run_id,player_id),
 FOREIGN KEY(run_id,source_id) REFERENCES miner_a_sandbox.sources(run_id,source_id),
 UNIQUE(run_id,source_id)
);
CREATE TABLE miner_a_sandbox.shipments(
 shipment_id uuid PRIMARY KEY, run_id uuid NOT NULL, player_id uuid NOT NULL,
 lot_event uuid NOT NULL REFERENCES miner_a_sandbox.lots(event_id),
 quantity integer NOT NULL CHECK(quantity > 0),
 FOREIGN KEY(run_id,player_id) REFERENCES miner_a_sandbox.players(run_id,player_id)
);
CREATE TABLE miner_a_sandbox.settlements(
 run_id uuid NOT NULL, player_id uuid NOT NULL,
 return_event uuid NOT NULL UNIQUE,
 version text NOT NULL DEFAULT 'v0.9-TEST-ONLY',
 score bigint NOT NULL CHECK(score>=0), coins integer NOT NULL CHECK(coins BETWEEN 0 AND 8),
 bag_snapshot jsonb NOT NULL CHECK(jsonb_typeof(bag_snapshot)='array'),
 PRIMARY KEY(run_id,player_id),
 FOREIGN KEY(run_id,player_id) REFERENCES miner_a_sandbox.players(run_id,player_id)
);
CREATE TABLE miner_a_sandbox.ledger(
 return_event uuid PRIMARY KEY REFERENCES miner_a_sandbox.settlements(return_event),
 run_id uuid NOT NULL, player_id uuid NOT NULL,
 delta integer NOT NULL CHECK(delta BETWEEN 0 AND 8),
 UNIQUE(run_id,player_id)
);
CREATE TABLE miner_a_sandbox.balances(
 player_id uuid PRIMARY KEY, test_coins bigint NOT NULL DEFAULT 0 CHECK(test_coins>=0)
);
REVOKE ALL ON ALL TABLES IN SCHEMA miner_a_sandbox FROM PUBLIC;

CREATE FUNCTION miner_a_sandbox.trial_coins(s bigint)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $fn$
BEGIN
 IF s IS NULL OR s<0 THEN RAISE EXCEPTION 'INVALID_SCORE'; END IF;
 RETURN CASE WHEN s>=450 THEN 8 WHEN s>=360 THEN 7 WHEN s>=280 THEN 6
 WHEN s>=210 THEN 5 WHEN s>=150 THEN 4 WHEN s>=100 THEN 3 WHEN s>=60 THEN 2
 WHEN s>=30 THEN 1 ELSE 0 END;
END $fn$;

CREATE FUNCTION miner_a_sandbox.trusted_claim(r uuid,p uuid,e uuid,s uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE m miner_a_sandbox.players%ROWTYPE;
 old miner_a_sandbox.lots%ROWTYPE; src miner_a_sandbox.sources%ROWTYPE;
BEGIN
 IF r IS NULL OR p IS NULL OR e IS NULL OR s IS NULL THEN RAISE EXCEPTION 'BAD_REQUEST'; END IF;
 SELECT * INTO m FROM miner_a_sandbox.players
  WHERE run_id=r AND player_id=p FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_MEMBER'; END IF;
 SELECT * INTO old FROM miner_a_sandbox.lots WHERE event_id=e;
 IF FOUND THEN
   IF old.run_id=r AND old.player_id=p AND old.source_id=s
   THEN RETURN jsonb_build_object('replay',true,'quantity',old.quantity); END IF;
   RAISE EXCEPTION 'EVENT_ID_CONFLICT';
 END IF;
 IF m.status<>'ACTIVE' THEN RAISE EXCEPTION 'PLAYER_NOT_ACTIVE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM miner_a_sandbox.runs WHERE run_id=r AND status='ACTIVE')
 THEN RAISE EXCEPTION 'RUN_NOT_ACTIVE'; END IF;
 SELECT * INTO src FROM miner_a_sandbox.sources
  WHERE run_id=r AND source_id=s FOR UPDATE;
 IF NOT FOUND OR src.claimed_by_event IS NOT NULL THEN RAISE EXCEPTION 'SOURCE_USED_OR_MISSING'; END IF;
 INSERT INTO miner_a_sandbox.lots(event_id,run_id,player_id,source_id,class_id,quantity)
 VALUES(e,r,p,s,src.class_id,src.quantity);
 UPDATE miner_a_sandbox.sources SET claimed_by_event=e WHERE run_id=r AND source_id=s;
 RETURN jsonb_build_object('replay',false,'quantity',src.quantity);
END $fn$;

CREATE FUNCTION miner_a_sandbox.trusted_ship(r uuid,p uuid,e uuid,lot_id uuid,n integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE m miner_a_sandbox.players%ROWTYPE;
 old miner_a_sandbox.shipments%ROWTYPE; lot miner_a_sandbox.lots%ROWTYPE;
BEGIN
 IF r IS NULL OR p IS NULL OR e IS NULL OR lot_id IS NULL OR n IS NULL OR n<=0
 THEN RAISE EXCEPTION 'BAD_REQUEST'; END IF;
 SELECT * INTO m FROM miner_a_sandbox.players WHERE run_id=r AND player_id=p FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_MEMBER'; END IF;
 SELECT * INTO old FROM miner_a_sandbox.shipments WHERE shipment_id=e;
 IF FOUND THEN
  IF old.run_id=r AND old.player_id=p AND old.lot_event=lot_id AND old.quantity=n
  THEN RETURN jsonb_build_object('replay',true); END IF;
  RAISE EXCEPTION 'SHIPMENT_EVENT_CONFLICT';
 END IF;
 IF m.status<>'ACTIVE' OR NOT m.shipping_known THEN RAISE EXCEPTION 'SHIPMENT_BLOCKED'; END IF;
 SELECT * INTO lot FROM miner_a_sandbox.lots
 WHERE event_id=lot_id AND run_id=r AND player_id=p FOR UPDATE;
 IF NOT FOUND OR lot.quantity-lot.shipped<n THEN RAISE EXCEPTION 'NOT_OWNER_OR_INSUFFICIENT'; END IF;
 UPDATE miner_a_sandbox.lots SET shipped=shipped+n WHERE event_id=lot_id;
 INSERT INTO miner_a_sandbox.shipments(shipment_id,run_id,player_id,lot_event,quantity)
 VALUES(e,r,p,lot_id,n);
 RETURN jsonb_build_object('replay',false);
END $fn$;

CREATE FUNCTION miner_a_sandbox.trusted_settle(r uuid,p uuid,e uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE m miner_a_sandbox.players%ROWTYPE;
 old miner_a_sandbox.settlements%ROWTYPE;
 value bigint;award integer;items jsonb;
BEGIN
 IF r IS NULL OR p IS NULL OR e IS NULL THEN RAISE EXCEPTION 'BAD_REQUEST'; END IF;
 SELECT * INTO m FROM miner_a_sandbox.players WHERE run_id=r AND player_id=p FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_MEMBER'; END IF;
 SELECT * INTO old FROM miner_a_sandbox.settlements WHERE run_id=r AND player_id=p;
 IF FOUND THEN
  IF old.return_event=e THEN
   RETURN jsonb_build_object('replay',true,'score',old.score,'coins',old.coins);
  END IF;
  RAISE EXCEPTION 'SECOND_RETURN_DENIED';
 END IF;
 IF m.status<>'ACTIVE' OR NOT m.exit_verified OR NOT m.shipping_known THEN
  RAISE EXCEPTION 'SERVER_EXIT_AND_SHIPPING_REQUIRED';
 END IF;
 SELECT coalesce(sum((l.quantity-l.shipped)::bigint*c.points),0),
 coalesce(jsonb_agg(jsonb_build_object('source_event',l.event_id,'class',l.class_id,
 'quantity',l.quantity-l.shipped,'points',(l.quantity-l.shipped)::bigint*c.points)
 ORDER BY l.event_id) FILTER(WHERE l.quantity>l.shipped),'[]'::jsonb)
 INTO value,items FROM miner_a_sandbox.lots l JOIN miner_a_sandbox.classes c ON c.class_id=l.class_id
 WHERE l.run_id=r AND l.player_id=p;
 award:=miner_a_sandbox.trial_coins(value);
 INSERT INTO miner_a_sandbox.settlements(run_id,player_id,return_event,score,coins,bag_snapshot)
 VALUES(r,p,e,value,award,items);
 INSERT INTO miner_a_sandbox.ledger(return_event,run_id,player_id,delta)
 VALUES(e,r,p,award);
 INSERT INTO miner_a_sandbox.balances AS b(player_id,test_coins)
 VALUES(p,award) ON CONFLICT(player_id)
 DO UPDATE SET test_coins=b.test_coins+EXCLUDED.test_coins;
 UPDATE miner_a_sandbox.players SET status='RETURNED' WHERE run_id=r AND player_id=p;
 RETURN jsonb_build_object('replay',false,'score',value,'coins',award);
END $fn$;

-- All server-asserted inputs require an independently trusted engine.
-- A Unity executable / regular Supabase authenticated role NEVER gets this role.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA miner_a_sandbox FROM PUBLIC;
GRANT EXECUTE ON FUNCTION miner_a_sandbox.trusted_claim(uuid,uuid,uuid,uuid)
 TO miner_a_engine_qa;
GRANT EXECUTE ON FUNCTION miner_a_sandbox.trusted_ship(uuid,uuid,uuid,uuid,integer)
 TO miner_a_engine_qa;
GRANT EXECUTE ON FUNCTION miner_a_sandbox.trusted_settle(uuid,uuid,uuid)
 TO miner_a_engine_qa;
COMMIT;
