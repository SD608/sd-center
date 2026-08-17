"use strict";
const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const {DatabaseSync}=require("node:sqlite");
const APP_VERSION=String(require("../package.json").version||"0.0.0");

function safeVersion(value){
  const match=String(value||"0.0.0").match(/\d+(?:\.\d+){2}/);
  return match?match[0]:"0.0.0";
}
function centerVersion(){
  const root=String(process.env.SD_CENTER_ROOT||"").trim();
  if(!root)return "0.0.0";
  try{return safeVersion(JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).version);}
  catch{return "0.0.0";}
}

function openDatabase(filePath){
  if(!filePath||!fs.existsSync(filePath))throw new Error("SD지갑 데이터베이스 파일을 찾지 못했습니다.");
  const db=new DatabaseSync(path.resolve(filePath));
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=7000;");
  return db;
}
function requiredTables(db){
  const rows=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','accounts','transactions')").all();
  const names=new Set(rows.map(r=>String(r.name)));
  return ["users","accounts","transactions"].every(n=>names.has(n));
}
function normalizeAccount(row){
  return {
    id:String(row.id),userId:Number(row.user_id),username:String(row.username||""),
    bankName:String(row.bank_name||""),accountNumber:String(row.account_number||""),
    ownerName:String(row.owner_name||""),balance:Number(row.balance||0),
    createdAt:String(row.created_at||""),updatedAt:String(row.updated_at||"")
  };
}
function inspectDatabase(filePath){
  const db=openDatabase(filePath);
  try{
    if(!requiredTables(db))throw new Error("지원되는 SD지갑 데이터베이스가 아닙니다.");
    const integrity=db.prepare("PRAGMA integrity_check").get();
    if(String(integrity?.integrity_check||"").toLowerCase()!=="ok")throw new Error("SD지갑 데이터베이스 무결성 검사에 실패했습니다.");
    const accounts=db.prepare(`
      SELECT a.*,u.username FROM accounts a JOIN users u ON u.id=a.user_id
      ORDER BY a.created_at ASC
    `).all().map(normalizeAccount);
    return {path:path.resolve(filePath),accounts,integrity:"ok"};
  }finally{db.close();}
}
function getAccount(filePath,accountId){
  const db=openDatabase(filePath);
  try{
    const row=db.prepare(`
      SELECT a.*,u.username FROM accounts a JOIN users u ON u.id=a.user_id
      WHERE a.id=? LIMIT 1
    `).get(String(accountId));
    if(!row)throw new Error("선택한 SD지갑 가상계좌를 찾지 못했습니다.");
    return normalizeAccount(row);
  }finally{db.close();}
}
function listRecentTransactions(filePath,accountId,limit=50){
  const db=openDatabase(filePath);
  try{
    const safe=Math.max(1,Math.min(100,Number(limit)||50));
    return db.prepare(`
      SELECT id,account_id,transaction_type,amount,memo,created_at
      FROM transactions WHERE account_id=?
      ORDER BY created_at DESC,rowid DESC LIMIT ?
    `).all(String(accountId),safe).map(r=>({
      id:String(r.id),accountId:String(r.account_id),transactionType:String(r.transaction_type||""),
      amount:Number(r.amount||0),memo:String(r.memo||""),createdAt:String(r.created_at||"")
    }));
  }finally{db.close();}
}
function applyTransaction(filePath,accountId,signedAmount,memo){
  const amount=Math.trunc(Number(signedAmount));
  if(!Number.isSafeInteger(amount)||amount===0)throw new Error("가상 거래 금액이 올바르지 않습니다.");
  const db=openDatabase(filePath);
  try{
    db.exec("BEGIN IMMEDIATE");
    try{
      const current=db.prepare("SELECT balance FROM accounts WHERE id=? LIMIT 1").get(String(accountId));
      if(!current)throw new Error("선택한 SD지갑 가상계좌를 찾지 못했습니다.");
      const before=Number(current.balance||0);
      const after=before+amount;
      if(!Number.isSafeInteger(after)||after<0)throw new Error("SD지갑 가상잔액이 부족합니다.");
      if(after>1000000000000)throw new Error("SD지갑 가상잔액 허용 범위를 초과했습니다.");
      const now=new Date().toISOString();
      const id=`sdlogistics-c${centerVersion()}-v${safeVersion(APP_VERSION)}-${crypto.randomUUID()}`;
      db.prepare("UPDATE accounts SET balance=?,updated_at=? WHERE id=?").run(after,now,String(accountId));
      db.prepare(`
        INSERT INTO transactions(id,account_id,transaction_type,amount,memo,created_at)
        VALUES(?,?,?,?,?,?)
      `).run(id,String(accountId),amount>0?"deposit":"withdraw",Math.abs(amount),String(memo||"SD 물류센터 가상거래").slice(0,180),now);
      db.exec("COMMIT");
      return {id,signedAmount:amount,before,after,account:getAccount(filePath,accountId)};
    }catch(e){db.exec("ROLLBACK");throw e;}
  }finally{db.close();}
}
module.exports={applyTransaction,getAccount,inspectDatabase,listRecentTransactions};
