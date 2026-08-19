"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ASSET_HOST = "raw.githubusercontent.com";
const ASSET_PREFIX = "/SD608/sd-center/theme-catalog/themes/assets/";
const MAX_BYTES = 256 * 1024;
const MAX_THEMES = 100;

function validHex(value, fallback) {
  const text = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : fallback;
}

function assetUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.hostname !== ASSET_HOST || !url.pathname.startsWith(ASSET_PREFIX)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function sanitizeThemeCatalog(raw) {
  if (!raw || typeof raw !== "object" || Number(raw.schemaVersion) !== 1) {
    throw new Error("지원하지 않는 테마 카탈로그 형식입니다.");
  }
  const input = Array.isArray(raw.themes) ? raw.themes : [];
  if (input.length > MAX_THEMES) throw new Error("테마 카탈로그 항목이 너무 많습니다.");
  const seen = new Set();
  const themes = [];
  input.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || entry.enabled === false) return;
    const id = String(entry.id || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) || id === "sd-dark" || seen.has(id)) return;
    seen.add(id);
    themes.push({
      id,
      name: (String(entry.name || id).trim().slice(0, 60) || id),
      description: String(entry.description || "").trim().slice(0, 180),
      tag: (String(entry.tag || "THEME").trim().slice(0, 24) || "THEME"),
      priceLabel: (String(entry.priceLabel || "무료").trim().slice(0, 24) || "무료"),
      version: (String(entry.version || "1").trim().slice(0, 20) || "1"),
      order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : index * 10,
      overlay: Math.max(0, Math.min(0.85, Number(entry.overlay ?? 0.38) || 0.38)),
      accent: validHex(entry.accent, "#e9eef7"),
      backgroundColor: validHex(entry.backgroundColor, "#111214"),
      backgroundUrl: assetUrl(entry.backgroundUrl),
      thumbnailUrl: assetUrl(entry.thumbnailUrl),
    });
  });
  themes.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ko"));
  return {
    schemaVersion: 1,
    catalogVersion: Math.max(0, Number(raw.catalogVersion || 0) || 0),
    updatedAt: String(raw.updatedAt || "").slice(0, 40),
    themes,
  };
}

function createThemeCatalogService({ dataRoot, catalogUrl, ttlMs = 5 * 60 * 1000 }) {
  const cachePath = path.join(dataRoot, "theme-catalog-cache.json");
  let catalog = { schemaVersion: 1, catalogVersion: 0, updatedAt: "", themes: [] };
  let source = "builtin";
  let fetchedAt = 0;
  let pending = null;

  function readCache() {
    try { return sanitizeThemeCatalog(JSON.parse(fs.readFileSync(cachePath, "utf8"))); }
    catch { return null; }
  }
  function writeCache(value) {
    try {
      fs.mkdirSync(dataRoot, { recursive: true });
      const temp = `${cachePath}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
      fs.renameSync(temp, cachePath);
    } catch (error) {
      console.warn("테마 카탈로그 캐시 저장 실패", error?.message || error);
    }
  }

  async function refresh(force = false) {
    if (!force && fetchedAt && Date.now() - fetchedAt < ttlMs) return catalog;
    if (pending) return pending;
    pending = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(`${catalogUrl}?t=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json" }, signal: controller.signal });
        if (!response.ok) throw new Error(`테마 카탈로그 HTTP ${response.status}`);
        const text = await response.text();
        if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new Error("테마 카탈로그가 너무 큽니다.");
        catalog = sanitizeThemeCatalog(JSON.parse(text));
        source = "remote";
        writeCache(catalog);
      } catch (error) {
        const cached = readCache();
        if (cached) { catalog = cached; source = "cache"; }
        else { catalog = { schemaVersion: 1, catalogVersion: 0, updatedAt: "", themes: [] }; source = "builtin"; }
        console.warn("테마 카탈로그를 불러오지 못했습니다.", error?.message || error);
      } finally {
        clearTimeout(timer);
        fetchedAt = Date.now();
        pending = null;
      }
      return catalog;
    })();
    return pending;
  }

  return {
    async getCatalog({ force = false } = {}) {
      const value = await refresh(Boolean(force));
      return { ok: true, source, ...value };
    },
  };
}

module.exports = { createThemeCatalogService, sanitizeThemeCatalog };
