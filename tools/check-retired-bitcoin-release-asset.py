#!/usr/bin/env python3
"""Read-only Release Gate: retired Bitcoin ZIP must not remain publicly attached."""
from __future__ import annotations

import json
import os
import urllib.request

API_URL = "https://api.github.com/repos/SD608/sd-center/releases/tags/v.2.2.1"
TARGET = "SDBitcoinMiner_v1.2.2_Desktop.zip"

headers = {"Accept": "application/vnd.github+json", "User-Agent": "SDCenter-Bitcoin-Retirement-Gate"}
token = os.environ.get("GITHUB_TOKEN")
if token:
    headers["Authorization"] = f"Bearer {token}"
request = urllib.request.Request(API_URL, headers=headers)
with urllib.request.urlopen(request, timeout=20) as response:
    release = json.load(response)

remaining = [asset for asset in release.get("assets", []) if asset.get("name") == TARGET]
if remaining:
    asset = remaining[0]
    raise SystemExit(
        "BLOCKED: Bitcoin ZIP is still a GitHub Release attachment "
        f"(asset id {asset.get('id')}). Remove this attachment only, "
        "preserving other release files, then rerun this gate."
    )

assert release.get("tag_name") == "v.2.2.1", "unexpected release tag"
print("PASS: retired Bitcoin ZIP is absent from the official v.2.2.1 Release assets")
