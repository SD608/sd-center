"use strict";
const fs=require("node:fs");
const path=require("node:path");
class ConfigStore{
  constructor(directory){this.file=path.join(directory,"sd-logistics-wallet.json");fs.mkdirSync(directory,{recursive:true});}
  load(){try{const p=JSON.parse(fs.readFileSync(this.file,"utf8"));return{databasePath:String(p.databasePath||""),selectedAccountId:String(p.selectedAccountId||"")};}catch{return{databasePath:"",selectedAccountId:""};}}
  save(next){const v={databasePath:String(next.databasePath||""),selectedAccountId:String(next.selectedAccountId||"")};fs.writeFileSync(this.file,JSON.stringify(v,null,2),"utf8");return v;}
  update(patch){return this.save({...this.load(),...patch});}
}
module.exports={ConfigStore};
