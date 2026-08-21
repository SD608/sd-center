from __future__ import annotations

import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path('.')
CATALOG = ROOT / 'update/extensions-catalog.json'
POLICY = ROOT / 'update/desktop-policy.json'
EXT_DIR = ROOT / 'downloads/extensions'
OUT_DIR = ROOT / 'artifacts/extension-integrity'


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def file_from_url(url: str) -> Path | None:
    name = Path(urlparse(str(url or '')).path).name
    if not name.lower().endswith('.zip'):
        return None
    candidate = EXT_DIR / name
    return candidate if candidate.is_file() else None


def main() -> None:
    catalog = json.loads(CATALOG.read_text(encoding='utf-8'))
    policy = json.loads(POLICY.read_text(encoding='utf-8'))
    report = {'catalog': {}, 'policy': {}}
    failures: list[str] = []

    for app_id, rule in catalog.get('apps', {}).items():
        path = file_from_url(rule.get('downloadUrl', ''))
        if path is None:
            failures.append(f'catalog {app_id}: local ZIP missing for {rule.get("downloadUrl")}')
            continue
        digest = sha256(path)
        pinned = str(rule.get('sha256') or '').lower()
        report['catalog'][app_id] = {
            'version': str(rule.get('version') or ''),
            'file': path.name,
            'sha256': digest,
            'catalogSha256': pinned,
            'pinMatch': bool(pinned and pinned == digest),
        }
        if pinned and pinned != digest:
            failures.append(f'catalog {app_id}: SHA pin mismatch')

    for app_id, rule in policy.get('apps', {}).items():
        if not rule.get('required'):
            continue
        path = file_from_url(rule.get('downloadUrl', ''))
        if path is None:
            failures.append(f'policy {app_id}: local ZIP missing for {rule.get("downloadUrl")}')
            continue
        digest = sha256(path)
        pinned = str(rule.get('sha256') or '').lower()
        report['policy'][app_id] = {
            'minVersion': str(rule.get('minVersion') or ''),
            'file': path.name,
            'sha256': digest,
            'policySha256': pinned,
            'pinMatch': bool(pinned and pinned == digest),
        }
        if pinned and pinned != digest:
            failures.append(f'policy {app_id}: SHA pin mismatch')

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / 'extension-integrity-report.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
    )

    catalog_pinned = sum(1 for row in report['catalog'].values() if row['pinMatch'])
    policy_pinned = sum(1 for row in report['policy'].values() if row['pinMatch'])
    print(f'catalog integrity pins: {catalog_pinned}/{len(report["catalog"])}')
    print(f'required-policy integrity pins: {policy_pinned}/{len(report["policy"])}')
    for app_id, row in report['catalog'].items():
        print(f'catalog {app_id} {row["version"]} {row["file"]} sha256={row["sha256"]}')
    for app_id, row in report['policy'].items():
        print(f'policy {app_id} >= {row["minVersion"]} {row["file"]} sha256={row["sha256"]}')

    if failures:
        raise SystemExit('\n'.join(failures))


if __name__ == '__main__':
    main()
