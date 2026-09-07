from __future__ import annotations

import base64
import hashlib
import json
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path.cwd()
SOURCE = ROOT / "downloads/extensions/SDFleaMarket_v1.2.3_Desktop.zip"
SOURCE_SHA256 = "5ee869af576045fae3bc48366a8de58bdcac7bfeedad77a9a9d1d94bd5ac3e75"
SPRITE_PARTS = ROOT / "tools/flea-transparent-icons-b64"
SPRITE_SHA256 = "9d521eca5e57587581a453cca95cd915aeb8d12e6edfa1bee08c636baf337b14"
SPRITE_SIZE = (768, 576)
ICON_SIZE = (128, 96)
OUTPUT = ROOT / "diagnostics/SDFleaMarket_v1.2.3_transparent-icons-candidate.zip"
SHA_FILE = ROOT / "diagnostics/SDFleaMarket_v1.2.3_transparent-icons-candidate.sha256"
REPORT = ROOT / "diagnostics/SDFleaMarket_v1.2.3_transparent-icons-report.json"
DISPLAY_FIX_MARKER = "2026-09-07 native-size aspect-safe item artwork"

# Do not enlarge 128x96 item artwork to fill UI containers.
# Every displayed image keeps the same 4:3 ratio as the PNG source.
DISPLAY_FIX_CSS = r'''

/* 2026-09-07 native-size aspect-safe item artwork */
.item-card .inventory-item-image {
  width: 96px;
  height: 72px;
  max-width: 86%;
  max-height: 86%;
  object-fit: contain;
  object-position: center;
  image-rendering: auto;
  display: block;
}
.reward-item-image .reward-product-image {
  width: 128px;
  height: 96px;
  max-width: 90%;
  max-height: 90%;
  object-fit: contain;
  object-position: center;
  image-rendering: auto;
  display: block;
}
.dictionary-item-image .dictionary-product-image {
  width: 84px;
  height: 63px;
  max-width: 92%;
  max-height: 92%;
  padding: 0;
  object-fit: contain;
  object-position: center;
  image-rendering: auto;
  display: block;
}
.bulk-result-preview-image {
  width: 72px;
  height: 54px;
  object-fit: contain;
  object-position: center;
  image-rendering: auto;
}
.bulk-result-item-image {
  width: 48px;
  height: 36px;
  object-fit: contain;
  object-position: center;
  image-rendering: auto;
}
@media(max-width:700px){
  .item-card .inventory-item-image{width:88px;height:66px}
  .reward-item-image .reward-product-image{width:120px;height:90px}
}
'''

