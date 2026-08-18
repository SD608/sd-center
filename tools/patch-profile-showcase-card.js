"use strict";

const fs = require("node:fs");

function read(path) { return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n"); }
function write(path, text) { fs.writeFileSync(path, text, "utf8"); }
function mustReplace(text, oldText, newText, label) {
  if (!text.includes(oldText)) throw new Error(`Missing marker: ${label}`);
  return text.replace(oldText, newText);
}

// profile.html
let html = read("profile.html");
html = mustReplace(html,
  '<link rel="stylesheet" href="assets/css/profile-assets-v3.css?v=1" />',
  '<link rel="stylesheet" href="assets/css/profile-assets-v3.css?v=1" />\n<link rel="stylesheet" href="assets/css/profile-showcase-card.css?v=1" />',
  "profile showcase css");
html = mustReplace(html,
  '<script src="assets/js/profile-page-v7.js?v=1" defer></script>',
  '<script src="assets/js/profile-page-v8.js?v=1" defer></script>',
  "profile page js");
html = mustReplace(html,
`          <section class="profile-card-module" data-card-block="coins">
            <span class="profile-card-module-label">SD코인 보유량</span>
            <div id="profileCoins" class="profile-coin-holdings"><span class="profile-coin-empty">불러오는 중...</span></div>
          </section>`,
`          <section class="profile-card-module" data-card-block="coins">
            <span class="profile-card-module-label">SD코인 보유량</span>
            <div id="profileCoins" class="profile-coin-holdings"><span class="profile-coin-empty">불러오는 중...</span></div>
          </section>

          <section class="profile-card-module profile-card-showcase-module" data-card-block="flea_showcase">
            <span class="profile-card-module-label">플리마켓 자랑 아이템</span>
            <div id="profileFleaShowcase" class="profile-flea-showcase-grid"><span class="profile-showcase-empty">등록된 아이템 없음</span></div>
          </section>`,
  "profile showcase block");
html = html.replace('profile-card-edit.html?embed=1&amp;v=8', 'profile-card-edit.html?embed=1&amp;v=9');
write("profile.html", html);

// profile-card-edit.html
let editHtml = read("profile-card-edit.html");
editHtml = mustReplace(editHtml,
  '<link rel="stylesheet" href="assets/css/profile-assets-v3.css?v=1" />',
  '<link rel="stylesheet" href="assets/css/profile-assets-v3.css?v=1" />\n<link rel="stylesheet" href="assets/css/profile-showcase-card.css?v=1" />',
  "editor showcase css");
editHtml = mustReplace(editHtml,
  '<script src="assets/js/profile-card-edit-v6.js?v=1" defer></script>',
  '<script src="assets/js/profile-card-edit-v7.js?v=1" defer></script>',
  "editor js");
editHtml = mustReplace(editHtml,
`          <section class="profile-card-module" data-card-block="coins">
            <span class="profile-card-module-label">SD코인 보유량</span>
            <div id="profileCoins" class="profile-coin-holdings"><span class="profile-coin-empty">불러오는 중...</span></div>
          </section>`,
`          <section class="profile-card-module" data-card-block="coins">
            <span class="profile-card-module-label">SD코인 보유량</span>
            <div id="profileCoins" class="profile-coin-holdings"><span class="profile-coin-empty">불러오는 중...</span></div>
          </section>

          <section class="profile-card-module profile-card-showcase-module" data-card-block="flea_showcase">
            <span class="profile-card-module-label">플리마켓 자랑 아이템</span>
            <div id="profileFleaShowcase" class="profile-flea-showcase-grid"><span class="profile-showcase-empty">등록된 아이템 없음</span></div>
          </section>`,
  "editor showcase preview block");
editHtml = mustReplace(editHtml,
`        <section class="profile-editor-content-section">
          <header><div><h4>칭호</h4></div></header>
          <div id="editorTitlePicker" class="profile-editor-option-list"><div class="profile-editor-empty">불러오는 중...</div></div>
        </section>`,
`        <section class="profile-editor-content-section">
          <header><div><h4>칭호</h4></div></header>
          <div id="editorTitlePicker" class="profile-editor-option-list"><div class="profile-editor-empty">불러오는 중...</div></div>
        </section>

        <section class="profile-editor-content-section">
          <header><div><h4>플리마켓 자랑 아이템</h4></div></header>
          <div id="editorShowcasePicker" class="profile-editor-option-list"><div class="profile-editor-empty">불러오는 중...</div></div>
        </section>`,
  "editor showcase picker");
write("profile-card-edit.html", editHtml);

// profile-page-v8.js from v7
let page = read("assets/js/profile-page-v7.js");
page = mustReplace(page,
  'const CARD_KEYS = ["photo", "nickname", "title", "assets", "gold", "coins"];',
  'const CARD_KEYS = ["photo", "nickname", "title", "assets", "gold", "coins", "flea_showcase"];',
  "page card keys");
page = mustReplace(page,
`  const DEFAULT_CARD_LAYOUT = {
    version: 5,
    order: [...CARD_KEYS],
    visible: Object.fromEntries(CARD_KEYS.map((key) => [key, true])),
    settings: { gold_display: "count", coin_codes: [...COIN_CODES] }
  };`,
`  const DEFAULT_CARD_LAYOUT = {
    version: 6,
    order: [...CARD_KEYS],
    visible: { photo: true, nickname: true, title: true, assets: true, gold: true, coins: true, flea_showcase: false },
    settings: { gold_display: "count", coin_codes: [...COIN_CODES] }
  };`,
  "page default layout");
page = page.replace('else visible[key] = true;', 'else if (key === "flea_showcase") visible[key] = false;\n      else visible[key] = true;');
page = page.replace('      version: 5,', '      version: 6,');
page = mustReplace(page,
  '  function renderCardValues() {',
`  function renderFleaShowcase() {
    const root = document.getElementById("profileFleaShowcase");
    if (!root) return;
    root.replaceChildren();
    const items = Array.isArray(profile?.showcase_items) ? profile.showcase_items : null;
    if (!items) {
      const hidden = document.createElement("span");
      hidden.className = "profile-showcase-empty";
      hidden.textContent = "비공개";
      root.append(hidden);
      return;
    }
    if (!items.length) {
      const empty = document.createElement("span");
      empty.className = "profile-showcase-empty";
      empty.textContent = "등록된 아이템 없음";
      root.append(empty);
      return;
    }
    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "profile-showcase-item";
      const name = document.createElement("strong");
      name.textContent = item.name || "플리마켓 아이템";
      const value = document.createElement("span");
      value.textContent = won(item.current_value || 0);
      card.append(name, value);
      root.append(card);
    });
  }

  function renderCardValues() {`,
  "page showcase render function");
page = mustReplace(page,
  '    renderCoins(layout);\n  }',
  '    renderCoins(layout);\n    renderFleaShowcase();\n  }',
  "page showcase render call");
write("assets/js/profile-page-v8.js", page);

// profile-card-edit-v7.js from v6
let editor = read("assets/js/profile-card-edit-v6.js");
editor = mustReplace(editor,
  '  const titlePicker = document.getElementById("editorTitlePicker");',
  '  const titlePicker = document.getElementById("editorTitlePicker");\n  const showcasePicker = document.getElementById("editorShowcasePicker");',
  "editor showcase picker const");
editor = mustReplace(editor,
  '    coins: { label: "코인 보유 수량", description: "공개할 코인을 직접 선택" }',
  '    coins: { label: "코인 보유 수량", description: "공개할 코인을 직접 선택" },\n    flea_showcase: { label: "플리마켓 자랑 아이템", description: "선택한 보유 아이템을 프로필 카드에 표시" }',
  "editor card blocks");
editor = mustReplace(editor,
`  const DEFAULT_LAYOUT = {
    version: 5,
    order: [...CARD_KEYS],
    visible: Object.fromEntries(CARD_KEYS.map((key) => [key, true])),
    settings: { gold_display: "count", coin_codes: [...COIN_CODES] }
  };`,
`  const DEFAULT_LAYOUT = {
    version: 6,
    order: [...CARD_KEYS],
    visible: { photo: true, nickname: true, title: true, assets: true, gold: true, coins: true, flea_showcase: false },
    settings: { gold_display: "count", coin_codes: [...COIN_CODES] }
  };`,
  "editor default layout");
editor = mustReplace(editor,
  '  let achievementTitles = [];',
  '  let achievementTitles = [];\n  let fleaItems = [];\n  let savingShowcase = false;',
  "editor flea state");
editor = editor.replace('else visible[key] = true;', 'else if (key === "flea_showcase") visible[key] = false;\n      else visible[key] = true;');
editor = editor.replace(/version: 5,/g, 'version: 6,');
editor = mustReplace(editor,
  '  function renderProfileValues() {',
`  function renderFleaShowcase() {
    const root = document.getElementById("profileFleaShowcase");
    if (!root) return;
    root.replaceChildren();
    const items = Array.isArray(profile?.showcase_items) ? profile.showcase_items : [];
    if (!items.length) {
      const empty = document.createElement("span");
      empty.className = "profile-showcase-empty";
      empty.textContent = "등록된 아이템 없음";
      root.append(empty);
      return;
    }
    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "profile-showcase-item";
      const name = document.createElement("strong");
      name.textContent = item.name || "플리마켓 아이템";
      const value = document.createElement("span");
      value.textContent = won(item.current_value || 0);
      card.append(name, value);
      root.append(card);
    });
  }

  function renderProfileValues() {`,
  "editor showcase render function");
editor = mustReplace(editor,
  '    renderGoldValue();\n    renderCoins();\n  }',
  '    renderGoldValue();\n    renderCoins();\n    renderFleaShowcase();\n  }',
  "editor showcase value call");
editor = mustReplace(editor,
  '    renderGoldValue();\n    renderCoins();\n    applyLayout(draftLayout);',
  '    renderGoldValue();\n    renderCoins();\n    renderFleaShowcase();\n    applyLayout(draftLayout);',
  "editor showcase render editor call");
editor = mustReplace(editor,
  '  async function refreshProfileData() {',
`  function renderShowcasePicker() {
    if (!showcasePicker) return;
    showcasePicker.replaceChildren();
    if (!fleaItems.length) {
      const empty = document.createElement("div");
      empty.className = "profile-editor-empty";
      empty.textContent = "현재 보유 중인 플리마켓 아이템이 없습니다.";
      showcasePicker.append(empty);
      return;
    }
    const selected = new Set(fleaItems.filter((item) => item.is_showcased).map((item) => item.id));
    fleaItems.forEach((item) => {
      const row = document.createElement("label");
      row.className = "profile-editor-option profile-showcase-picker-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = selected.has(item.id);
      const info = document.createElement("div");
      info.className = "profile-editor-option-info";
      const name = document.createElement("strong");
      name.textContent = item.name || "플리마켓 아이템";
      const value = document.createElement("small");
      value.textContent = won(item.current_value || 0);
      info.append(name, value);
      input.addEventListener("change", async () => {
        if (savingShowcase) return;
        const next = new Set(fleaItems.filter((entry) => entry.is_showcased).map((entry) => entry.id));
        if (input.checked) next.add(item.id); else next.delete(item.id);
        if (next.size > 6) {
          input.checked = false;
          setStatus("자랑 아이템은 최대 6개까지 선택할 수 있습니다.", "error");
          return;
        }
        savingShowcase = true;
        [...showcasePicker.querySelectorAll("input")].forEach((node) => { node.disabled = true; });
        try {
          const ids = fleaItems.filter((entry) => next.has(entry.id)).map((entry) => entry.id);
          const { error } = await auth.client.rpc("set_sd_flea_showcase", { p_item_ids: ids });
          if (error) throw error;
          await Promise.all([refreshProfileData(), refreshFleaItems()]);
          renderShowcasePicker();
          notifyProfileContentSaved();
          setStatus("플리마켓 자랑 아이템을 저장했습니다.", "success");
        } catch (error) {
          input.checked = !input.checked;
          setStatus(auth.messageForError(error), "error");
        } finally {
          savingShowcase = false;
          [...showcasePicker.querySelectorAll("input")].forEach((node) => { node.disabled = false; });
        }
      });
      row.append(input, info);
      showcasePicker.append(row);
    });
  }

  async function refreshFleaItems() {
    const { data, error } = await auth.client.rpc("list_my_sd_flea_items");
    if (error) throw error;
    fleaItems = Array.isArray(data?.items) ? data.items : [];
  }

  async function refreshProfileData() {`,
  "editor showcase picker functions");
editor = mustReplace(editor,
`  async function loadCustomizationData() {
    try {
      await refreshShopData();
      renderAvatarPicker();
      renderTitlePicker();`,
`  async function loadCustomizationData() {
    try {
      await Promise.all([refreshShopData(), refreshFleaItems()]);
      renderAvatarPicker();
      renderTitlePicker();
      renderShowcasePicker();`,
  "editor customization load");
editor = editor.replace('프로필 사진 또는 칭호 목록을 불러오지 못했습니다. 다시 열어 주세요.', '프로필 사진, 칭호 또는 플리마켓 아이템 목록을 불러오지 못했습니다. 다시 열어 주세요.');
write("assets/js/profile-card-edit-v7.js", editor);

// showcase CSS
write("assets/css/profile-showcase-card.css", `.profile-card-showcase-module{grid-column:1/-1}\n.profile-flea-showcase-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px}\n.profile-showcase-item{min-width:0;border:1px solid rgba(148,163,184,.2);border-radius:12px;background:rgba(15,23,42,.45);padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px}\n.profile-showcase-item strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.9rem}\n.profile-showcase-item span{flex:0 0 auto;font-size:.8rem;color:#cbd5e1}\n.profile-showcase-empty{font-size:.85rem;color:#94a3b8}\n.profile-showcase-picker-option{cursor:pointer}\n.profile-showcase-picker-option>input{width:18px;height:18px;flex:0 0 auto;accent-color:#38bdf8}\n@media(max-width:640px){.profile-flea-showcase-grid{grid-template-columns:1fr}.profile-showcase-item{padding:9px 10px}}\n`);

// service worker cache refs
let sw = read("service-worker.js");
sw = sw.replace(/const CACHE_NAME = "[^"]+";/, 'const CACHE_NAME = "sd608-mobile-v28-profile-flea-showcase";');
sw = sw.replace('"./profile-card-edit.html?embed=1&v=8",', '"./profile-card-edit.html?embed=1&v=9",');
sw = sw.replace('"./assets/js/profile-page-v7.js?v=1",', '"./assets/js/profile-page-v8.js?v=1",');
sw = sw.replace('"./assets/js/profile-card-edit-v6.js?v=1",', '"./assets/js/profile-card-edit-v7.js?v=1",');
sw = sw.replace('"./assets/css/profile-editor-content.css?v=1",', '"./assets/css/profile-editor-content.css?v=1",\n  "./assets/css/profile-showcase-card.css?v=1",');
write("service-worker.js", sw);

console.log("Profile flea showcase card patch generated");
