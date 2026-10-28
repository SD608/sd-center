"use strict";
// Isolated POLICY CONTRACT ONLY. This module does not spawn, authenticate,
// connect to SD Core or read Center userData. Production use is forbidden.
const path = require("node:path");
const crypto = require("node:crypto");
const ALLOWED_APP_ID = "miner-unity";
function deny(reason) { return Object.freeze({ ok:false, state:"NOT_CONNECTED", reason }); }
function isDigest(v) { return typeof v==="string" && /^[a-f0-9]{64}$/.test(v); }
function equalHex(a,b) {
 if (!isDigest(a)||!isDigest(b)) return false;
 return crypto.timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}
function confinedWindowsFile({installedRoot,exePath}) {
 if(typeof installedRoot!=="string"||typeof exePath!=="string"||!installedRoot||!exePath) return false;
 if(!path.win32.isAbsolute(installedRoot)||!path.win32.isAbsolute(exePath)) return false;
 const root=path.win32.resolve(installedRoot),exe=path.win32.resolve(exePath);
 const rel=path.win32.relative(root,exe);
 return Boolean(rel)&&rel!=="."&&!rel.startsWith(".."+path.win32.sep)&&rel!==".."&&!path.win32.isAbsolute(rel);
}
/**
 * DRAFT trusted backend input contract.
 * Verifiers must execute inside trusted Center/server code, NOT Unity, preload,
 * a user-controlled callback, an app config, or an editable SDK fixture.
 * Inspect only. Do not spawn a process or issue any real session.
 */
function assessUnityLaunch(input={},trusted={}) {
 if(input?.appId!==ALLOWED_APP_ID) return deny("APP_NOT_APPROVED");
 if(input?.entryType!=="native-windows-exe") return deny("NATIVE_ENTRY_REQUIRED");
 if(!confinedWindowsFile(input)) return deny("EXE_OUTSIDE_MANAGED_ROOT");
 if(!String(input.exePath).toLowerCase().endsWith(".exe")) return deny("EXE_EXTENSION_REQUIRED");
 if(typeof trusted.verifyCatalog!=="function"||typeof trusted.verifySession!=="function"||typeof trusted.verifyFileIdentity!=="function") return deny("TRUSTED_VERIFIERS_MISSING");
 let manifest,session,identity;
 try {
   // Callback result is a trusted authority assertion only in a real trusted
   // implementation. Tests provide fixtures; they prove no live auth.
   manifest=trusted.verifyCatalog({appId:input.appId,version:input.version});
   identity=trusted.verifyFileIdentity({exePath:input.exePath,installedRoot:input.installedRoot});
   session=trusted.verifySession({appId:input.appId});
 } catch { return deny("AUTHORITY_VALIDATION_FAILED"); }
 if(manifest?.signedOfficial!==true||manifest?.appId!==input.appId||manifest?.entryType!=="native-windows-exe") return deny("OFFICIAL_PACKAGE_NOT_VERIFIED");
 if(!equalHex(manifest?.digest,identity?.diskSha256)) return deny("PACKAGE_DIGEST_MISMATCH");
 if(identity?.realpathConfined!==true||identity?.noSymlink===false||identity?.isRegularFile!==true) return deny("FILE_IDENTITY_NOT_VERIFIED");
 if(session?.trustedServerAttestation!==true||session?.activeDevice!==true||session?.revoked!==false||session?.scopedFor!==input.appId||session?.userId==null||session?.deviceId==null||session?.runId==null||!Number.isFinite(session?.expiresAtMs)||!Number.isFinite(trusted.nowMs)||session.expiresAtMs<=trusted.nowMs) return deny("SESSION_NOT_VERIFIED");
 return Object.freeze({ok:true,state:"POLICY_ELIGIBLE_ONLY",appId:input.appId,runId:session.runId,
  // No tokens, service_role keys, refresh credentials or email returned.
  // Eligibility is not a successful launch or a Core wallet capability.
  validUntilMs:session.expiresAtMs});
}
module.exports={assessUnityLaunch,confinedWindowsFile};
