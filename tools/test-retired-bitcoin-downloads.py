#!/usr/bin/env python3
"""Prevent re-publishing the retired SD Bitcoin Miner from the official store."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REMOVED_PACK = "sd-bitcoin-miner"
ORIGINAL_IDS = {
    "sd-link", "sd-logistics-center", "vault", "odd-even", "miner",
    "sd-slot", "sd-mukjippa", "sta", "sd-flea-market"
}

for name in ("extensions-data.js", "assets/js/extensions-data.js"):
    source = (ROOT / name).read_text(encoding="utf-8")
    assert REMOVED_PACK not in source, f"{name} still advertises Bitcoin"
    ids = set(__import__("re").findall(r'"id":\s*"([^"]+)"', source))
    assert ids == ORIGINAL_IDS, f"{name}: unexpected expansion IDs: {ids ^ ORIGINAL_IDS}"

catalog = json.loads((ROOT / "update/extensions-catalog.json").read_text(encoding="utf-8"))
apps = catalog["apps"]
assert "bitcoin" not in apps, "official update catalog still advertises Bitcoin"
assert len(apps) == len(ORIGINAL_IDS), "other official updates must be preserved"

zip_dir = ROOT / "downloads" / "extensions"
assert not list(zip_dir.glob("SDBitcoinMiner*.zip")), "public Bitcoin ZIP still in website assets"

print("PASS: Bitcoin removed from both stores, update catalog and Pages archives")
print("NOTICE: GitHub Release assets require separate deletion and external 404 verification")
