"use strict";

class TrustedTimeProvider {
  async nowUtc() { throw new Error("TRUSTED_TIME_PROVIDER_NOT_CONFIGURED"); }
}

class UnavailableTrustedTimeProvider extends TrustedTimeProvider {
  async nowUtc() { return null; }
}

module.exports = { TrustedTimeProvider, UnavailableTrustedTimeProvider };
