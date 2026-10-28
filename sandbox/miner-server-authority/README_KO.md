# SD광부 서버 권위 Run / PostgreSQL 격리 검증 v0.2

**USER_APPROVED architecture direction (2026-10-28):** 서버가 공식 Run 월드 사건과 정상생환을 확인하고, SD Core가 개인별 자산/보상 최종 원장 권위를 보유한다.

**TECHNICAL DRAFT / DISPOSABLE CI ONLY / NOT A PRODUCTION MIGRATION**

## 무엇을 검증하는가

- `schema.sql`: 일회용 PostgreSQL 17의 별도 `miner_a_sandbox` 스키마에서 server-provenance 모의 기록, 아이템 claim, G60 배송 차감, 개인별 정상생환 주화 원장과 테스트 잔액을 한 트랜잭션에 정산하는 SQL 프로토타입.
- `tests.sql`: 사용자 역할의 스키마/함수/잔액 직접 쓰기 권한 부재, 시험 주화 경계 30/60/100/150/210/280/360/450, 출처 중복 수령·ID replay, 타인 배송·초과 배송, 미확인 생환/G60 보류, 동일/다른 Return replay, 두 플레이어 개별 보상·영구 심핵 0점 검사.
- GitHub Workflow: PR에서 Node22 기존 시험 20개와 **disposable PG17 PostgreSQL** SQL 테스트를 실행한다. 운영 Supabase 접근/비밀키 없음.
- 기존 PR #89의 Unity 읽기전용 NotConnected 인터페이스를 그대로 유지. 이 PR은 SQL 격리 계약과 실제 Center 통합 감사 자료만 추가.

## 엄격한 신뢰 경계

1. 클라이언트(Unity/Center/SD Link)는 공식 원장 쓰기/월드 사실 확정 권한이 없다. `trusted_*` SQL은 **신뢰된 Run 시뮬레이션이 서버에서 확정한 사실을 가정하는 테스트 헬퍼**이며 온라인 RPC로 직접 노출하면 안 된다.
2. SQL `miner_a_engine_qa`는 NOLOGIN으로 별도 정의하고 함수 실행권만 갖는다. 새로운 클라이언트 역할 `miner_a_client_qa`는 스키마 USAGE와 함수 EXECUTE 모두 없다. 운영 `anon`, `authenticated`에게 보상 권한 부여 금지.
3. `SET search_path=pg_catalog,pg_temp` 및 스키마 정규화 식별자를 사용한다. DB는 test-only `balances.test_coins`이지 SD Core 공식 지갑이 아니며 출처의 진위를 증명하지 않는다.
4. 세계 시드/광맥 내구/몬스터 피격·스폰·드롭/드롭 획득 가능거리·중간층 승객 엘리베이터 경로·G60 배송 수신 확인·클라이언트 디바이스 취소·게임빌드 인증·업적/실제 Core 트랜잭션 **아직 없음**. 이번 SQL로 실제 출시 보안/멀티/원자성 통합 Gate 통과 주장 금지.
5. 게임 공식 주화 평가 기존 v0.9 시험값 유지, 원본 아이템 비소비. `trial_points` 그룹 식별자는 개발용 범주이고 몬스터 종별 ITEM ID 정본과 1:1 매핑된 것으로 간주 금지. 지급 기준은 사용자가 고른 단일 무기 계열 G2 8/G1 16 **시험가격**만; G1 정확 레벨 및 선행 G5~G3 금액은 여전히 미확정. SQL은 무기 구매/소비 미구현.
6. 엔진 역할이 가짜 user_id·source_id를 넣지 않는다는 보장이 아직 없음. 게임 런타임이 서명된 유효 입력·실세계 시뮬레이션·세션/기기·버전·시간을 검증하고 서버 트랜잭션을 발행하는 구현은 별도 구조 승인/검증이 필요하다.

## Center / SD Link / SD Core 실제 코드 감사

