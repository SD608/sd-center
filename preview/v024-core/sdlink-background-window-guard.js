"use strict";

const SD_LINK_AUTO_START_ARGUMENT = "--sd-link-auto-start";

function createSdLinkBackgroundWindowGuard({ app, argv = process.argv } = {}) {
  const args = Array.isArray(argv) ? argv : [];
  const background = args.includes(SD_LINK_AUTO_START_ARGUMENT);
  let managerWindowAllowed = !background;
  const guardedWindows = new WeakSet();

  function guardWindow(window) {
    if (!background || !window || guardedWindows.has(window)) return;
    if (typeof window.show !== "function") return;

    const originalShow = window.show.bind(window);
    guardedWindows.add(window);

    window.show = (...showArgs) => {
      if (!managerWindowAllowed) {
        try {
          if (typeof window.hide === "function") window.hide();
        } catch {}
        return undefined;
      }
      return originalShow(...showArgs);
    };

    try {
      if (typeof window.hide === "function") window.hide();
    } catch {}
  }

  if (background && app && typeof app.on === "function") {
    app.on("browser-window-created", (_event, window) => guardWindow(window));
  }

  return {
    background,
    allowManagerWindow() {
      managerWindowAllowed = true;
    },
    isManagerWindowAllowed() {
      return managerWindowAllowed;
    },
    guardWindow,
  };
}

module.exports = {
  SD_LINK_AUTO_START_ARGUMENT,
  createSdLinkBackgroundWindowGuard,
};
