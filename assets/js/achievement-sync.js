"use strict";

(() => {
  const TABLE = "sd_achievement_progress";
  const progress = window.SD_ACHIEVEMENT_PROGRESS = window.SD_ACHIEVEMENT_PROGRESS || {};
  const unlocked = window.SD_ACHIEVEMENT_UNLOCKED = window.SD_ACHIEVEMENT_UNLOCKED || {};
  let rows = [];
  let pending = null;

  const auth = () => window.SD_AUTH || null;
  const emit = (detail = {}) => window.dispatchEvent(new CustomEvent("sd-achievements-updated", { detail }));
  const normalize = (items) => (Array.isArray(items) ? items : [items]).filter(Boolean).map((item) => ({
    achievement_id: String(item.achievement_id || item.id || "").trim().toLowerCase(),
    current_value: Math.max(0, Number(item.current_value ?? item.value ?? 0) || 0),
    unlocked: Boolean(item.unlocked),
    metadata: item.metadata && typeof item.metadata === "object" ? item.metadata : {}
  })).filter((item) => /^[a-z0-9][a-z0-9-]{1,79}$/.test(item.achievement_id));

  async function session() {
    const a = auth();
    if (!a?.client?.auth) return null;
    const { data, error } = await a.client.auth.getSession();
    if (error) throw error;
    return data?.session || null;
  }

  function apply(next) {
    rows = Array.isArray(next) ? next : [];
    Object.keys(progress).forEach((key) => delete progress[key]);
    Object.keys(unlocked).forEach((key) => delete unlocked[key]);
    rows.forEach((row) => {
      const id = String(row.achievement_id || "");
      if (!id) return;
      progress[id] = Math.max(0, Number(row.current_value || 0));
      unlocked[id] = Boolean(row.unlocked);
    });
    emit({ rows, synced: true });
    return rows;
  }

  async function readRows() {
    const a = auth();
    if (!a || !await session()) return apply([]);
    const rpc = await a.client.rpc("get_sd_achievement_progress");
    if (!rpc.error) return apply(rpc.data || []);
    const direct = await a.client.from(TABLE)
      .select("achievement_id,current_value,unlocked,unlocked_at,source_app,updated_at")
      .order("achievement_id", { ascending: true });
    if (direct.error) throw rpc.error;
    return apply(direct.data || []);
  }

  async function record(items, sourceApp = "web") {
    const a = auth();
    const payload = normalize(items);
    if (!a || !await session() || !payload.length) return false;
    const result = await a.client.rpc("sync_sd_achievement_progress", {
      p_items: payload,
      p_source_app: String(sourceApp || "web").slice(0, 80)
    });
    if (result.error) throw result.error;
    apply(result.data || []);
    return true;
  }

  const threshold = (id, value, target, metadata = {}) => {
    const current = Math.max(0, Number(value || 0));
    return { id, value: current, unlocked: current >= Number(target), metadata };
  };

  async function deriveAccountState() {
    const a = auth();
    if (!a || !await session()) return false;
    const items = [];

    try {
      const wallet = await a.client.from("wallets").select("balance").single();
      if (!wallet.error && wallet.data) {
        const balance = Math.max(0, Number(wallet.data.balance || 0));
        items.push({ id: "wallet-01", value: balance === 0 ? 1 : 0, unlocked: balance === 0, metadata: { balance } });
        [["wallet-02",10000000],["wallet-03",100000000],["wallet-04",1000000000],["wallet-05",10000000000],["wallet-06",100000000000],["wallet-07",1000000000000]]
          .forEach(([id,target]) => items.push(threshold(id, balance, target, { balance })));
      }
    } catch (error) { console.warn("[SD Achievement] wallet derive failed", error?.message || error); }

    try {
      const logistics = await a.client.from("sd_logistics_progress").select("state").limit(1).maybeSingle();
      const state = logistics.data?.state;
      if (!logistics.error && state && typeof state === "object") {
        const rep = Math.max(0, Number(state.logisticsRep || 0));
        const hq = Math.max(0, Math.trunc(Number(state.headquartersLevel || 0)));
        const fleet = Array.isArray(state.fleet) ? state.fleet.length : 0;
        const completed = Math.max(0, Number(state.completedContracts || 0));
        const revenue = Math.max(0, Number(state.logisticsRevenue || 0));
        items.push({ id:"logistics-02", value:rep, unlocked:rep>=7000 || hq>=1, metadata:{logisticsRep:rep, headquartersLevel:hq} });
        items.push(threshold("logistics-03",hq,5,{headquartersLevel:hq}), threshold("logistics-04",hq,10,{headquartersLevel:hq}));
        items.push(threshold("logistics-06",revenue,100000000,{logisticsRevenue:revenue}), threshold("logistics-07",revenue,1000000000,{logisticsRevenue:revenue}), threshold("logistics-08",revenue,10000000000,{logisticsRevenue:revenue}));
        items.push(threshold("logistics-10",fleet,5,{fleet}), threshold("logistics-11",fleet,10,{fleet}));
        items.push(threshold("logistics-12",completed,100,{completedContracts:completed}), threshold("logistics-13",completed,1000,{completedContracts:completed}));
      }
    } catch (error) { console.warn("[SD Achievement] logistics derive failed", error?.message || error); }

    try {
      const vault = await a.client.rpc("get_sd_vault_state");
      if (!vault.error && vault.data) {
        const bars = Math.max(0, Math.trunc(Number(vault.data.gold_bars || 0)));
        items.push(threshold("gold-01",bars,10,{goldBars:bars}), threshold("gold-02",bars,100,{goldBars:bars}), threshold("gold-03",bars,1000,{goldBars:bars}));
      }
    } catch (error) { console.warn("[SD Achievement] vault derive failed", error?.message || error); }

    if (!items.length) return false;
    try { await record(items, "sd-center-web"); return true; }
    catch (error) { console.warn("[SD Achievement] account derive upload failed", error?.message || error); return false; }
  }

  async function refresh({ derive = true } = {}) {
    if (pending) return pending;
    pending = (async () => {
      try {
        if (derive) await deriveAccountState();
        return await readRows();
      } catch (error) {
        console.warn("[SD Achievement] sync unavailable", error?.message || error);
        emit({ rows, synced:false, error:error?.message || String(error) });
        return rows;
      } finally { pending = null; }
    })();
    return pending;
  }

  window.SD_ACHIEVEMENT_SYNC = { refresh, readRows, record, deriveAccountState, getRows:()=>rows.slice(), getProgress:()=>({...progress}), getUnlocked:()=>({...unlocked}) };
  const boot = () => refresh().catch(()=>{});
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once:true }); else boot();
})();
