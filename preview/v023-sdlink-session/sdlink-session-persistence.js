"use strict";

const path = require("node:path");

const PATCH_MARK = Symbol.for("sdcenter.sdlink.session-persistence.v023");

function patchIntegratedSdLinkAuthSession(childDirectory) {
  if (process.env.SD_CENTER_LINK_INTEGRATED !== "1") {
    return { ok: false, reason: "not-integrated" };
  }

  const authServicePath = path.join(childDirectory, "src", "auth-service.js");
  let authModule;
  try {
    authModule = require(authServicePath);
  } catch (error) {
    return { ok: false, reason: "auth-service-unavailable", error: error?.message || String(error) };
  }

  const AuthService = authModule?.AuthService;
  const proto = AuthService?.prototype;
  if (!proto || typeof proto.mapSession !== "function" || typeof proto.persist !== "function") {
    return { ok: false, reason: "unsupported-auth-service" };
  }
  if (proto[PATCH_MARK]) return { ok: true, alreadyPatched: true };

  const originalMapSession = proto.mapSession;
  proto.mapSession = function integratedMapSession(data, email, remember) {
    const session = originalMapSession.call(this, data, email, true);
    if (session && typeof session === "object") session.remember = true;
    return session;
  };

  const originalPersist = proto.persist;
  proto.persist = function integratedPersist() {
    if (this.session && typeof this.session === "object") this.session.remember = true;
    return originalPersist.call(this);
  };

  if (typeof proto.loadSession === "function") {
    const originalLoadSession = proto.loadSession;
    proto.loadSession = function integratedLoadSession() {
      const session = originalLoadSession.call(this);
      if (session && typeof session === "object") session.remember = true;
      return session;
    };
  }

  Object.defineProperty(proto, PATCH_MARK, { value: true });
  return { ok: true, forcedPersistence: true };
}

module.exports = { patchIntegratedSdLinkAuthSession };
