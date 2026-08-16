from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

VERSION = "1.2.8"
MARKER = "SD_LINK_BACKGROUND_AUTOSTART_V128"
AUTO_ARG = "--sd-link-auto-start"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: patch-sdlink-v128-autostart.py <input.zip> <output.zip>")

    source = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2]).resolve()
    if not source.is_file():
        raise FileNotFoundError(source)

    with tempfile.TemporaryDirectory(prefix="sdlink-v128-") as temp_name:
        temp = Path(temp_name)
        with zipfile.ZipFile(source, "r") as archive:
            archive.extractall(temp)

        package_candidates = sorted(
            [
                p
                for p in temp.rglob("package.json")
                if "node_modules" not in {part.lower() for part in p.parts}
            ],
            key=lambda p: len(p.relative_to(temp).parts),
        )
        if not package_candidates:
            raise RuntimeError("package.json not found in SD Link ZIP")

        package_path = package_candidates[0]
        app_root = package_path.parent
        package = load_json(package_path)
        package["version"] = VERSION
        write_json(package_path, package)

        manifest_path = app_root / "sd-app.json"
        manifest = load_json(manifest_path) if manifest_path.exists() else {}
        manifest["id"] = manifest.get("id") or "sdlink-desktop"
        if manifest["id"] != "sdlink-desktop":
            raise RuntimeError(f"Unexpected SD Link id: {manifest['id']}")
        manifest["version"] = VERSION
        manifest["displayVersion"] = f"Stage 1 · v{VERSION}"
        manifest["improvement"] = "Windows 로그인 시 SD종합센터와 함께 자동 실행되고 시작 창은 숨긴 채 백그라운드·트레이에서 동기화합니다."
        write_json(manifest_path, manifest)

        main_name = str(manifest.get("entry") or package.get("main") or "main.js")
        main_path = app_root / main_name
        if not main_path.is_file():
            raise RuntimeError(f"SD Link main file not found: {main_name}")

        main_source = main_path.read_text(encoding="utf-8")
        if MARKER not in main_source:
            patch = r'''

// SD_LINK_BACKGROUND_AUTOSTART_V128
// SD종합센터가 Windows 로그인 자동 시작으로 실행했을 때 SD Link 창을 띄우지 않고
// 기존 트레이/백그라운드 동기화 동작을 그대로 유지합니다.
const {
  app: SdLinkAutoStartApp,
  BrowserWindow: SdLinkAutoStartBrowserWindow,
} = require("electron");
const SD_LINK_AUTO_START_ARGUMENT = "--sd-link-auto-start";
const SD_LINK_STARTED_FROM_WINDOWS_LOGIN = process.argv.includes(
  SD_LINK_AUTO_START_ARGUMENT,
);

if (SD_LINK_STARTED_FROM_WINDOWS_LOGIN) {
  const hideAutoStartedWindow = (window) => {
    if (!window || window.isDestroyed()) return;
    try {
      window.hide();
    } catch {}
  };

  SdLinkAutoStartApp.on("browser-window-created", (_event, window) => {
    hideAutoStartedWindow(window);
    window.once("ready-to-show", () => hideAutoStartedWindow(window));
    setTimeout(() => hideAutoStartedWindow(window), 150);
    setTimeout(() => hideAutoStartedWindow(window), 900);
  });

  SdLinkAutoStartApp.whenReady()
    .then(() => {
      const hideAll = () => {
        for (const window of SdLinkAutoStartBrowserWindow.getAllWindows()) {
          hideAutoStartedWindow(window);
        }
      };
      hideAll();
      setTimeout(hideAll, 250);
      setTimeout(hideAll, 1200);
    })
    .catch(() => {});
}
'''
            main_source = main_source.rstrip() + patch + "\n"
            main_path.write_text(main_source, encoding="utf-8")

        if shutil.which("node"):
            subprocess.run(["node", "--check", str(main_path)], check=True)

        output.parent.mkdir(parents=True, exist_ok=True)
        if output.exists():
            output.unlink()

        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for item in sorted(temp.rglob("*")):
                if item.is_file():
                    archive.write(item, item.relative_to(temp).as_posix())

    with zipfile.ZipFile(output, "r") as archive:
        names = archive.namelist()
        package_name = next(
            name for name in names if name.endswith("package.json") and "/node_modules/" not in f"/{name}"
        )
        package = json.loads(archive.read(package_name).decode("utf-8"))
        if package.get("version") != VERSION:
            raise RuntimeError("Output SD Link package version mismatch")
        main_name = str(package.get("main") or "main.js")
        root = Path(package_name).parent.as_posix()
        zipped_main = f"{root}/{main_name}" if root not in ("", ".") else main_name
        main_text = archive.read(zipped_main).decode("utf-8")
        if MARKER not in main_text or AUTO_ARG not in main_text:
            raise RuntimeError("Output SD Link auto-start marker missing")

    print(f"Created {output} ({output.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
