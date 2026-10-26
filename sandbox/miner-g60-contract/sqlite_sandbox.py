"""Isolated SQLite transaction sandbox for G60 contracts.

NOT a production Run server, official Supabase schema, auth provider, Unity endpoint
or SD Core owner ledger. All timestamps are trusted test-fixture inputs.
The exact SQL schema and method names are IMPLEMENTATION_PROPOSAL, not CANON.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager

G60_MS = 60_000
DAY_MS = 86_400_000
FLOOR_TTL_MS = 600_000


class Sandbox:
    def __init__(self, filename: str):
        self.filename = filename
        with self.tx() as cx:
            cx.executescript("""
                CREATE TABLE IF NOT EXISTS runs (
                  run_id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'OPEN',
                  deadline_ms INTEGER, grace_applied INTEGER NOT NULL DEFAULT 0,
                  delivery_unknown INTEGER NOT NULL DEFAULT 0,
                  game_ms INTEGER NOT NULL DEFAULT 0, boss_sealed INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS participants (
                  run_id TEXT NOT NULL, player_id TEXT NOT NULL,
                  status TEXT NOT NULL DEFAULT 'ACTIVE',
                  epoch INTEGER NOT NULL DEFAULT 1, revoked INTEGER NOT NULL DEFAULT 0,
                  lock_ms INTEGER, hp INTEGER NOT NULL DEFAULT 100,
                  dot_ms INTEGER NOT NULL DEFAULT 0, tick_ms INTEGER NOT NULL DEFAULT 0,
                  PRIMARY KEY (run_id, player_id)
                );
                CREATE TABLE IF NOT EXISTS assets (
                  asset_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, player_id TEXT NOT NULL,
                  container TEXT NOT NULL CHECK(container IN
                    ('EQUIPPED','CARRIED','TEMP','WORKSHOP','FLOOR','LOST')),
                  deliverable INTEGER NOT NULL DEFAULT 0,
                  floor_expiry_ms INTEGER, revision INTEGER NOT NULL DEFAULT 1
                );
                CREATE TABLE IF NOT EXISTS shipments (
                  shipment_id TEXT PRIMARY KEY, run_id TEXT NOT NULL,
                  player_id TEXT NOT NULL, item_count INTEGER NOT NULL,
                  UNIQUE(run_id, player_id)
                );
                CREATE TABLE IF NOT EXISTS requests (
                  run_id TEXT NOT NULL, player_id TEXT NOT NULL,
                  operation TEXT NOT NULL, request_id TEXT NOT NULL,
                  payload TEXT NOT NULL, outcome TEXT NOT NULL,
                  PRIMARY KEY(run_id, player_id, operation, request_id)
                );
                CREATE TABLE IF NOT EXISTS fault_events (
                  run_id TEXT NOT NULL, fault_id TEXT NOT NULL,
                  verified INTEGER NOT NULL, PRIMARY KEY(run_id, fault_id)
                );
                CREATE TABLE IF NOT EXISTS audit_events (
                  event_no INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT,
                  kind TEXT NOT NULL, subject TEXT, detail TEXT
                );
            """)

    @contextmanager
    def tx(self):
        cx = sqlite3.connect(self.filename, timeout=10, isolation_level=None)
        cx.row_factory = sqlite3.Row
        cx.execute("PRAGMA busy_timeout = 10000")
        cx.execute("BEGIN IMMEDIATE")
        try:
            yield cx
            cx.execute("COMMIT")
        except BaseException:
            cx.execute("ROLLBACK")
            raise
        finally:
            cx.close()

    @staticmethod
    def row(cx, table: str, field: str, value):
        # Only constant internal table/field names may be used.
        return cx.execute(f"SELECT * FROM {table} WHERE {field}=?", (value,)).fetchone()

    @staticmethod
    def audit(cx, run, kind, subject="", detail=""):
        cx.execute("INSERT INTO audit_events(run_id,kind,subject,detail) VALUES(?,?,?,?)",
                   (run, kind, subject, detail))

    @staticmethod
    def same_request(cx, run, player, op, request, payload):
        if not request or not isinstance(request, str):
            return "INVALID_REQUEST_ID"
        found = cx.execute(
            "SELECT payload,outcome FROM requests WHERE run_id=? AND player_id=? AND operation=? AND request_id=?",
            (run, player, op, request)).fetchone()
        if found is None:
            return None
        return found["outcome"] if found["payload"] == payload else "IDEMPOTENCY_CONFLICT"

    @staticmethod
    def remember(cx, run, player, op, request, payload, outcome):
        cx.execute("INSERT INTO requests VALUES(?,?,?,?,?,?)",
                   (run, player, op, request, payload, outcome))

    def seed_run(self, run: str, players: list[str]):
        with self.tx() as cx:
            cx.execute("INSERT INTO runs(run_id) VALUES(?)", (run,))
            for player in players:
                cx.execute("INSERT INTO participants(run_id,player_id) VALUES(?,?)", (run,player))

    def seed_asset(self, run, player, asset_id, container, deliverable=False):
        """Privileged fixture only. NOT an endpoint usable to mint items."""
        with self.tx() as cx:
            if not cx.execute("SELECT 1 FROM participants WHERE run_id=? AND player_id=?",
                              (run,player)).fetchone():
                raise ValueError("UNKNOWN_PLAYER")
            cx.execute("INSERT INTO assets(asset_id,run_id,player_id,container,deliverable) VALUES(?,?,?,?,?)",
                       (asset_id,run,player,container,int(deliverable)))

    def disconnect(self, run, player, now):
        with self.tx() as cx:
            p=cx.execute("SELECT * FROM participants WHERE run_id=? AND player_id=?",(run,player)).fetchone()
            if not p or p["status"] != "ACTIVE" or p["revoked"] or self.row(cx,"runs","run_id",run)["state"] != "OPEN":
                return "REJECTED"
            cx.execute("UPDATE participants SET status='OFFLINE', epoch=epoch+1,lock_ms=? WHERE run_id=? AND player_id=?",
                       (now+G60_MS,run,player))
            self.audit(cx,run,"OFFLINE_LOCK_PENDING",player)
            return "OFFLINE"

    @staticmethod
    def _deliver(cx, run, player):
        sid=f"{run}:{player}:g60"
        if cx.execute("SELECT 1 FROM shipments WHERE shipment_id=?", (sid,)).fetchone():
            return "DUPLICATE"
        count=cx.execute("""SELECT count(*) FROM assets WHERE run_id=? AND player_id=?
                 AND container='TEMP' AND deliverable=1""",(run,player)).fetchone()[0]
        cx.execute("INSERT INTO shipments VALUES(?,?,?,?)",(sid,run,player,count))
        cx.execute("""UPDATE assets SET container='WORKSHOP', revision=revision+1
                    WHERE run_id=? AND player_id=? AND container='TEMP' AND deliverable=1""",
                   (run,player))
        Sandbox.audit(cx,run,"SHIPMENT_COMMIT",player,sid)
        return "COMMITTED"

    def sweep(self, run, now):
        """The given time is an external trusted-fixture value, never client time."""
        with self.tx() as cx:
            state=self.row(cx,"runs","run_id",run)
            if state["state"] != "OPEN":
                return "CLOSED"
            cx.execute("""UPDATE participants SET status='LOCKED'
                WHERE run_id=? AND status='OFFLINE' AND lock_ms<=?""",(run,now))
            locked=cx.execute("SELECT player_id FROM participants WHERE run_id=? AND status='LOCKED'",
                              (run,)).fetchall()
            if not state["delivery_unknown"]:
                for entry in locked:
                    self._deliver(cx,run,entry["player_id"])
            allp=cx.execute("SELECT status,lock_ms FROM participants WHERE run_id=?",
                            (run,)).fetchall()
            if allp and all(p["status"] in ("LOCKED","DEAD","RETURNED") for p in allp) and state["deadline_ms"] is None:
                latest=max((p["lock_ms"] for p in allp if p["status"]=="LOCKED"), default=now)
                cx.execute("UPDATE runs SET deadline_ms=? WHERE run_id=?", (latest+DAY_MS,run))
                self.audit(cx,run,"PRESERVATION_START")
            return "SWEPT"

    def set_delivery_unknown(self, run, value: bool):
        """Fault injection; never a client-accessible control."""
        with self.tx() as cx:
            cx.execute("UPDATE runs SET delivery_unknown=? WHERE run_id=?", (int(value),run))

    def verify_fault_fixture(self, run, fault_id, verified=True):
        """Administrative simulation, not a verified operational fault detector."""
        with self.tx() as cx:
            cx.execute("INSERT INTO fault_events VALUES(?,?,?)",(run,fault_id,int(verified)))

    def grant_fault_grace(self, run, fault_id):
        with self.tx() as cx:
            state=self.row(cx,"runs","run_id",run)
            fault=cx.execute("SELECT verified FROM fault_events WHERE run_id=? AND fault_id=?",
                             (run,fault_id)).fetchone()
            if not fault or not fault[0] or state["state"]!="OPEN" or state["grace_applied"] or state["deadline_ms"] is None:
                return "REJECTED"
            cx.execute("UPDATE runs SET deadline_ms=deadline_ms+?,grace_applied=1 WHERE run_id=?",
                       (DAY_MS,run))
            self.audit(cx,run,"FAULT_GRACE_COMMIT",fault_id)
            return "GRANTED"

    def join(self, run, player, request, epoch, now, primary_safe=True, elevator_safe=True):
        payload=json.dumps([epoch,bool(primary_safe),bool(elevator_safe)],separators=(",",":"))
        with self.tx() as cx:
            replay=self.same_request(cx,run,player,"JOIN",request,payload)
            if replay is not None:
                return replay
            state=self.row(cx,"runs","run_id",run)
            p=cx.execute("SELECT * FROM participants WHERE run_id=? AND player_id=?",
                         (run,player)).fetchone()
            if not state or not p:
                return "NOT_AUTHORIZED"
            if state["state"]!="OPEN":
                return "RUN_CLOSED"
            if p["status"] in ("DEAD","RETURNED"):
                return "PARTICIPANT_FINISHED"
            if p["revoked"] or epoch!=p["epoch"]:
                return "FENCED"
            if state["deadline_ms"] is not None and now>=state["deadline_ms"]:
                return "EXPIRED"
            if state["delivery_unknown"]:
                return "HOLD_LEDGER"
            if not primary_safe and not elevator_safe:
                return "HOLD_LOCATION"
            if p["status"]=="ACTIVE":
                return "ALREADY_ACTIVE"
            cx.execute("UPDATE participants SET status='ACTIVE',lock_ms=NULL WHERE run_id=? AND player_id=?",
                       (run,player))
            cx.execute("UPDATE runs SET deadline_ms=NULL WHERE run_id=?", (run,))
            outcome="JOIN_COMMIT_SAVED" if primary_safe else "JOIN_COMMIT_ELEVATOR"
            self.remember(cx,run,player,"JOIN",request,payload,outcome)
            self.audit(cx,run,"JOIN_COMMIT",player,outcome)
            return outcome

    def cleanup(self, run, now):
        with self.tx() as cx:
            state=self.row(cx,"runs","run_id",run)
            if state["state"]!="OPEN":
                return "ALREADY_CLOSED"
            if state["deadline_ms"] is None or now<state["deadline_ms"]:
                return "NOT_EXPIRED"
            cx.execute("UPDATE runs SET state='CLOSED' WHERE run_id=?", (run,))
            self.audit(cx,run,"CLEANUP_COMMIT")
            return "CLEANUP_COMMIT"

    def move_asset(self, run, player, request, asset_id, container):
        """Client may move only its existing items; cannot create/alter owner."""
        payload=json.dumps([asset_id,container],separators=(",",":"))
        with self.tx() as cx:
            replay=self.same_request(cx,run,player,"MOVE",request,payload)
            if replay is not None:
                return replay
            p=cx.execute("SELECT status,revoked FROM participants WHERE run_id=? AND player_id=?",
                         (run,player)).fetchone()
            a=self.row(cx,"assets","asset_id",asset_id)
            if not p or p["revoked"] or p["status"]!="ACTIVE":
                return "NOT_AUTHORIZED"
            if not a or a["run_id"]!=run or a["player_id"]!=player:
                return "NOT_OWNED"
            if a["container"]=="WORKSHOP" or container not in ("CARRIED","EQUIPPED"):
                return "FORBIDDEN_MOVE"
            cx.execute("UPDATE assets SET container=?,revision=revision+1 WHERE asset_id=?",
                       (container,asset_id))
            self.remember(cx,run,player,"MOVE",request,payload,"COMMITTED")
            self.audit(cx,run,"ASSET_MOVE",asset_id,container)
            return "COMMITTED"

    def damage(self,run,player,amount):
        """Authoritative-server-only fixture. Client damage claims prohibited."""
        with self.tx() as cx:
            p=cx.execute("SELECT * FROM participants WHERE run_id=? AND player_id=?",
                         (run,player)).fetchone()
            if not p or p["status"]!="ACTIVE" or amount<=0:
                return "IGNORED"
            remaining=max(0,p["hp"]-amount)
            status="DEAD" if remaining==0 else "ACTIVE"
            cx.execute("UPDATE participants SET hp=?,status=? WHERE run_id=? AND player_id=?",
                       (remaining,status,run,player))
            self.audit(cx,run,"DEATH_COMMIT" if status=="DEAD" else "DAMAGE_COMMIT",player)
            return status

    def set_dot(self,run,player,duration,next_tick):
        with self.tx() as cx:
            cx.execute("UPDATE participants SET dot_ms=?,tick_ms=? WHERE run_id=? AND player_id=?",
                       (duration,next_tick,run,player))

    def advance_game(self,run,delta):
        if delta<0: raise ValueError("INVALID_TICK")
        with self.tx() as cx:
            state=self.row(cx,"runs","run_id",run)
            if state["state"]!="OPEN": return
            online=cx.execute("SELECT 1 FROM participants WHERE run_id=? AND status='ACTIVE' LIMIT 1",
                              (run,)).fetchone()
            if not online:return
            cx.execute("UPDATE runs SET game_ms=game_ms+? WHERE run_id=?", (delta,run))
            cx.execute("""UPDATE participants SET dot_ms=max(0,dot_ms-?),tick_ms=max(0,tick_ms-?)
                        WHERE run_id=? AND status='ACTIVE'""",(delta,delta,run))
            # FLOOR expiry counts actual shared gameplay only, not wall-clock elapsed.
            game=self.row(cx,"runs","run_id",run)["game_ms"]
            cx.execute("""UPDATE assets SET container='LOST',revision=revision+1
                         WHERE run_id=? AND container='FLOOR' AND floor_expiry_ms<=?""",
                       (run,game))

    def drop_fixture(self,run,asset_id):
        """Server-approved drop fixture; player/client cannot invoke to mint."""
        with self.tx() as cx:
            game=self.row(cx,"runs","run_id",run)["game_ms"]
            cx.execute("""UPDATE assets SET container='FLOOR',floor_expiry_ms=?,revision=revision+1
                        WHERE asset_id=? AND run_id=?""",(game+FLOOR_TTL_MS,asset_id,run))

    def seal_boss(self,run):
        with self.tx() as cx:
            cx.execute("UPDATE runs SET boss_sealed=1 WHERE run_id=?",(run,))

    def boss_entry(self,run,player,was_present_at_seal=False):
        with self.tx() as cx:
            state=self.row(cx,"runs","run_id",run)
            p=cx.execute("SELECT status FROM participants WHERE run_id=? AND player_id=?",
                         (run,player)).fetchone()
            if not state or not p or p["status"]!="ACTIVE": return "DENIED"
            return "HOLD_BOSS_SEAL" if state["boss_sealed"] and not was_present_at_seal else "ALLOWED_DRAFT"

    def revoke(self,run,player):
        with self.tx() as cx:
            cx.execute("UPDATE participants SET revoked=1,epoch=epoch+1 WHERE run_id=? AND player_id=?",
                       (run,player))

    def snapshot(self,run):
        with self.tx() as cx:
            rows=lambda sql: [dict(x) for x in cx.execute(sql,(run,)).fetchall()]
            state=dict(self.row(cx,"runs","run_id",run))
            return {
              "run":state,
              "participants":rows("SELECT * FROM participants WHERE run_id=? ORDER BY player_id"),
              "assets":rows("SELECT * FROM assets WHERE run_id=? ORDER BY asset_id"),
              "shipments":rows("SELECT * FROM shipments WHERE run_id=? ORDER BY shipment_id"),
              "audit":rows("SELECT * FROM audit_events WHERE run_id=? ORDER BY event_no")
            }

    def recovery_assets(self,run,player):
        """Authoritative sandbox assets only; shipped items live exclusively in WORKSHOP."""
        with self.tx() as cx:
            return [dict(x) for x in cx.execute("""SELECT * FROM assets WHERE run_id=? AND player_id=?
              AND container IN ('EQUIPPED','CARRIED','TEMP') ORDER BY asset_id""",
              (run,player))]

    @staticmethod
    def client_mint_reward(*args,**kwargs):
        return "DENIED_CLIENT_AUTHORITY"
