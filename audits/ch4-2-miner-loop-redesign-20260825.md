# Chapter 4-2 — SD광부 채굴 루프 재설계

검수/구현일: 2026-08-25

## 범위

4막 광부 리메이크 2장인 **채굴 루프 재설계**의 서버 구조와 회귀 기준을 고정한다.

- 저장소: `SD608/sd-center`
- Stack: PR #75 Chapter 4-1 감사 위
- 구현 브랜치: `feat/miner-remake-loop-v3-20260825`
- Production DB: 변경 없음
- `main`, 공식 버전, update manifest, Release: 변경 없음

이 장의 목표는 기존 300ms 즉시 채굴/무제한 자동 반복 구조를 제거하고, 클릭/매크로 속도가 경제 처리량을 결정하지 않는 서버 권위형 채굴 작업을 만드는 것이다.

## 신규 루프

기본 흐름:

`bind device → get state → start → server ready_at → claim → inventory → sell → Core wallet delta`

핵심 제약:

- 기본 광산 `surface`의 서버 작업 시간: 5초
- 사용자당 active mining job: 최대 1개
- `ready_at` 이전 claim: 거부
- 앱 종료/네트워크 단절 동안 작업은 최대 1개만 대기하며 자동 반복/자동 지급하지 않음
- 광석 RNG, 인벤토리 증감, 판매 단가, 총 판매액은 서버가 결정
- start/claim/sell은 client-generated UUID request ID를 받아 서버에서 exact replay/conflict 검사
- 판매 SD머니는 `sd_core_private.apply_server_wallet_delta_impl`로만 증감

## 세션 / 기기 권한

광부 v3 민감 RPC는 PR #74에서 확정 중인 공통 경계를 재사용한다.

1. JWT의 `session_id`
2. `auth.sessions`에 동일 user/session 존재 및 만료 전
3. active profile
4. `sd_access_devices`에서 user 소유 device key 확인
5. 현재 session에 bound
6. `revoked_at is null`
7. 최근 heartbeat 10분 이내
8. miner 전용 device secret SHA-256 capability 일치

잘못된 secret, cross-user device, revoked device, stale device, 삭제된 auth session, inactive profile을 모두 fail closed 대상으로 둔다.

## 기존 사용자 자산

- 기존 서버 거래로 확인 가능한 `auto_mining_unlocked`는 `legacy_auto_mining_owned`로 보존한다.
- 그러나 기존 500,000원 무제한 자동 채굴 경제는 새 구매/실행 경로를 활성화하지 않는다.
- 기존 `sd_achievement_progress` 값은 `greatest(existing, server)` 및 기존 `unlocked OR new unlocked` 방식으로 단조 보존한다.
- 신규 server total_mined가 0/1이어도 기존 miner-01 86, miner-06 해금, miner-08 5 같은 정상 자산을 낮추지 않는 회귀를 둔다.

## 구형 v2 종료 방식

v3 client cutover 시 기존 공개 API는 fail closed 한다.

- `sd_miner_mine` → `MINER_V3_REQUIRED`
- `sd_miner_get_state` → `MINER_V3_REQUIRED`
- `sd_miner_sell` / `sd_miner_sell_all` → `MINER_V3_REQUIRED`
- `sd_miner_buy_auto_mining` → `MINER_AUTO_REDESIGN_PENDING`

따라서 구형 300ms RPC를 직접 반복 호출해 신규 경제를 계속 생성하는 경로를 남기지 않는다.

## 4-3 공용 아이템 준비

현재 5종은 기존 DB 호환을 위해 `ore_key`를 유지하면서 stable resource identity를 함께 반환한다.

| 기존 key | 공용 체계 준비 key |
|---|---|
| stone | `miner.ore.stone` |
| copper | `miner.ore.copper` |
| iron | `miner.ore.iron` |
| emerald | `miner.gem.emerald` |
| diamond | `miner.gem.diamond` |

이 identity는 4-3에서 실제 공용 원석/광물 item registry로 이전할 준비값이며, 4-2에서 아직 최종 공용 아이템 DB라고 판정하지 않는다.

## 임시 경제 상한

4-4 최종 경제 밸런스 전까지 기존 확률/가격을 유지해 루프 구조 자체의 상한을 비교한다.

기존 1회 기대 판매가:

`0.476×100 + 0.238×500 + 0.143×1200 + 0.095×3000 + 0.048×8000 = 1,007.2`

5초 hard cycle이면:

- 이론상 최대 작업 완료: 720회/시간
- 기대 판매가 상한: `1,007.2 × 720 = 725,184 / 시간`
- 24시간 동일 속도 이론값: `17,404,416 / 일`
- 기존 300ms 기대 `12,086,400 / 시간` 대비 약 94% 감소

업적/진행 참고값:

- 1,000회 채굴 최소: 약 83.3분
- 10,000회 채굴 최소: 약 13.89시간
- 판매 1M 기대: 약 1.38시간
- 판매 5M 기대: 약 6.89시간
- 판매 10M 기대: 약 13.79시간
- 판매 100M 기대: 약 137.9시간
- 다이아 2연속 기대 대기: 약 454.86 claims ≈ 37.9분

위 수치는 **임시 가격표를 100% 판매하고 5초마다 끊김 없이 claim/start하는 이론상 조건**이다. 실제 4-4에서는 장비/비용/광산/자동화 구조와 함께 평균·숙련자·매크로·백그라운드 수익을 다시 판정한다.

## CI 회귀 범위

PostgreSQL 17 production-shaped fixture에서 다음을 검사하도록 구성한다.

- v3 authenticated-only RPC 권한
- live session 존재/삭제
- device ownership, revoked, stale, wrong secret, cross-user
- inactive profile
- 사용자당 active job 1개
- start request replay
- `ready_at` 전 claim 차단
- claim request replay 및 중복 claim 차단
- 대기 작업이 자동 인벤토리/자동 반복하지 않음
- 기존 auto ownership 보존
- 기존 achievement progress/unlock 단조 보존
- 판매 Core exactly-once / request conflict
- old 300ms/auto API fail closed

최종 CI run과 결과는 작업 종료 시 PR/응답에 별도 기록한다.

## 이 장에서 PASS로 보지 않는 것

- 새 광부 Windows 클라이언트의 v3 API 연동
- Windows 100/125/150% UI
- 최소화/절전/재부팅 실제 동작
- 설치/업데이트/재설치/offline recovery
- 4-3 공용 아이템 최종 DB
- 4-4 최종 경제 밸런스
- Dev/Production migration
- 실제 운영 사용자 E2E

따라서 4-2 서버 루프 구현/CI가 성공해도 **Chapter 4 전체 Release Gate PASS를 의미하지 않는다.**
