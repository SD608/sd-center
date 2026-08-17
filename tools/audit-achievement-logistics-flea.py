from __future__ import annotations

import re
import zipfile
from pathlib import Path

ROOT = Path.cwd()
OUT = ROOT / "diagnostics" / "achievement-logistics-flea-audit.txt"
PACKAGES = [
    ROOT / "downloads/extensions/SDFleaMarket_v1.1.3_Desktop.zip",
    ROOT / "downloads/extensions/SDLink_v1.2.8_Desktop.zip",
    ROOT / "downloads/extensions/SDLogisticsCenter_Season0_Desktop.zip",
    ROOT / "downloads/extensions/SDBitcoinMiner_v1.2.2_Desktop.zip",
    ROOT / "downloads/extensions/SDMiner_v1.1.1_Desktop.zip",
    ROOT / "downloads/extensions/SDMukjippa_Version1_1_Desktop.zip",
    ROOT / "downloads/extensions/SDSlot_Stage7_Desktop.zip",
    ROOT / "downloads/extensions/SDOddEven_v1.1.1_Desktop.zip",
    ROOT / "downloads/extensions/SDVault_v1.2.1_Desktop.zip",
    ROOT / "downloads/extensions/STA_Version6_Desktop.zip",
]

PATTERNS = [
    r"logistics", r"headquarters", r"본부", r"S등급", r"rank", r"unlock",
    r"sd[_-]?link", r"supabase", r"device", r"wallet", r"localStorage",
    r"bank", r"은행", r"WebGL", r"THREE", r"canvas", r"renderer", r"camera",
    r"AmbientLight", r"DirectionalLight", r"disableHardwareAcceleration", r"gpu",
    r"mission3D", r"bank-finale", r"achievement", r"업적",
]
RX = re.compile("|".join(f"(?:{p})" for p in PATTERNS), re.I)
TEXT_EXT = {".js", ".mjs", ".cjs", ".html", ".json", ".css", ".txt", ".md"}


def decode(data: bytes) -> str | None:
    for enc in ("utf-8", "utf-8-sig", "cp949"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            pass
    return None


def compact(line: str, limit: int = 320) -> str:
    line = line.replace("\t", "  ").strip()
    return line if len(line) <= limit else line[:limit] + "…"


def audit_zip(path: Path) -> list[str]:
    rows = [f"\n===== {path.name} ====="]
    if not path.is_file():
        rows.append("MISSING")
        return rows
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        rows.append(f"files={len(names)} bytes={path.stat().st_size}")
        for name in names:
            suffix = Path(name).suffix.lower()
            if suffix not in TEXT_EXT or "/node_modules/" in f"/{name.lower()}":
                continue
            try:
                text = decode(z.read(name))
            except Exception:
                continue
            if not text or not RX.search(text):
                continue
            matches = []
            for i, line in enumerate(text.splitlines(), 1):
                if RX.search(line):
                    matches.append(f"{i}: {compact(line)}")
                    if len(matches) >= 80:
                        matches.append("... match limit reached ...")
                        break
            if matches:
                rows.append(f"\n-- {name} --")
                rows.extend(matches)
    return rows


def main() -> None:
    lines = [
        "SD integration audit",
        "Purpose: achievements + logistics→flea unlock + flea bank 3D black-screen diagnostics",
    ]
    for package in PACKAGES:
        lines.extend(audit_zip(package))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(OUT.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
