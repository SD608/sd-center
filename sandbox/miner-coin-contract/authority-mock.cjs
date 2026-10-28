"use strict";
// DRAFT: deterministic isolated fixture; NOT Core, DB, network auth or real Unity.
// server* methods model hypothetical server-verified facts, NEVER client RPCs.
const LIMITS=[30,60,100,150,210,280,360,450];
const VALUES=Object.freeze({
 ore_lowest:1,ore_low:2,ore_mid:4,ore_high:8,ore_highest:16,
 monster_small_common:2,monster_small_rare:6,
 monster_medium_common:3,monster_medium_rare:9,
 monster_large_common:4,monster_large_rare:12,
 monster_elite_common:6,monster_elite_rare:18,
 monster_midboss_common:8,monster_midboss_rare:24,
 abister_scale:6,abister_spine:8,abister_venom_membrane:10,
 abister_thermal_armor:12,abister_rare_plate:24,abister_story_core:0
});
const clone=x=>JSON.parse(JSON.stringify(x));
const err=msg=>{throw Error(msg)};
const positive=q=>Number.isSafeInteger(q)&&q>0&&q<=1000000;
function coinCount(v){if(!Number.isSafeInteger(v)||v<0)err("INVALID_SCORE");return LIMITS.filter(t=>v>=t).length;}
class MinerCoinMock {
 #runs=new Map();#users=new Map();#lots=new Map();#shipments=new Map();
 #settlements=new Map();#spends=new Map();#q10=new Set();
 addUser(id){if(!id||this.#users.has(id))err("INVALID_USER");this.#users.set(id,{coins:0,level:1,predecessor:false,g2:false});}
 newRun(id,players){if(!id||this.#runs.has(id)||!Array.isArray(players)||!players.length||new Set(players).size!==players.length||players.some(p=>!this.#users.has(p)))err("INVALID_RUN");this.#runs.set(id,new Map(players.map(p=>[p,{state:"ACTIVE",exit:false,boss:false,shippingUnknown:false}])));}
 #member(run,player){const p=this.#runs.get(run)?.get(player);if(!p)err("WRONG_RUN_OR_OWNER");return p;}
 serverLoot({run,player,event,item,quantity}){
  const p=this.#member(run,player);if(p.state!=="ACTIVE")err("RUN_INACTIVE");
  if(!event||!Object.hasOwn(VALUES,item)||!positive(quantity))err("BAD_LOOT");
  const input={run,player,event,item,quantity},old=this.#lots.get(event);
  if(old){if(old.run===run&&old.player===player&&old.item===item&&old.quantity===quantity)return clone(old);err("LOOT_ID_CONFLICT");}
  const lot={...input,bag:quantity,shipped:0};this.#lots.set(event,lot);return clone(lot);
 }
 serverShip({run,player,event,quantity,shipment}){
  const p=this.#member(run,player);if(p.state!=="ACTIVE"||!shipment||!positive(quantity))err("BAD_SHIPMENT");
  const signature={run,player,event,quantity},old=this.#shipments.get(shipment);
  if(old){if(JSON.stringify(old)!==JSON.stringify(signature))err("SHIPMENT_ID_CONFLICT");return clone(old);}
  const lot=this.#lots.get(event);
  if(!lot||lot.run!==run||lot.player!==player||lot.bag<quantity)err("SHIPMENT_OWNER_OR_QUANTITY");
  lot.bag-=quantity;lot.shipped+=quantity;this.#shipments.set(shipment,signature);return clone(signature);
 }
 serverShippingUnknown(run,player,flag){this.#member(run,player).shippingUnknown=!!flag;}
 serverBossDefeat(run,player,boss){const p=this.#member(run,player);if(p.state!=="ACTIVE"||boss!=="grabadon")err("BOSS_INVALID");p.boss=true;}
 serverVerifyMiddleElevatorExit(run,player){const p=this.#member(run,player);if(p.state!=="ACTIVE")err("EXIT_INVALID");p.exit=true;}
 serverReturn({run,player,event}){
  const p=this.#member(run,player),key=run+"|"+player,done=this.#settlements.get(key);
  if(done){if(done.event!==event)err("SECOND_RETURN_BLOCKED");return clone(done);}
  if(!event||p.state!=="ACTIVE"||!p.exit||p.shippingUnknown)err("RETURN_EVIDENCE_MISSING");
  let score=0;const bag=[];
  for(const lot of this.#lots.values())if(lot.run===run&&lot.player===player&&lot.bag){
   if(lot.bag+lot.shipped!==lot.quantity)err("QUANTITY_INVARIANT");
   const points=VALUES[lot.item]*lot.bag;if(!Number.isSafeInteger(score+points))err("SCORE_OVERFLOW");
   score+=points;bag.push({item:lot.item,quantity:lot.bag,event:lot.event,points});
  }
  const coins=coinCount(score),u=this.#users.get(player);
  if(!Number.isSafeInteger(u.coins+coins))err("COIN_OVERFLOW");
  const result={run,player,event,score,coins,balanceAfter:u.coins+coins,bag};
  // Synchronous Map mutation is NOT a DB atomic transaction or concurrent-process proof.
  u.coins+=coins;p.state="RETURNED";this.#settlements.set(key,result);
  if(p.boss)this.#q10.add(player);return clone(result);
 }
 serverDeath(run,player){const p=this.#member(run,player);if(p.state!=="ACTIVE")err("BAD_DEATH");p.state="DEAD";}
 serverLevel(player,level){const u=this.#users.get(player);if(!u||!positive(level))err("BAD_LEVEL");u.level=level;}
 serverG2Predecessor(player){const u=this.#users.get(player);if(!u)err("UNKNOWN_PLAYER");u.predecessor=true;}
 serverBuyG2({player,event}){
  const u=this.#users.get(player);if(!u||!event)err("BAD_REQUEST");
  const key=player+"|"+event,done=this.#spends.get(key);if(done)return clone(done);
  if(u.g2)err("ALREADY_UNLOCKED");
  if(!u.predecessor||u.level<10||!this.#q10.has(player))err("G2_REQUIREMENTS_MISSING");
  if(u.coins<8)err("INSUFFICIENT_COINS");
  const result={player,event,spent:8,remaining:u.coins-8};
  u.coins-=8;u.g2=true;this.#spends.set(key,result);return clone(result);
 }
 serverBuyG1(){err("G1_ELIGIBILITY_TBD_FAIL_CLOSED");}
 clientReward(){err("CLIENT_REWARD_DENIED");}
 clientWalletMutation(){err("CLIENT_WALLET_DENIED");}
 clientAchievementUnlock(){err("CLIENT_ACHIEVEMENT_DENIED");}
 clientRead(player){const u=this.#users.get(player);if(!u)err("UNKNOWN_PLAYER");return Object.freeze(clone({coins:u.coins,g2:u.g2,mode:"ISOLATED_TEST_ONLY"}));}
 auditAssets(){return [...this.#lots.values()].every(x=>x.bag+x.shipped===x.quantity);}
}
module.exports={LIMITS,VALUES,coinCount,MinerCoinMock};