"use strict";
const fs=require("node:fs");
const path=require("node:path");
const {app,BrowserWindow,dialog,ipcMain,shell}=require("electron");
const {ConfigStore}=require("./src/config-store");
const {applyTransaction,inspectDatabase,listRecentTransactions}=require("./src/wallet-db");
const {checkRequiredUpdate}=require("./src/update-policy");
const packageJson=require("./package.json");

app.setName("SDLogisticsCenter");
let mainWindow=null,configStore=null;

function createWindow(){
  mainWindow=new BrowserWindow({
    width:1260,height:860,minWidth:900,minHeight:660,title:"SD 물류센터",
    icon:path.join(__dirname,"public","icons","icon-512.png"),
    backgroundColor:"#07111f",autoHideMenuBar:true,show:false,
    webPreferences:{preload:path.join(__dirname,"preload.js"),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}
  });
  mainWindow.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  mainWindow.webContents.on("will-navigate",(event,url)=>{if(url!==mainWindow.webContents.getURL())event.preventDefault();});
  mainWindow.once("ready-to-show",()=>mainWindow.show());
  mainWindow.on("closed",()=>{mainWindow=null;});
  mainWindow.loadFile(path.join(__dirname,"public","index.html"));
}
function candidates(){
  const appFolder=__dirname,appsFolder=path.dirname(appFolder),centerFolder=path.dirname(appsFolder);
  const roots=[process.env.APPDATA,process.env.LOCALAPPDATA,process.cwd(),path.dirname(process.cwd()),appFolder,appsFolder,centerFolder,app.getPath("userData"),path.dirname(app.getPath("userData")),"C:\\SD시리즈\\종합"].filter(Boolean);
  const suffixes=[
    ["SDWallet","data","sdwallet.sqlite"],["SD지갑","data","sdwallet.sqlite"],["sdwallet-desktop","data","sdwallet.sqlite"],
    ["apps","SDWallet","data","sdwallet.sqlite"],["apps","SD지갑","data","sdwallet.sqlite"],["data","sdwallet.sqlite"],["sdwallet.sqlite"]
  ];
  const set=new Set([
    path.resolve(appsFolder,"SDWallet","data","sdwallet.sqlite"),
    path.resolve(appsFolder,"SD지갑","data","sdwallet.sqlite")
  ]);
  for(const root of roots)for(const suffix of suffixes)set.add(path.resolve(root,...suffix));
  return [...set];
}
function autoDetect(){
  const out=[],seen=new Set();
  for(const file of candidates()){
    if(!fs.existsSync(file))continue;
    try{
      const i=inspectDatabase(file),key=i.path.toLowerCase();
      if(seen.has(key))continue;seen.add(key);out.push(i);
    }catch{}
  }
  out.sort((a,b)=>{try{return fs.statSync(b.path).mtimeMs-fs.statSync(a.path).mtimeMs;}catch{return 0;}});
  return out;
}
function currentState(){
  let c=configStore.load();
  if(!c.databasePath||!fs.existsSync(c.databasePath)){
    const found=autoDetect();
    if(found.length)c=configStore.save({databasePath:found[0].path,selectedAccountId:found[0].accounts[0]?.id||""});
  }
  if(!c.databasePath||!fs.existsSync(c.databasePath))return{connected:false,config:c,accounts:[],selected:null,transactions:[]};
  const i=inspectDatabase(c.databasePath);
  const selected=i.accounts.find(a=>a.id===String(c.selectedAccountId))||i.accounts[0]||null;
  if(selected&&selected.id!==c.selectedAccountId)c=configStore.update({selectedAccountId:selected.id});
  return{connected:Boolean(selected),config:c,path:i.path,accounts:i.accounts,selected,transactions:selected?listRecentTransactions(i.path,selected.id,50):[]};
}
function registerIpc(){
  ipcMain.handle("sdlogistics:wallet-state",()=>currentState());
  ipcMain.handle("sdlogistics:auto-detect",()=>{
    const found=autoDetect();
    if(found.length)configStore.save({databasePath:found[0].path,selectedAccountId:found[0].accounts[0]?.id||""});
    return{detected:found,state:currentState()};
  });
  ipcMain.handle("sdlogistics:choose-db",async()=>{
    const r=await dialog.showOpenDialog(mainWindow,{title:"SD지갑 데이터베이스 선택",properties:["openFile"],filters:[{name:"SD지갑 SQLite",extensions:["sqlite","db"]},{name:"모든 파일",extensions:["*"]}]});
    if(r.canceled||!r.filePaths.length)return null;
    const i=inspectDatabase(r.filePaths[0]);
    configStore.save({databasePath:i.path,selectedAccountId:i.accounts[0]?.id||""});
    return currentState();
  });
  ipcMain.handle("sdlogistics:select-account",(_e,id)=>{
    const c=configStore.load();
    if(!c.databasePath)throw new Error("먼저 SD지갑을 연결하세요.");
    const i=inspectDatabase(c.databasePath);
    const a=i.accounts.find(x=>x.id===String(id));
    if(!a)throw new Error("선택한 가상계좌를 찾지 못했습니다.");
    configStore.update({selectedAccountId:a.id});
    return currentState();
  });
  ipcMain.handle("sdlogistics:wallet-transaction",(_e,amount,memo)=>{
    const s=currentState();
    if(!s.connected||!s.selected)throw new Error("SD지갑 가상계좌를 먼저 연결하세요.");
    const tx=applyTransaction(s.path,s.selected.id,Number(amount),String(memo||"SD 물류센터 가상거래"));
    return{transaction:tx,state:currentState()};
  });
}
app.whenReady().then(async()=>{const updateCheck=await checkRequiredUpdate({appId:"sd-logistics-center-desktop",currentVersion:packageJson.version,userDataPath:app.getPath("userData")});if(!updateCheck.ok){const detail=updateCheck.reason==="update-required"?`${updateCheck.message}\n\n현재 버전: v${packageJson.version}\n필수 버전: v${updateCheck.minVersion}`:updateCheck.message;dialog.showErrorBox("SD 물류센터 · 필수 업데이트",detail);if(updateCheck.downloadUrl){try{await shell.openExternal(updateCheck.downloadUrl);}catch{}}app.quit();return;}configStore=new ConfigStore(app.getPath("userData"));registerIpc();createWindow();app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});});
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit();});
