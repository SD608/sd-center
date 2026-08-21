import base64
import re
import struct
import sys
import zlib

patch_path = sys.argv[1] if len(sys.argv) > 1 else "tools/patch-center-ui-v020.js"
source = open(patch_path, "r", encoding="utf-8").read()
match = re.search(r'"uiBlock":"([A-Za-z0-9+/=]+)"', source)
if not match:
    raise SystemExit("uiBlock payload missing")
encoded = match.group(1)
print(f"uiBlock encoded length={len(encoded)} mod4={len(encoded)%4}")


def inflate_prefix(data: bytes):
    if len(data) < 18 or data[:2] != b"\x1f\x8b":
        return -1, -1, b"", None, None
    # Historical payloads use a plain 10-byte gzip header (FLG=0).
    if data[3] != 0:
        return -1, -1, b"", None, None
    body = data[10:-8]
    footer_crc, footer_size = struct.unpack("<II", data[-8:])
    d = zlib.decompressobj(-15)
    out = bytearray()
    for i, byte in enumerate(body):
        try:
            out.extend(d.decompress(bytes([byte])))
        except zlib.error:
            return len(out), i, bytes(out), footer_crc, footer_size
    try:
        out.extend(d.flush())
    except zlib.error:
        pass
    return len(out), len(body), bytes(out), footer_crc, footer_size

results = []
for index in range(len(encoded)):
    repaired = encoded[:index] + encoded[index+1:]
    try:
        data = base64.b64decode(repaired, validate=True)
    except Exception:
        continue
    prefix_len, error_at, prefix, crc, isize = inflate_prefix(data)
    if prefix_len < 0:
        continue
    results.append((prefix_len, error_at, index, encoded[index], crc, isize, prefix))

results.sort(key=lambda row: (row[0], row[1]), reverse=True)
if not results:
    raise SystemExit("no structurally valid deletion candidates")

print("TOP_DELETION_CANDIDATES")
for prefix_len, error_at, index, removed, crc, isize, _ in results[:20]:
    print(
        f"index={index} removed={removed!r} prefix={prefix_len} "
        f"deflate_error_at={error_at} footer_crc={crc:08x} footer_isize={isize}"
    )

best = results[0]
prefix_len, error_at, index, removed, crc, isize, prefix = best
print(
    f"V020_UI_BEST_DELETION index={index} removed={removed!r} "
    f"prefix={prefix_len} deflate_error_at={error_at} footer_crc={crc:08x} footer_isize={isize}"
)
preview = prefix[-1200:].decode("utf-8", errors="replace")
print("V020_UI_PREFIX_TAIL_BEGIN")
print(preview)
print("V020_UI_PREFIX_TAIL_END")
