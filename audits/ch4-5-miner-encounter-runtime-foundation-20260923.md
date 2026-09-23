# 4막 5장 — Boss encounter runtime foundation v1

검토/구현일: 2026-09-23  
대상: `SD608/sd-center`  
상태: **IN_PROGRESS — foundation 자동검증 범위와 실제 사용자 Windows/runtime Gate를 구분한다.**

## CANON 근거

Google Drive 승인 정본 evidence: `miner_boss_encounter_runtime_foundation_canon_v1_20260923`.

기존 Recovery Final Exact v1 CANON을 구현할 실제 Boss/encounter runtime이 저장소에 없다는 선행 감사 뒤, 사용자가 foundation DRAFT v1 전체를 명시 승인했다.

## branch 경계

- base: PR #80 `feat/miner-ui-workshop-mine-v1-20260825`
- exact base HEAD: `544ead9ed568aad5f3fc0354758d7d927217b478`
- head: `feat/miner-encounter-runtime-foundation-v1-20260923`
- main / Production DB / 공식 version / update manifest / Release 변경 없음

## 구현 범위

`miner-remake/runtime-v1`에 다음 foundation을 추가한다.

- Phaser `4.2.1` exact pin + lockfile
- Phaser Arcade Physics dev/browser harness
- pure JS `EncounterCore` / `SimulationClock` / `CommitJournal`
- framework 객체와 durable state 분리
- foundation-only Abister P1 dummy target/movement wiring
- world-unit `RecoveryGeometryAdapter`
- `RecoveryCoordinator`의 trusted-time → snapshot/schema → journal replay → Boss transform → player placement fail-closed 흐름
- Electron main authority용 `RuntimeStorageService`
- renderer가 fs를 직접 만지지 않는 fixed IPC client/registrar 계약
- trusted-time provider interface

본 구현은 실제 아비스테르 전체 P1/P2/P3 공격이나 운영 경제·업적 권한을 구현하지 않는다.

## 저장/recovery 경계

- dirty full snapshot 기본 2.00s는 CANON 값이지만 이 PR에서 성능 PASS를 주장하지 않는다.
- snapshot payload는 Phaser Sprite/Body/Scene/tween/audio/particle 객체를 포함하지 않는다.
- journal은 `authority_epoch` + monotonic `commit_seq`를 사용한다.
- journal replay가 끝난 durable state를 기준으로 Boss/player geometry recovery를 수행한다.
- latest snapshot 손상 시 previous valid generation으로 fallback 가능해야 한다.
- journal gap/schema 불일치/placement 실패는 fresh P1/HP3600으로 우회하지 않는다.

## 자동 Gate

Ubuntu/Node 22:
- Phaser exact dependency/lockfile contract
- renderer privileged module 차단
- 기존 Electron security baseline token 확인
- JS syntax
- fixed-step 10분 determinism + HOLD no-catch-up
- commit persistence ACK ordering
- recovery anchor bounded search / PLAYER_PLACEMENT_BLOCKED
- ROOM_CENTER fallback / BOSS_TRANSFORM_BLOCKED
- journal continuity/replay fail-closed
- snapshot checksum/corruption fallback
- IPC authority boundary

Windows 2025/Edge:
- local Phaser 4.2.1 boot
- canvas 생성
- scene boot/destroy/re-enter 100회
- screenshot artifact

Windows 2025/Electron integration:
- PR #80 실제 `miner-remake/ui-v1/index.html`을 secure BrowserWindow로 load
- Electron 44.4.3 exact test tooling + Phaser 4.2.1
- `nodeIntegration=false / contextIsolation=true / sandbox=true / webSecurity=true`
- preload에는 `miner-runtime:append-journal / write-snapshot / read-recovery`만 노출
- legacy `wallet:* / mining:mine / shop:*` 미연결
- mine view에 Phaser canvas 실제 생성
- journal append → snapshot write → recovery readback round-trip
- UI CSP `script-src 'self'`, `connect-src 'none'`; unsafe-eval 금지
- Electron navigation은 동일 SD광부 UI file만 허용