# Sprite order is the user-approved 6x6 sheet, read left-to-right and top-to-bottom.
ITEM_FILENAMES = [
    "ballpoint-pen.png", "paper-clips.png", "eraser.png", "ruler-15cm.png", "small-notebook.png", "keychain.png",
    "mug.png", "usb-cable.png", "wired-earphones.png", "phone-charger.png", "mini-fan.png", "usb-drive.png",
    "wireless-mouse.png", "power-bank.png", "budget-headset.png", "gamepad.png", "mechanical-keyboard.png", "brand-sneakers.png",
    "bluetooth-speaker.png", "wireless-earbuds.png", "smartwatch.png", "portable-game-console.png", "premium-headphones.png", "premium-tablet.png",
    "mirrorless-camera.png", "flagship-smartphone.png", "graphics-card.png", "red-diamond.png", "gold-ring.png", "rare-coin.png",
    "gold-necklace.png", "gold-coins.png", "luxury-watch.png", "gemstone.png", "small-gold-bar.png", "large-gold-bar.png",
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def find_package_root(extracted: Path) -> Path:
    candidates: list[Path] = []
    for package in extracted.rglob("package.json"):
        if "node_modules" in {part.lower() for part in package.parts}:
            continue
        try:
            data = json.loads(package.read_text(encoding="utf-8"))
        except Exception:
            continue
        if data.get("name") in {"sd-flea-market", "sd-flea-market-pc"}:
            candidates.append(package.parent)
    if not candidates:
        raise RuntimeError("SD flea market package root not found")
    return min(candidates, key=lambda p: len(p.parts))


def load_sprite() -> Image.Image:
    parts = sorted(SPRITE_PARTS.glob("part*.txt"))
    if len(parts) != 4:
        raise RuntimeError(f"sprite part count={len(parts)}, expected 4")
    encoded = "".join(part.read_text(encoding="ascii").strip() for part in parts)
    raw = base64.b64decode(encoded, validate=True)
    digest = hashlib.sha256(raw).hexdigest()
    if digest != SPRITE_SHA256:
        raise RuntimeError(f"sprite sha256 mismatch: {digest}")
    with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
        tmp.write(raw)
        tmp.flush()
        sprite = Image.open(tmp.name).convert("RGBA")
        sprite.load()
    if sprite.size != SPRITE_SIZE:
        raise RuntimeError(f"unexpected sprite size: {sprite.size}; expected {SPRITE_SIZE}")
    return sprite


def install_icons(package_root: Path) -> dict[str, dict[str, object]]:
    sprite = load_sprite()
    out = package_root / "public/assets/items"
    out.mkdir(parents=True, exist_ok=True)
    report: dict[str, dict[str, object]] = {}
    for index, filename in enumerate(ITEM_FILENAMES):
        col = index % 6
        row = index // 6
        icon = sprite.crop((col * ICON_SIZE[0], row * ICON_SIZE[1], (col + 1) * ICON_SIZE[0], (row + 1) * ICON_SIZE[1]))
        target = out / filename
        icon.save(target, "PNG", optimize=True)
        alpha = icon.getchannel("A")
        report[filename] = {
            "size": list(icon.size),
            "alpha_min": alpha.getextrema()[0],
            "alpha_max": alpha.getextrema()[1],
            "sha256": sha256(target),
        }
    return report


def patch_display_css(package_root: Path) -> None:
    css_path = package_root / "public/style.css"
    css = css_path.read_text(encoding="utf-8")
    # These are the v1.2.3 rules that enlarged artwork to the container dimensions.
    required_base = [
        ".inventory-item-image{width:100%;height:100%;object-fit:contain",
        ".reward-product-image{width:100%;height:100%;object-fit:contain",
        ".dictionary-product-image{width:100%;height:100%;object-fit:contain",
        ".bulk-result-preview-image{width:72px;height:58px;object-fit:contain",
        ".bulk-result-item-image{width:52px;height:40px;flex:0 0 auto;object-fit:contain",
    ]
    for marker in required_base:
        if marker not in css:
            raise RuntimeError(f"base image CSS marker missing: {marker}")
    if DISPLAY_FIX_MARKER not in css:
        css_path.write_text(css + DISPLAY_FIX_CSS, encoding="utf-8")


def validate_icons(package_root: Path) -> None:
    out = package_root / "public/assets/items"
    files = sorted(path.name for path in out.glob("*.png"))
    expected = sorted(ITEM_FILENAMES)
    if files != expected:
        missing = sorted(set(expected) - set(files))
        extra = sorted(set(files) - set(expected))
        raise RuntimeError(f"icon set mismatch: missing={missing}, extra={extra}")

    for filename in ITEM_FILENAMES:
        image = Image.open(out / filename).convert("RGBA")
        if image.size != ICON_SIZE:
            raise RuntimeError(f"{filename}: size={image.size}, expected {ICON_SIZE}")
        alpha = image.getchannel("A")
        amin, amax = alpha.getextrema()
        if amin != 0 or amax != 255:
            raise RuntimeError(f"{filename}: alpha extrema={amin, amax}, expected transparent + opaque pixels")
        for point in ((0, 0), (127, 0), (0, 95), (127, 95)):
            if alpha.getpixel(point) != 0:
                raise RuntimeError(f"{filename}: corner {point} is not transparent")


def validate_mapping_and_display_css(package_root: Path) -> None:
    app_js = (package_root / "public/app.js").read_text(encoding="utf-8")
    for filename in ITEM_FILENAMES:
        if f"assets/items/{filename}" not in app_js:
            raise RuntimeError(f"app.js mapping missing for {filename}")
    for token in (
        "dictionary-product-image", "inventory-item-image", "reward-product-image",
        "bulk-result-preview-image", "bulk-result-item-image", "itemImageHtml",
    ):
        if token not in app_js:
            raise RuntimeError(f"app.js UI token missing: {token}")

    css = (package_root / "public/style.css").read_text(encoding="utf-8")
    for token in (
        DISPLAY_FIX_MARKER,
        ".item-card .inventory-item-image",
        "width: 96px;",
        "height: 72px;",
        ".reward-item-image .reward-product-image",
        "width: 128px;",
        "height: 96px;",
        ".dictionary-item-image .dictionary-product-image",
        "width: 84px;",
        "height: 63px;",
        "image-rendering: auto;",
    ):
        if token not in css:
            raise RuntimeError(f"native-size CSS token missing: {token}")


def run_static_checks(package_root: Path) -> None:
    if not shutil.which("node"):
        raise RuntimeError("node is required for candidate static checks")
    for relative in (
        "main.js", "preload.js", "src/wallet-db.js", "src/sd-integration.js",
        "public/mission3d.js", "public/bankchase.js", "public/app.js",
    ):
        path = package_root / relative
        if path.is_file():
            subprocess.run(["node", "--check", str(path)], check=True)


def repack(package_root: Path, icon_report: dict[str, dict[str, object]]) -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    if OUTPUT.exists():
        OUTPUT.unlink()
    with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(package_root.rglob("*")):
            if path.is_file():
                archive.write(path, Path("sd-flea-market") / path.relative_to(package_root))
    digest = sha256(OUTPUT)
    SHA_FILE.write_text(f"{digest}  {OUTPUT.name}\n", encoding="utf-8")
    REPORT.write_text(json.dumps({
        "source_sha256": SOURCE_SHA256,
        "sprite_sha256": SPRITE_SHA256,
        "candidate_sha256": digest,
        "icon_count": len(icon_report),
        "icon_size": list(ICON_SIZE),
        "native_size_display_fix": True,
        "display_caps": {
            "inventory": [96, 72],
            "reward": [128, 96],
            "dictionary": [84, 63],
            "bulk_preview": [72, 54],
            "bulk_row": [48, 36],
        },
        "icons": icon_report,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"candidate={OUTPUT}")
    print(f"size={OUTPUT.stat().st_size}")
    print(f"sha256={digest}")


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"missing source package: {SOURCE}")
    actual_source_sha = sha256(SOURCE)
    if actual_source_sha != SOURCE_SHA256:
        raise SystemExit(f"source package sha256 mismatch: {actual_source_sha}")
    if not SPRITE_PARTS.is_dir():
        raise SystemExit(f"missing sprite parts: {SPRITE_PARTS}")

    with tempfile.TemporaryDirectory() as tmpdir:
        extracted = Path(tmpdir) / "extract"
        extracted.mkdir()
        with zipfile.ZipFile(SOURCE) as archive:
            archive.extractall(extracted)
        package_root = find_package_root(extracted)
        icon_report = install_icons(package_root)
        patch_display_css(package_root)
        validate_icons(package_root)
        validate_mapping_and_display_css(package_root)
        run_static_checks(package_root)
        repack(package_root, icon_report)


if __name__ == "__main__":
    main()
