"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const auth = window.SD_AUTH;
  if (!auth) return;

  const tabs = document.getElementById("profileTabs");
  const buttons = [...document.querySelectorAll("[data-profile-tab]")];
  const viewPanel = document.getElementById("profileViewTabPanel");
  const editPanel = document.getElementById("profileEditTabPanel");
  const editorFrame = document.getElementById("profileCardEditorFrame");
  const openEditButton = document.getElementById("openProfileEditTab");
  const refreshButton = document.getElementById("refreshProfile");
  const requestedUserId = new URLSearchParams(location.search).get("user") || null;
  let canEdit = false;
  let editorLoaded = false;
  let editorDirty = false;

  function loadEditor() {
    if (!editorFrame || editorLoaded) return;
    const src = editorFrame.dataset.src;
    if (!src) return;
    editPanel?.classList.add("is-loading");
    editorFrame.src = src;
    editorLoaded = true;
  }

  function activateTab(name, options = {}) {
    if (name === "edit" && !canEdit) name = "view";
    const isEdit = name === "edit";

    buttons.forEach((button) => {
      const active = button.dataset.profileTab === name;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });

    if (viewPanel) viewPanel.hidden = isEdit;
    if (editPanel) editPanel.hidden = !isEdit;
    if (isEdit) loadEditor();

    if (!options.skipHash) {
      const url = new URL(location.href);
      url.hash = isEdit ? "profile-edit" : "profile-view";
      history.replaceState(null, "", url);
    }

    if (options.scroll !== false) {
      tabs?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.profileTab));
  });
  openEditButton?.addEventListener("click", () => activateTab("edit"));

  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== editorFrame?.contentWindow) return;
    const message = event.data || {};

    if (message.type === "sd-profile-card-editor-height") {
      const height = Math.max(680, Math.min(1800, Number(message.height || 0)));
      if (height && editorFrame) editorFrame.style.height = `${height}px`;
      editPanel?.classList.remove("is-loading");
      return;
    }

    if (message.type === "sd-profile-card-editor-dirty") {
      editorDirty = Boolean(message.dirty);
      return;
    }

    if (message.type === "sd-profile-card-layout-saved") {
      editorDirty = false;
      refreshButton?.click();
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!editorDirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  try {
    const session = await auth.requireSession();
    if (!session) return;
    const { data, error } = await auth.client.rpc("get_sd_public_profile", { p_user_id: requestedUserId });
    if (error) throw error;
    canEdit = Boolean(data?.created && data?.is_me);
    tabs.hidden = !canEdit;
    if (!canEdit) return;

    const initialTab = location.hash === "#profile-edit" ? "edit" : "view";
    activateTab(initialTab, { skipHash: true, scroll: false });
  } catch (_) {
    tabs.hidden = true;
  }
});