| 요소 | GitHub에서 확인한 파일 | 확인 결과 및 제한 |
|---|---|---|
| SD Core 계정/기기 계약 | `docs/sd-core/SD_LINK_API_CONTRACT_v1.md` | Auth JWT + active/nonrevoked device 소유자 확인, `auth.uid()` 기반으로 소유자 판정. **Unity 신규 Bridge 존재의 증거는 아님** |
| 클라이언트 보상 차단 | `database/migrations/sd_core_reward_authority_v1.sql` | 클라이언트 `reward` 요청 시 `REWARD_CAPABILITY_REQUIRED`; Unity가 기존 RPC를 이용해 주화를 mint하면 안 됨 |
| Center SD Link 통합 | `preview/v022/sdlink-integration.js` | linked-services 경로, SD Link 연결 상태 스냅샷. 암호/기기 정보 등 민감한 사용자 데이터 노출 경계 추가 검증 필요 |
| Center 패치 참조 | `tools/patch-center-ui-v021-sdlink-main.js` | `main.js` patch 대상의 설치/실행 통합 참고 코드. **현재 배포된 Center executable 직접 검증되지 않음** |
| 확장팩 manifest | `update/extensions-catalog.json` | 기존 Electron `miner` v1.1.1 SHA/다운로드; Unity 신작 공식 manifest/서명/실행 경로가 아니라 legacy |
| Unity 프로토타입 | PR #88/#89 `unity/sd-miner-prototype` | 개발 스캐폴드 및 fail-closed 경계. Editor/실게임 인증·Run server/운영 build 아님 |

### 제안하는 엔드투엔드 프로토콜 (미확정 API)

`Center 공식 패키지 SHA/서명 검증 → Center user/device session 검증 → 서버가 단기 PlaySession/Run을 발급 → 서버 엔진이 Run seed/광맥/전투·획득 사실을 확정 → 획득 원장과 G60 배송 provenance 서버 기록 → 정상 승객엘리베이터 귀환 검증 → SD Core 같은 commit 경계에 개인 bag snapshot/coin ledger idempotent 지급 → 서버 응답으로 Unity UI 갱신`.

새 게임 프로세스는 service_role 토큰·원본 비밀번호·다른 확장팩 userData 파일·지갑 직접 mutation 접근 금지. `sd_core_apply_wallet_event` 클라이언트 reward는 이미 막혀 있으므로 이 경로를 우회하는 RPC를 만들지 않는다.

### 남은 핵심 결정 및 Release Gate

- CENTER_LAUNCH_API: 실제 최신 배포 Center 실행/로그인 소스의 장치와 세션 전송 계약, Unity 빌드 서명·SHA256/설치/업데이트·네임드파이프 또는 다른 IPC 선택, game session token scope·수명·폐기.
- RUN_ENGINE_AUTHORITY: 진짜 광맥/AI/충돌/보스/퀘스트의 서버 시뮬레이션 책임 범위·장애와 조작 방어, 게임 한 Run을 몇 서버 프로세스로 처리할지, 멀티 참가·파티장 교체 기준.
- DB транзак션/지갑: test coin ledger를 실제 SD Core 원자 지급 경계와 합법 사용자 자산에 안전하게 연결할 설계, UPSERT 분쟁·병렬 연결 race·ack-loss/rollbacks·G60 보호/자산 복원.
- 사용자 확정 부족: G1 정확 레벨·퀘스트·G5~G3 금액/소재; 최종 경제 실제 주화/h·Q16 4막 단독 E2E.

**이 브랜치는 DRAFT, main 머지·운영 DB migration·공식 버전·update manifest·배포를 하면 안 된다.** 테스트 성공은 격리 DB 안에서 SQL이 실행됐다는 범위로만 판단하고 실제 Unity/Center/Core 권한 Gate는 NOT PASS.

Evidence: `miner_server_authority_A_disposable_pg17_ci_20261028`
