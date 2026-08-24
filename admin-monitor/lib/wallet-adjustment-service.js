"use strict";
class WalletAdjustmentService{constructor({api,store}){this.api=api;this.store=store;} pending(){return this.store.load();} async adjust(payload){const saved=this.store.save(payload); try{const result=await this.api.adjustWallet(saved); this.store.clear(saved.requestId); return result;}catch(error){if(!error?.uncertain) this.store.clear(saved.requestId); throw error;}}}
module.exports={WalletAdjustmentService};
