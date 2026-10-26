"""Real SQLite transaction tests, NOT real Center/Core/Unity/G60 production tests."""
import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor

from sqlite_sandbox import Sandbox, G60_MS, DAY_MS, FLOOR_TTL_MS


class SandboxContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="sd-g60-sandbox-")
        self.addCleanup(self.temp.cleanup)
        self.db = Sandbox(os.path.join(self.temp.name, "test.db"))
        self.db.seed_run("run1", ["p1"])

    def player(self, p="p1"):
        return next(x for x in self.db.snapshot("run1")["participants"] if x["player_id"] == p)

    def locked(self):
        self.assertEqual("OFFLINE", self.db.disconnect("run1","p1",0))
        self.assertEqual("SWEPT", self.db.sweep("run1",G60_MS))
        return self.player()["epoch"]

    def test_contract_01_join_before_deadline_blocks_stale_cleanup(self):
        epoch=self.locked()
        deadline=self.db.snapshot("run1")["run"]["deadline_ms"]
        self.assertEqual("JOIN_COMMIT_SAVED",self.db.join("run1","p1","join1",epoch,deadline-1))
        self.assertEqual("JOIN_COMMIT_SAVED",self.db.join("run1","p1","join1",epoch,deadline-1))
        self.assertEqual("NOT_EXPIRED",self.db.cleanup("run1",deadline+1))
        self.assertIsNone(self.db.snapshot("run1")["run"]["deadline_ms"])

    def test_contract_02_expiry_equal_rejects_and_cleanup_persists(self):
        epoch=self.locked()
        deadline=self.db.snapshot("run1")["run"]["deadline_ms"]
        self.assertEqual("EXPIRED",self.db.join("run1","p1","boundary",epoch,deadline))
        self.assertEqual("CLEANUP_COMMIT",self.db.cleanup("run1",deadline))
        self.assertEqual("RUN_CLOSED",self.db.join("run1","p1","late",epoch,deadline+1))

    def test_contract_03_fault_eligibility_one_day_only(self):
        epoch=self.locked()
        end=self.db.snapshot("run1")["run"]["deadline_ms"]
        self.db.verify_fault_fixture("run1","unverified",verified=False)
        self.db.verify_fault_fixture("run1","verified",verified=True)
        self.assertEqual("REJECTED",self.db.grant_fault_grace("run1","unverified"))
        self.assertEqual("GRANTED",self.db.grant_fault_grace("run1","verified"))
        self.assertEqual("REJECTED",self.db.grant_fault_grace("run1","verified"))
        self.assertEqual(end+DAY_MS,self.db.snapshot("run1")["run"]["deadline_ms"])
        self.assertEqual("JOIN_COMMIT_SAVED",self.db.join("run1","p1","gracejoin",epoch,end+1))

    def test_contract_04_ack_loss_retry_same_asset_move_exactly_once(self):
        self.db.seed_asset("run1","p1","gear1","CARRIED")
        self.assertEqual("COMMITTED",self.db.move_asset("run1","p1","request1","gear1","EQUIPPED"))
        self.assertEqual("COMMITTED",self.db.move_asset("run1","p1","request1","gear1","EQUIPPED"))
        self.assertEqual("IDEMPOTENCY_CONFLICT",
            self.db.move_asset("run1","p1","request1","gear1","CARRIED"))
        gear=self.db.snapshot("run1")["assets"][0]
        self.assertEqual(2,gear["revision"])
        self.assertEqual("EQUIPPED",gear["container"])

    def test_contract_05_unknown_commit_or_replay_does_not_create_asset(self):
        self.assertEqual("NOT_OWNED",self.db.move_asset("run1","p1","bad","client-item","EQUIPPED"))
        self.assertEqual([],self.db.snapshot("run1")["assets"])
        self.assertEqual("DENIED_CLIENT_AUTHORITY",self.db.client_mint_reward())

    def test_contract_06_shipment_atomic_owner_move_with_replay(self):
        for i in range(8):
            self.db.seed_asset("run1","p1",f"temp{i}","TEMP",deliverable=True)
        epoch=self.locked()
        self.db.sweep("run1",G60_MS+1)
        state=self.db.snapshot("run1")
        self.assertEqual(1,len(state["shipments"]))
        self.assertEqual(8,state["shipments"][0]["item_count"])
        self.assertEqual(8,sum(a["container"]=="WORKSHOP" for a in state["assets"]))
        self.assertEqual(0,sum(a["container"]=="TEMP" for a in state["assets"]))
        self.assertTrue(epoch>1)

    def test_contract_07_shipment_unknown_holds_join_and_unblocks_after_requery(self):
        self.db.seed_asset("run1","p1","temp","TEMP",True)
        self.db.disconnect("run1","p1",0)
        self.db.set_delivery_unknown("run1",True)
        self.db.sweep("run1",G60_MS)
        epoch=self.player()["epoch"]
        before=self.db.snapshot("run1")["run"]["deadline_ms"]
        self.assertEqual("HOLD_LEDGER",self.db.join("run1","p1","id7",epoch,G60_MS+1))
        self.assertEqual(before,self.db.snapshot("run1")["run"]["deadline_ms"])
        self.db.set_delivery_unknown("run1",False)
        self.db.sweep("run1",G60_MS+2)
        self.assertEqual("JOIN_COMMIT_SAVED",self.db.join("run1","p1","id7",epoch,G60_MS+3))
        self.assertEqual("WORKSHOP",self.db.snapshot("run1")["assets"][0]["container"])

    def test_contract_08_dead_before_lock_and_no_damage_after_lock(self):
        self.assertEqual("DEAD",self.db.damage("run1","p1",100))
        self.assertEqual("REJECTED",self.db.disconnect("run1","p1",0))
        self.assertEqual("PARTICIPANT_FINISHED",self.db.join("run1","p1","d",1,1))
        self.db.seed_run("another",["q1"])
        self.db.disconnect("another","q1",0)
        self.db.sweep("another",G60_MS)
        self.assertEqual("IGNORED",self.db.damage("another","q1",999))
        self.assertEqual(100,self.db.snapshot("another")["participants"][0]["hp"])

    def test_contract_09_offline_dot_paused_while_party_game_advances(self):
        self.db.seed_run("multiplayer",["a","b"])
        self.db.set_dot("multiplayer","a",10000,2000)
        self.db.set_dot("multiplayer","b",10000,2000)
        self.db.disconnect("multiplayer","a",0)
        self.db.sweep("multiplayer",G60_MS)
        self.db.advance_game("multiplayer",5000)
        people={p["player_id"]:p for p in self.db.snapshot("multiplayer")["participants"]}
        self.assertEqual((10000,2000),(people["a"]["dot_ms"],people["a"]["tick_ms"]))
        self.assertEqual((5000,0),(people["b"]["dot_ms"],people["b"]["tick_ms"]))
        self.assertEqual("JOIN_COMMIT_SAVED",self.db.join("multiplayer","a","rejoin",2,G60_MS))
        self.db.advance_game("multiplayer",1000)
        self.assertEqual(9000,self.db.snapshot("multiplayer")["participants"][0]["dot_ms"])

    def test_contract_10_device_revocation_and_epoch_fencing(self):
        self.db.disconnect("run1","p1",0)
        self.assertEqual("FENCED",self.db.join("run1","p1","stale",1,1))
        self.assertEqual("JOIN_COMMIT_SAVED",self.db.join("run1","p1","ok",2,2))
        self.db.revoke("run1","p1")
        self.assertEqual("FENCED",self.db.join("run1","p1","revoked",3,3))

    def test_contract_11_location_hold_and_elevator_fallback(self):
        epoch=self.locked()
        deadline=self.db.snapshot("run1")["run"]["deadline_ms"]
        self.assertEqual("HOLD_LOCATION",self.db.join("run1","p1","loc",epoch,G60_MS,False,False))
        self.assertEqual(deadline,self.db.snapshot("run1")["run"]["deadline_ms"])
        self.assertEqual("JOIN_COMMIT_ELEVATOR",self.db.join("run1","p1","loc",epoch,G60_MS+1,False,True))
        self.assertIsNone(self.db.snapshot("run1")["run"]["deadline_ms"])

    def test_contract_12_g60_before_60s_no_shipment(self):
        self.db.seed_asset("run1","p1","cargo","TEMP",True)
        self.db.disconnect("run1","p1",0)
        self.assertEqual("JOIN_COMMIT_SAVED",self.db.join("run1","p1","early",2,G60_MS-1))
        self.db.sweep("run1",G60_MS)
        snap=self.db.snapshot("run1")
        self.assertEqual(0,len(snap["shipments"]))
        self.assertEqual("TEMP",snap["assets"][0]["container"])

    def test_contract_13_all_offline_new_24h_cycle_after_success(self):
        self.db.seed_run("both",["a","b"])
        self.db.disconnect("both","a",0)
        self.db.sweep("both",G60_MS)
        self.assertIsNone(self.db.snapshot("both")["run"]["deadline_ms"])
        self.db.disconnect("both","b",G60_MS)
        self.db.sweep("both",G60_MS*2)
        self.assertEqual(G60_MS*2+DAY_MS,self.db.snapshot("both")["run"]["deadline_ms"])
        self.assertEqual("JOIN_COMMIT_SAVED",self.db.join("both","a","r",2,G60_MS*2+1))
        self.db.disconnect("both","a",G60_MS*2+2)
        self.db.sweep("both",G60_MS*3+2)
        self.assertEqual(G60_MS*3+2+DAY_MS,self.db.snapshot("both")["run"]["deadline_ms"])

    def test_contract_14_unique_ownership_and_floor_game_time_lifecycle_partial(self):
        self.db.seed_run("party",["a","b"])
        self.db.seed_asset("party","a","equipped","EQUIPPED",False)
        self.db.seed_asset("party","a","carried","CARRIED",False)
        self.db.seed_asset("party","a","cargo","TEMP",True)
        self.db.seed_asset("party","b","floor-item","CARRIED",False)
        self.db.drop_fixture("party","floor-item")
        self.db.disconnect("party","a",0)
        self.db.sweep("party",G60_MS)
        snap=self.db.snapshot("party")
        self.assertEqual("WORKSHOP",next(a for a in snap["assets"] if a["asset_id"]=="cargo")["container"])
        self.assertEqual({"equipped","carried"},set(a["asset_id"] for a in self.db.recovery_assets("party","a")))
        # A connected party member advances GAME time, not wall-clock.
        self.db.advance_game("party",FLOOR_TTL_MS-1)
        self.assertEqual("FLOOR",next(a for a in self.db.snapshot("party")["assets"] if a["asset_id"]=="floor-item")["container"])
        self.db.advance_game("party",1)
        self.assertEqual("LOST",next(a for a in self.db.snapshot("party")["assets"] if a["asset_id"]=="floor-item")["container"])
        self.assertEqual(4,len(self.db.snapshot("party")["assets"]))

    def test_contract_15_client_mint_cross_owner_and_concurrent_shipment_no_duplication(self):
        self.db.seed_asset("run1","p1","ore","TEMP",True)
        self.db.seed_run("other",["not-owner"])
        self.assertEqual("NOT_OWNED",self.db.move_asset("other","not-owner","bad","ore","CARRIED"))
        self.assertEqual("DENIED_CLIENT_AUTHORITY",self.db.client_mint_reward())
        self.db.disconnect("run1","p1",0)
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: self.db.sweep("run1",G60_MS),range(8)))
        snap=self.db.snapshot("run1")
        self.assertEqual(1,len(snap["shipments"]))
        self.assertEqual(1,snap["shipments"][0]["item_count"])
        self.assertEqual("WORKSHOP",snap["assets"][0]["container"])

    @unittest.skip("Requires verified Center installer, Unity Editor build, authenticated Core and real Windows user runtime")
    def test_contract_16_real_unity_center_windows(self):
        pass


if __name__ == "__main__":
    unittest.main(verbosity=2)