## 실제 GitHub/CI 결과 — 2026-09-23

구현 commit: `8ac6cc7f1722695c3203589015f3f53f191d6e19`  
Draft PR: **#85**  
Actions: **Miner Encounter Runtime Foundation v1** run **35811115290 — SUCCESS**

성공 job:
- `core-contract`: Node 22 dependency/security contract + encounter/recovery deterministic tests PASS
- `windows-browser-runtime`: Windows 2025 / Microsoft Edge에서 Phaser 4.2.1 boot, canvas 생성, scene destroy/re-enter 100회 PASS, screenshot artifact 업로드 PASS

이 결과로 **foundation 자동 Gate 범위만 PASS**로 판정한다.

추가 Electron integration 구현 commit: `020da0acf8616aa574f2805e748d6aee47f48a8b`  
보안/CI hardening commit: `a7d2d1b423f3182ad1311e56c9b7f626803b6379`

초기 integration run `35835587390`은 3개 job 전부 SUCCESS였지만 로그에서 CI용 `npm init` 오류가 후속 명령으로 가려진 문제와 Electron CSP 미설정 경고를 발견했다. 이를 PASS 근거로 그대로 방치하지 않고 hardening했다.

hardening HEAD run `35835916500` — **SUCCESS**
- `core-contract`: SUCCESS
- `windows-browser-runtime`: SUCCESS
- `windows-electron-ui-integration`: SUCCESS
- Electron integration 로그: `SD광부 UI -> secure Electron -> runtime IPC -> Phaser integration PASS`
- 기존 `Invalid name: ".runtime-electron-ci"` 오류 재발 없음
- Electron `Insecure Content-Security-Policy` 경고 재발 없음
- artifact: `SDCenter-Miner-Runtime-Electron-Integration-v1`, ID `10738817867`, SHA-256 `b1739b36d0ceea0cd22c5132d612cbe568fea8bc1349ed3a2ef26e4ea8f8fa7e`

같은 hardening HEAD에서 `Miner UI Workshop Mine v1` run `35835916563`도 **SUCCESS**하여 CSP 추가가 기존 PR #80 UI static/Windows render Gate를 깨지 않았음을 확인했다.

따라서 **PR #80 UI + secure Electron candidate shell + runtime preload/main IPC + Phaser canvas + snapshot/journal round-trip의 자동 Windows E2E는 PASS**다. 다만 설치·서명된 공식 패키지, 사용자 실제 Windows 조작감/배율, 전체 Boss AI, 2/3/5초 snapshot stress/crash profiling, multiplayer, Core 경제·업적은 계속 미검증이다.

검사 범위 Critical 0 / High 0. 공식 Release Gate는 **NOT PASS**이며 4막5장 전체 COMPLETE/PASS로 승격하지 않는다.

## 아직 PASS가 아닌 항목

- PR #80 사용자 실제 Windows 100/125/150% UI Gate
- 설치·서명된 실제 SD광부 Electron 패키지 E2E 및 사용자 PC 직접 실행
- 전체 광산 room graph / 일반몹 / 아비스테르 full AI와 P1/P2/P3 공격
- 실제 collider feel / 입력 지연 / animation/VFX/SFX
- 2.00s → 3.00s → 5.00s snapshot stress/crash profiling
- trusted server time provider의 4막6장 실제 연결
- multiplayer host election/packet ordering/disconnect 악용성
- Core 경제·업적 E2E
- Production migration / 운영 사용자 자산 Gate

## Release 경계

이 Draft PR의 자동검증이 성공해도 4막 5장 전체 COMPLETE/PASS 또는 공식 Release Gate PASS가 아니다. 4막 6장은 기존 로드맵대로 BLOCKED를 유지한다.
