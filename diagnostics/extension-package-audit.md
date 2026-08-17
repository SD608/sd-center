# 확장팩 전환 패키지 점검

- 카탈로그 버전: 21
- 검사 앱: 10개
- 오류 발견: 3개
- 경고 발견: 3개

## SD Link (sdlink-desktop) v1.2.8 — PASS
- 패키지 내부 상대경로/진입점 검사 이상 없음

## SD 물류센터 (sd-logistics-center-desktop) v1.0.9 — FAIL
- 오류: ZIP 해제 실패: BadZipFile: File is not a zip file

## SD슬롯 (sd-slot) v1.0.6 — PASS
- 패키지 내부 상대경로/진입점 검사 이상 없음

## SD묵찌빠 (sd-mukjippa) v1.0.1 — PASS
- 패키지 내부 상대경로/진입점 검사 이상 없음

## STA (sta-expansion) v1.5.1 — PASS
- 패키지 내부 상대경로/진입점 검사 이상 없음

## SD비트코인 채굴장 (bitcoin) v1.2.2 — WARN
- 경고: 기본 앱 시절 공용 경로 의심: SDBitcoinMiner/main.js (shared/open-center)

## SD 플리마켓 (sd-flea-market) v1.1.3 — PASS
- 패키지 내부 상대경로/진입점 검사 이상 없음

## SD금고 (vault) v1.2.0 — FAIL
- 오류: 누락된 상대경로 모듈: SDVault/main.js -> ../../shared/open-center
- 경고: 기본 앱 시절 공용 경로 의심: SDVault/main.js (shared/open-center)
- 경고: 기본 앱 시절 공용 경로 의심: SDVault/main.js (../shared/)
- 경고: 기본 앱 시절 공용 경로 의심: SDVault/main.js (../../shared/)

## SD홀짝 (odd-even) v1.1.1 — PASS
- 패키지 내부 상대경로/진입점 검사 이상 없음

## SD광부 (miner) v1.1.0 — FAIL
- 오류: 누락된 상대경로 모듈: SDMiner/main.js -> ../../shared/open-center
- 경고: 기본 앱 시절 공용 경로 의심: SDMiner/main.js (shared/open-center)
- 경고: 기본 앱 시절 공용 경로 의심: SDMiner/main.js (../shared/)
- 경고: 기본 앱 시절 공용 경로 의심: SDMiner/main.js (../../shared/)
