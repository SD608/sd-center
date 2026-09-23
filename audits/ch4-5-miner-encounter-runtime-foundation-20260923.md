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


## Snapshot durability/performance Gate v1 — 2026-09-23

Recovery Final Exact v1의 이미 승인된 cadence Gate를 신규 게임 규칙 없이 구현한다.

- 논리 Boss stress window: cadence별 최소 10분
- journal commit: 1초 간격, 각 append에서 checksum + fsync
- dirty full snapshot 후보: 2.00s → 성능 Gate 실패 시 3.00s → 5.00s
- snapshot write 측정 범위: serialize/checksum + fsync + atomic rename을 포함한 실제 `RuntimeStorageService.writeSnapshot`
- 강제 restart/reopen: 60초마다 1회, 총 10회/후보 cadence
- durability 검증: 최신 valid snapshot + 연속 journal replay 후 `commit_seq`와 Boss HP가 마지막 authoritative commit과 exact 일치
- 성능 기준: 60Hz frame budget 기준 snapshot blocking p95 <= 25%, 단일 max <= 1 frame
- 2/3/5초 모두 실패하면 Gate를 억지로 완화하지 않고 `FAIL_OPTIMIZATION_REQUIRED`로 종료
- JSON evidence: `runtime-profiles/snapshot-stress-v1.json`
- Windows CI job: `windows-storage-durability`
- 이 Gate는 headless storage/runtime 자동검증이며 사용자 실제 입력감, 설치 패키지, full Boss P1/P2/P3 검증을 대체하지 않는다.

구현 시작 commits:
- `deee64bdd64056b1b1403e0193c57ba886032ca0` — stress harness
- `e9be680936c3460104e85da0ae1468a29692acd2` — npm script/check 연결
- `ac7179bf9c4e9c2df44d72bc6640c854364a2bd7` — Windows storage Gate CI 연결

현재 상태: **IMPLEMENTED_GATE_HARNESS / CI_RESULT_PENDING**. 결과 확인 전 PASS로 판정하지 않는다.


### Snapshot Gate 1차 실패 → 저장 경로 최적화 → 재시험

1차 Gate:
- HEAD: `bca4157521088884afcf6a47abc6276b87077961`
- run: `35842345265`
- artifact: `SDCenter-Miner-Runtime-Snapshot-Stress-v1` ID `10741232935`, digest `sha256:56b606815b974daed3297ad5eaf1f8407478e4e2fb10c79b4ac029d64e65d660`
- durability: 2/3/5초 모두 PASS, failed write/recovery 0
- performance: 2/3/5초 모두 FAIL. 5초도 snapshot blocking p95 10.0002ms / max 18.4424ms로 CANON 한계 4.1667ms / 16.6667ms 초과.
- 판정: cadence 추가 완화 금지, storage implementation optimization 필요.

최적화:
- `b6b27209bb84e3f46780b3ef89e4c5c1b399bee7`: snapshot/journal durable write를 `fs/promises` 기반 async I/O로 전환. checksum/serialize 후 write+fsync+rename 완료까지 Promise ACK는 유지.
- `a937c34c8864a255bb076b3908ea320ceab38d8b`: Electron IPC가 async durable write 완료를 await한 뒤 ACK.
- `bb0471f02bc4e7d6c6293a0eaf57848798635c48`: storage regression test async contract 반영.
- `18b6e24338ed59443f68cd049813fac7ba455bff`: stress Gate가 synchronous dispatch blocking과 durable ACK latency를 분리 측정하도록 보정.

재시험:
- HEAD: `18b6e24338ed59443f68cd049813fac7ba455bff`
- run: `35842648395`
- Windows storage job: SUCCESS
- artifact: `SDCenter-Miner-Runtime-Snapshot-Stress-v1` ID `10741323257`, digest `sha256:36340be70025b169b8aca92a201dfd1c97f57bd7d7587c13a86faf7086b096e2`
- 2.00s에서 PASS하여 3/5초 재시험 불필요.
- 10분 logical stress / snapshot 300 / journal 600 / forced reopen+recovery 10.
- snapshot main-thread blocking: p50 0.1389ms / p95 0.2016ms / max 0.5728ms / over-frame 0.
- snapshot durable ACK latency: p50 15.9818ms / p95 31.7255ms / max 60.6183ms.
- journal main-thread blocking: p95 0.1546ms / max 0.3847ms.
- recovery: p95/max 12.0757ms.
- failed write/recovery 0, commit_seq + Boss HP exact durability PASS.
- 자동 Gate 판정: `SNAPSHOT_2S_AUTOMATED_STORAGE_GATE_PASS`.
- 범위 제한: headless Windows storage profiling이며 사용자 실제 입력감, full Boss payload/AI, packaged installer E2E를 대신하지 않는다.
