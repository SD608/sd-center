"use strict";
const {contextBridge,ipcRenderer}=require("electron");
contextBridge.exposeInMainWorld("sdLogistics",{
  getWalletState:()=>ipcRenderer.invoke("sdlogistics:wallet-state"),
  autoDetectWallet:()=>ipcRenderer.invoke("sdlogistics:auto-detect"),
  chooseWalletDatabase:()=>ipcRenderer.invoke("sdlogistics:choose-db"),
  selectAccount:(id)=>ipcRenderer.invoke("sdlogistics:select-account",id),
  transact:(amount,memo)=>ipcRenderer.invoke("sdlogistics:wallet-transaction",amount,memo)
});
