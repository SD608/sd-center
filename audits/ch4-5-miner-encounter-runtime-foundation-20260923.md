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

## 아직 PASS가 아닌 항목

- PR #80 사용자 실제 Windows 100/125/150% UI Gate
- 실제 SD광부 Electron package에 preload/main IPC를 연결한 E2E
- 전체 광산 room graph / 일반몹 / 아비스테르 full AI와 P1/P2/P3 공격
- 실제 collider feel / 입력 지연 / animation/VFX/SFX
- 2.00s → 3.00s → 5.00s snapshot stress/crash profiling
- trusted server time provider의 4막6장 실제 연결
- multiplayer host election/packet ordering/disconnect 악용성
- Core 경제·업적 E2E
- Production migration / 운영 사용자 자산 Gate

## Release 경계

이 Draft PR의 자동검증이 성공해도 4막 5장 전체 COMPLETE/PASS 또는 공식 Release Gate PASS가 아니다. 4막 6장은 기존 로드맵대로 BLOCKED를 유지한다.
