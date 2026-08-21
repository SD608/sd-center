"use strict";
const crypto=require("crypto");
class PresenceReporter{
  constructor({rpc,appId,appName,appVersion=null,deviceId=null,metadata={},instanceId=crypto.randomUUID(),intervalMs=30000}){if(typeof rpc!=="function") throw new Error("RPC_REQUIRED"); this.rpc=rpc; this.appId=String(appId||""); this.appName=String(appName||""); this.appVersion=appVersion; this.deviceId=deviceId; this.metadata=metadata||{}; this.instanceId=instanceId; this.intervalMs=Math.max(15000,Number(intervalMs)||30000); this.timer=null;}
  payload(){return {p_instance_id:this.instanceId,p_app_id:this.appId,p_app_name:this.appName,p_app_version:this.appVersion,p_device_id:this.deviceId,p_metadata:this.metadata};}
  async heartbeat(){return this.rpc("sd_presence_v1_heartbeat",this.payload());}
  async start(){if(this.timer) return; await this.heartbeat(); this.timer=setInterval(()=>{this.heartbeat().catch(()=>{});},this.intervalMs); this.timer.unref?.();}
  async stop(){if(this.timer) clearInterval(this.timer); this.timer=null; try{return await this.rpc("sd_presence_v1_end",{p_instance_id:this.instanceId});}catch{return null;}}
}
module.exports={PresenceReporter};
