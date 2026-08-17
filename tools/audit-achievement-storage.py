from __future__ import annotations

import re
import zipfile
from pathlib import Path

ROOT=Path.cwd()
OUT=ROOT/'diagnostics/achievement-storage-audit.txt'
PACKAGES=sorted((ROOT/'downloads/extensions').glob('*.zip'))
KEEP_NAMES=('state','stats','history','result','game','wallet','database','store','setting','engine','app.js','main.js')
RX=re.compile(r'(create\s+table|insert\s+into|update\s+[a-z_]|localStorage|electron-store|state\s*=|history|streak|win|loss|profit|revenue|total|count|mine|mined|ore|slot|odd|even|muk|logistics|vault|gold|bitcoin|bank|flea)',re.I)
TABLE_RX=re.compile(r'CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+[`"\[]?([A-Za-z0-9_]+)',re.I)


def decode(b):
    for e in ('utf-8','utf-8-sig','cp949'):
        try:return b.decode(e)
        except UnicodeDecodeError:pass
    return None


def main():
    rows=['SD achievement storage audit','Generated from current extension ZIPs.']
    for p in PACKAGES:
        # current-ish packages only, skip old duplicate versions unless latest named paths below
        if any(old in p.name for old in ('SDFleaMarket_v1.0.','SDFleaMarket_v1.1.1','SDFleaMarket_v1.1.2','SDFleaMarket_v1.1.3','SDBitcoinMiner_v1.2.0','SDBitcoinMiner_v1.2.1','SDLink_Stage1','SDLink_v1.1.1','SDLink_v1.2.0','SDLink_v1.2.1','SDLink_v1.2.2','SDLink_v1.2.3','SDLink_v1.2.4','SDLink_v1.2.7')):
            continue
        rows.append(f'\n===== {p.name} =====')
        try:z=zipfile.ZipFile(p)
        except Exception as e:
            rows.append(f'ERROR {e}');continue
        with z:
            tables=set()
            matches=[]
            for name in z.namelist():
                low=name.lower()
                if '/node_modules/' in '/'+low or Path(name).suffix.lower() not in {'.js','.cjs','.mjs','.json','.html'}:continue
                try:text=decode(z.read(name))
                except Exception:continue
                if not text:continue
                tables.update(TABLE_RX.findall(text))
                if not RX.search(text):continue
                selected=[]
                for i,line in enumerate(text.splitlines(),1):
                    if RX.search(line):
                        s=line.strip().replace('\t','  ')
                        if len(s)>280:s=s[:280]+'…'
                        selected.append(f'{i}: {s}')
                        if len(selected)>=55:break
                if selected:
                    matches.append((name,selected))
            rows.append('tables='+(', '.join(sorted(tables)) if tables else '(none found in source)'))
            for name,selected in matches:
                rows.append(f'\n-- {name} --')
                rows.extend(selected)
    OUT.write_text('\n'.join(rows)+'\n',encoding='utf-8')
    print(OUT)

if __name__=='__main__':main()
