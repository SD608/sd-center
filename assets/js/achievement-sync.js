"use strict";

(() => {
  const POLL_MS = 10000;
  const progress = window.SD_ACHIEVEMENT_PROGRESS = window.SD_ACHIEVEMENT_PROGRESS || {};
  const unlocked = window.SD_ACHIEVEMENT_UNLOCKED = window.SD_ACHIEVEMENT_UNLOCKED || {};
  let catalog = [];
  let rows = [];
  let pending = null;
  let channels = [];
  let liveUserId = "";
  let pollTimer = null;
  let reloadTimer = null;
  let authSubscription = null;

  const auth = () => window.SD_AUTH || null;
  const emit = (detail = {}) => window.dispatchEvent(new CustomEvent("sd-achievements-updated", { detail }));

  async function session() {
    const client = auth()?.client;
    if (!client?.auth) return null;
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data?.session || null;
  }

  function apply(payload) {
    const next = Array.isArray(payload?.achievements) ? payload.achievements : [];
    catalog = next.map((item) => ({ ...item, code: String(item.code || "") })).filter((item) => item.code);
    rows = catalog.map((item) => ({
      achievement_id: item.code,
      current_value: item.current_value == null ? null : Math.max(0, Number(item.current_value || 0)),
      unlocked: Boolean(item.unlocked),
      unlocked_at: item.unlocked_at || null,
      title_owned: Boolean(item.title_owned),
      title_equipped: Boolean(item.title_equipped),
    }));

    Object.keys(progress).forEach((key) => delete progress[key]);
    Object.keys(unlocked).forEach((key) => delete unlocked[key]);
    rows.forEach((row) => {
      if (row.current_value != null) progress[row.achievement_id] = row.current_value;
      unlocked[row.achievement_id] = row.unlocked;
    });
    window.SD_ACHIEVEMENTS = catalog.slice();
    emit({ rows: rows.slice(), catalog: catalog.slice(), synced: true, schemaVersion: Number(payload?.schema_version || 1) });
    return catalog;
  }

  async function readRows() {
    const client = auth()?.client;
    const current = await session();
    if (!client || !current) {
      catalog = [];
      rows = [];
      Object.keys(progress).forEach((key) => delete progress[key]);
      Object.keys(unlocked).forEach((key) => delete unlocked[key]);
      window.SD_ACHIEVEMENTS = [];
      emit({ rows: [], catalog: [], synced: false, reason: "signed-out" });
      return [];
    }
    const { data, error } = await client.rpc("get_sd_achievement_center_v1");
    if (error) throw error;
    return apply(data || {});
  }

  async function refresh() {
    if (pending) return pending;
    pending = readRows().catch((error) => {
      console.warn("[SD Achievement] canonical read unavailable", error?.message || error);
      emit({ rows: rows.slice(), catalog: catalog.slice(), synced: false, reason: "read-failed" });
      return catalog.slice();
    }).finally(() => { pending = null; });
    return pending;
  }

  // Compatibility names remain read-only. Client-derived achievement claims are never submitted.
  async function record() {
    await refresh();
    return false;
  }
  async function deriveAccountState() { return false; }

  function scheduleRead(reason = "live") {
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => {
      readRows().catch((error) => {
        console.warn("[SD Achievement] refresh unavailable", error?.message || error);
        emit({ rows: rows.slice(), catalog: catalog.slice(), synced: false, reason });
      });
    }, 150);
  }

  function stopPolling() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = null;
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") scheduleRead("poll");
    }, POLL_MS);
  }

  async function stopLive() {
    stopPolling();
    window.clearTimeout(reloadTimer);
    reloadTimer = null;
    const client = auth()?.client;
    const old = channels;
    channels = [];
    liveUserId = "";
    if (client?.removeChannel) {
      for (const channel of old) {
        try { await client.removeChannel(channel); } catch (_) {}
      }
    }
  }

  async function startLive() {
    const client = auth()?.client;
    const current = await session().catch(() => null);
    const userId = String(current?.user?.id || "");
    if (!client || !userId) {
      await stopLive();
      return false;
    }
    if (channels.length && liveUserId === userId) {
      startPolling();
      return true;
    }

    await stopLive();
    liveUserId = userId;
    const specs = [
      ["sd_achievement_progress", `user_id=eq.${userId}`],
      ["sd_user_achievements", `user_id=eq.${userId}`],
      ["sd_public_profiles", `user_id=eq.${userId}`],
    ];
    channels = specs.map(([table, filter]) => client
      .channel(`sd-achievement-center-${table}-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table, filter }, () => scheduleRead(table))
      .subscribe((state) => { if (state === "SUBSCRIBED") scheduleRead("subscribed"); }));
    startPolling();
    return true;
  }

  function refreshOnReturn() {
    if (document.visibilityState === "visible") scheduleRead("foreground");
  }

  window.SD_ACHIEVEMENT_SYNC = {
    refresh,
    readRows,
    record,
    deriveAccountState,
    startLive,
    stopLive,
    getRows: () => rows.slice(),
    getCatalog: () => catalog.slice(),
    getProgress: () => ({ ...progress }),
    getUnlocked: () => ({ ...unlocked }),
  };

  const boot = async () => {
    await refresh();
    await startLive().catch(() => false);
    const client = auth()?.client;
    if (!authSubscription && client?.auth?.onAuthStateChange) {
      const result = client.auth.onAuthStateChange(() => {
        void (async () => {
          await stopLive();
          await refresh();
          await startLive().catch(() => false);
        })();
      });
      authSubscription = result?.data?.subscription || null;
    }
  };

  document.addEventListener("visibilitychange", refreshOnReturn);
  window.addEventListener("focus", refreshOnReturn);
  window.addEventListener("beforeunload", () => {
    stopPolling();
    window.clearTimeout(reloadTimer);
    try { authSubscription?.unsubscribe?.(); } catch (_) {}
    const client = auth()?.client;
    for (const channel of channels) {
      try { client?.removeChannel?.(channel); } catch (_) {}
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else void boot();
})();
