(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SD_UI_LOGIC = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const MAX_ADJUSTMENT_AMOUNT = 100000000000;
  function groupApps(apps) {
    const map = new Map();
    for (const raw of Array.isArray(apps) ? apps : []) {
      const appId = String(raw?.app_id || "unknown");
      const existing = map.get(appId) || { appId, appName: String(raw?.app_name || appId), version: raw?.app_version || null, count: 0, lastSeenAt: raw?.last_seen_at || null, instances: [] };
      existing.count += 1; existing.instances.push(raw);
      if (!existing.lastSeenAt || new Date(raw?.last_seen_at || 0) > new Date(existing.lastSeenAt || 0)) existing.lastSeenAt = raw?.last_seen_at || existing.lastSeenAt;
      map.set(appId, existing);
    }
    return [...map.values()].sort((a,b)=>a.appName.localeCompare(b.appName,"ko"));
  }
  function splitApps(apps, expanded, visibleCount=3) { const grouped=groupApps(apps); if(expanded||grouped.length<=visibleCount) return {visible:grouped,hiddenCount:0,total:grouped.length}; return {visible:grouped.slice(0,visibleCount),hiddenCount:grouped.length-visibleCount,total:grouped.length}; }
  function filterUsers(users,query,onlineOnly){const q=String(query||"").trim().toLowerCase(); return (Array.isArray(users)?users:[]).filter(user=>{if(onlineOnly&&!user?.online)return false;if(!q)return true;return String(user?.nickname||"").toLowerCase().includes(q)||String(user?.account_number||"").toLowerCase().includes(q);});}
  function formatAmount(value){const number=Number(value||0);return `${Number.isFinite(number)?Math.trunc(number).toLocaleString("ko-KR"):"0"} SD`;}
  function formatKoreanGroup(value){const digits=["","일","이","삼","사","오","육","칠","팔","구"],units=["","십","백","천"];let group=Math.trunc(value),result="";for(let position=3;position>=0;position-=1){const digit=Math.floor(group/(10**position))%10;if(!digit)continue;if(digit!==1||position===0)result+=digits[digit];result+=units[position];}return result;}
  function formatKoreanNumber(value){let number=Number(value);if(!Number.isSafeInteger(number)||number<=0)return "";const largeUnits=["","만","억","조"];const parts=[];let unitIndex=0;while(number>0){const group=number%10000;if(group){const groupText=formatKoreanGroup(group);parts.unshift(`${groupText}${largeUnits[unitIndex]||""}`);}number=Math.floor(number/10000);unitIndex+=1;}return parts.join(" ");}
  function formatAdjustmentPreview(value){const number=Number(value);if(!Number.isSafeInteger(number)||number<1)return "";return `${number.toLocaleString("ko-KR")} SD (${formatKoreanNumber(number)})`;}
  function formatRelativeTime(value,now=Date.now()){if(!value)return "-";const ms=new Date(value).getTime();if(!Number.isFinite(ms))return "-";const diff=Math.max(0,now-ms);if(diff<60000)return `${Math.max(1,Math.floor(diff/1000))}초 전`;if(diff<3600000)return `${Math.floor(diff/60000)}분 전`;if(diff<86400000)return `${Math.floor(diff/3600000)}시간 전`;return new Date(ms).toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});}
  return { MAX_ADJUSTMENT_AMOUNT, groupApps, splitApps, filterUsers, formatAmount, formatKoreanNumber, formatAdjustmentPreview, formatRelativeTime };
});
