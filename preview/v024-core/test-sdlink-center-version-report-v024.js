"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  REPORT_TTL_MS,
  patchIntegratedSdLinkCenterVersionReport,
  readCenterRuntimeIdentity,
} = require("./sdlink-center-version-report");

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "center-version-report-"));
  try {
    const centerRoot = path.join(temp, "center");
    const childRoot = path.join(temp, "child");
    fs.mkdirSync(path.join(centerRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(childRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(centerRoot, "package.json"), JSON.stringify({ version: "2.9.1", main: "main.js" }), "utf8");
    fs.writeFileSync(path.join(centerRoot, "main.js"), "console.log('center-version-test');\n", "utf8");
    fs.writeFileSync(path.join(childRoot, "src", "sync-engine.js"), `
class SyncEngine {
  constructor({ auth, syncState }) { this.auth = auth; this.syncState = syncState; }
  async pushLocalTransactions() { return { pushed: 1 }; }
  async pullRemoteTransactions() { return { pulled: 0 }; }
}
module.exports = { SyncEngine };
`, "utf8");

    const identity = readCenterRuntimeIdentity(centerRoot);
    assert.equal(identity.version, "2.9.1");
    const expectedHash = crypto.createHash("sha256").update(fs.readFileSync(path.join(centerRoot, "main.js"))).digest("hex").slice(0, 16);
    assert.equal(identity.buildId, `main-${expectedHash}`);

    process.env.SD_CENTER_LINK_INTEGRATED = "1";
    const now = 1_800_000_000_000;
    const patched = patchIntegratedSdLinkCenterVersionReport(childRoot, { centerRoot, now });
    assert.equal(patched.ok, true);
    assert.equal(patched.patched, true);
    assert.equal(patchIntegratedSdLinkCenterVersionReport(childRoot, { centerRoot, now }).reason, "already-patched");

    const calls = [];
    let reportFails = false;
    const auth = {
      async rpc(name, body) {
        calls.push({ name, body });
        if (name === "sd_core_register_device") return { device_id: "11111111-1111-4111-8111-111111111111" };
        if (name === "sd_core_report_center_version") {
          if (reportFails) throw Object.assign(new Error("telemetry unavailable"), { code: "PGRST202" });
          return { ok: true };
        }
        throw new Error(`unexpected RPC: ${name}`);
      }
    };
    const meta = new Map();
    const syncState = {
      getMeta(key, fallback = "") { return meta.has(key) ? meta.get(key) : fallback; },
      setMeta(key, value) { meta.set(key, value); },
    };
    const { SyncEngine } = require(path.join(childRoot, "src", "sync-engine.js"));
    const engine = new SyncEngine({ auth, syncState });
    const config = { deviceKey: "a".repeat(64), deviceName: "Version Test PC" };

    const pushed = await engine.pushLocalTransactions(config, 0);
    assert.equal(pushed.pushed, 1);
    const report = calls.find((item) => item.name === "sd_core_report_center_version");
    assert.ok(report);
    assert.equal(report.body.p_center_version, "2.9.1");
    assert.equal(report.body.p_build_id, identity.buildId);

    calls.length = 0;
    await engine.pullRemoteTransactions(config, 0);
    assert.equal(calls.length, 0, "same runtime must not re-report within TTL");

    // A fresh engine with telemetry failure must still execute wallet sync methods.
    reportFails = true;
    const failingState = new Map();
    const engine2 = new SyncEngine({
      auth,
      syncState: {
        getMeta(key, fallback = "") { return failingState.has(key) ? failingState.get(key) : fallback; },
        setMeta(key, value) { failingState.set(key, value); },
      }
    });
    const stillPushed = await engine2.pushLocalTransactions({ ...config, deviceKey: "b".repeat(64) }, 0);
    assert.equal(stillPushed.pushed, 1, "version report failure must not block wallet sync");

    assert.equal(REPORT_TTL_MS, 6 * 60 * 60 * 1000);
    console.log("SD Center version report runtime v1 regression PASS");
  } finally {
    delete process.env.SD_CENTER_LINK_INTEGRATED;
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
