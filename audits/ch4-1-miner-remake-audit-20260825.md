# Chapter 4-1 — SD광부 기존 코드·경제·업적 감사

검수일: 2026-08-25

## 범위와 판정

이 문서는 4막 광부 리메이크의 1장인 **기존 광부 코드·경제·업적 감사** 결과를 고정한다.

- 대상 저장소: `SD608/sd-center`
- 감사 기준 소스: `diagnostics/authority-sources/miner/` 및 현재 Production에 적용된 miner authority/Core SQL
- 기준 브랜치: PR #74 HEAD `5c2d495e8ae6f1124736ebb54028dd06793a36c5` 위의 감사 전용 브랜치
- Production DB: 읽기 전용 집계만 수행. write/migration 없음.
- `main`, 공식 버전, update manifest, GitHub Release: 변경 없음.

**4-1 감사 수행 결과: 완료. 현재 v1.1.x 광부 설계는 그대로 재사용 FAIL. 4-2에서 채굴 루프와 권한/경제 구조를 재설계해야 한다.**

이 판정은 광부 리메이크의 출시 PASS가 아니다. 실제 Windows 실행/배율/UI, 새 리메이크 코드, migration, 기존 사용자 전환은 아직 검증하지 않았다.

## 현재 구성

기존 PC 광부 소스 스냅샷은 다음 구조다.

- `main.js`: Electron IPC, 300ms 채굴 쿨다운, 로컬 광석 추첨/판매/업그레이드 호출
- `src/mining-engine.js`: 광석 확률/가격과 로컬 RNG
- `src/wallet-database.js`: `sdwallet.sqlite`에 광부 인벤토리/기록을 만들고 계좌 잔액/거래를 직접 변경
- `public/js/app.js`: 채굴 UI, 숫자 0 자동 채굴, 300ms 반복 타이머
- `preload.js`: 렌더러 → Electron IPC 브리지

현재 서버에는 별도의 miner authority가 이미 존재한다.

- `sd_miner_accounts`
- `sd_miner_inventory`
- `sd_miner_actions`
- `sd_miner_get_state()`
- `sd_miner_mine(request_id)`
- `sd_miner_buy_auto_mining(request_id)`
- `sd_miner_sell(..., request_id)` / `sd_miner_sell_all(request_id)`

서버 경로는 request ID exactly-once, 서버 RNG, 행 잠금, Core wallet delta를 이미 사용한다. 다만 아래 HIGH가 남는다.

## 경제 기준선

현재 고정 광석 확률/판매가는 다음과 같다.

| 광석 | 확률 | 판매가 |
|---|---:|---:|
| 돌 | 47.6% | 100 |
| 구리 | 23.8% | 500 |
| 철 | 14.3% | 1,200 |
| 에메랄드 | 9.5% | 3,000 |
| 다이아몬드 | 4.8% | 8,000 |

1회 채굴 기대 판매가:

`0.476×100 + 0.238×500 + 0.143×1200 + 0.095×3000 + 0.048×8000 = 1,007.2`

현재 서버/클라이언트 쿨다운은 300ms다.

- 이론상 최대: 약 3.333회/초
- 기대 수익: 약 **12,086,400 / 시간**
- 24시간 동일 속도 이론치: 약 **290,073,600 / 일**
- 자동 채굴 가격: 500,000
- 기대 회수 시간: 약 **2.48분**

24시간 수치는 renderer timer가 실제 Windows 최소화/백그라운드에서 항상 완전한 300ms 속도로 실행된다는 뜻이 아니다. 실제 스로틀링/정지 여부는 별도 physical smoke 대상이다. 하지만 공개 서버 RPC 자체의 쿨다운이 300ms라 자동화 클라이언트는 같은 상한을 직접 노릴 수 있다.

## 버그 / Release 위험

### HIGH-1 — Legacy PC 광부가 SD지갑 잔액/거래를 직접 결정

기존 `wallet-database.js`는 광물 판매와 자동 채굴 구매 때 `accounts.balance`를 직접 UPDATE하고 `transactions`를 직접 INSERT한다.

영향:

- 클라이언트/로컬 DB가 경제 결과를 결정한다.
- 로컬 인벤토리/가격/거래 데이터 변조에 취약하다.
- 새 Core 경제 무결성 원칙과 충돌한다.
- Legacy 거래를 새 Core로 가져오는 과정이 잘못 열리면 조작된 로컬 거래가 운영 경제로 승격될 위험이 있다.

4-2 이후 요구사항:

- 새 광부는 SD지갑 SQLite 잔액을 직접 변경하지 않는다.
- 광부 인벤토리/판매 결과의 최종 판정자는 서버/Core다.
- Legacy 로컬 거래는 신규 보상 근거로 신뢰하지 않는다.

### HIGH-2 — 현재 공개 miner RPC에 live session / non-revoked device gate가 없음

현재 miner RPC는 `auth.uid()`를 확인하고 Core wallet delta를 사용하지만, 호출 시점의 live Supabase session 및 현재 소유한 non-revoked device를 별도로 검증하지 않는다.

Core의 `apply_server_wallet_delta_impl`도 경제 exactly-once/잔액/active profile을 담당할 뿐 호출자의 device/session 권한을 대신 검증하지 않는다.

영향:

- 유효한 authenticated token만 있으면 공식 광부 UI를 통하지 않고 RPC를 자동 호출할 수 있다.
- revoked/unbound device 차단 정책을 광부가 자체적으로 보장하지 못한다.
- 300ms 쿨다운 때문에 직접 자동화가 경제 문제와 결합된다.

4-2/4-6 요구사항:

- PR #74 이후 확정되는 공통 live-session/device 검증 경계를 재사용한다.
- 광부 전용으로 별도의 약한 인증 규칙을 만들지 않는다.
- device revoked, session invalid, cross-user 요청을 회귀 테스트한다.

### HIGH-3 — 300ms 무제한 반복 경제가 자동화에 지나치게 유리

현재 기대 수익은 약 12.09M/시간이며 자동 채굴 가격 500K는 약 2.48분이면 기대값 기준 회수된다.

별도 일일 제한, 에너지/내구도/채굴 비용, 위험 비용, 광산 등급별 시간 비용이 없다. 공식 UI 자동 채굴뿐 아니라 RPC 자동 호출도 동일 경제 상한에 접근할 수 있다.

4-2/4-4 요구사항:

- 사람 클릭 속도를 경제의 핵심 변수로 사용하지 않는다.
- 서버가 세션/작업 단위 채굴 시간을 판정한다.
- 장비·비용·성장과 결합해 수익 상한을 설계한다.
- 평균뿐 아니라 숙련자/자동화/이론상 최대와 일일 최대를 Gate에 포함한다.

### HIGH-4 — 기존 사용자 업적을 서버 0으로 덮어쓸 수 있는 migration 위험

2026-08-25 Production read-only 집계 시 현재 서버 광부 상태는 다음과 같았다.

- `sd_miner_accounts`: 8명
- 새 서버 `total_mined` 합계: 0
- `sd_miner_actions`: 0건
- 서버 광부 인벤토리 acquired/current: 5종 모두 0
- legacy sales baseline을 포함한 `total_sales_krw` 합계: 2,586,700
- auto mining 보유: 2명

그러나 기존 업적에는 이미 legacy 진행/해금이 존재한다.

- `miner-01`: 최대 진행 86
- `miner-02`: 1명 해금/earned, 최대 판매 진행 2,565,400
- `miner-05`: 최대 진행 86
- `miner-06`: 1명 해금/earned
- `miner-08`: 최대 진행 5

따라서 새 서버 카운터만 정본으로 삼아 기존 progress/earned를 낮추거나 초기화하면 합법적 사용자 자산 손상이다.

4-2 이후 migration 요구사항:

- 기존 `current_value`, `unlocked`, `unlocked_at`, `sd_user_achievements`는 단조 보존한다.
- 새 서버 상태는 기존 보존 기준보다 낮아도 진행도를 역행시키지 않는다.
- 재로그인/재설치/재동기화에서도 기존 earned/title이 유지되는 회귀가 필요하다.

### MEDIUM-1 — 업적 난이도가 현재 300ms 루프와 맞지 않음

현 쿨다운을 연속 수행할 때:

- miner-01 1,000회: 최소 시간 5분
- miner-05 10,000회: 최소 시간 50분
- miner-02 1M 판매: 기대 약 4.96분
- miner-03 5M 판매: 기대 약 24.82분
- miner-04 10M 판매: 기대 약 49.64분
- miner-09 100M 판매: 기대 약 8.27시간

`miner-07` 금맥은 다이아몬드 확률 4.8%, 서버 정의상 다이아 2연속이다. 독립 시행 기준 두 연속 성공까지 기대 채굴 횟수는 약 454.86회, 현재 쿨다운이면 약 **2.27분**이다.

업적의 명칭/희소성과 실제 난이도가 맞지 않으므로 4-2/4-4 경제와 함께 재평가한다. 기존 UUID/code/정상 earned 자산은 보존한다.

### MEDIUM-2 — 배포 카탈로그와 감사 소스 버전이 다름

현재 센터 확장팩 카탈로그는 `SD광부 v1.1.0 / SDMiner_v1.1.0_Desktop.zip`을 가리키지만 감사용 authority source와 과거 package audit는 `v1.1.1`이다.

리메이크 전 정확한 기준 패키지의 `extension_id + version + SHA-256`을 다시 확정해야 한다. 서로 다른 버전을 같은 검수 결과로 취급하지 않는다.

### MEDIUM-3 — Electron/Forge 의존성이 `latest`

기존 `package.json`은 Electron Forge/Electron 개발 의존성에 `latest`를 사용한다. 동일 소스 재빌드가 시간이 지나면 다른 dependency 버전을 가져올 수 있다.

리메이크 후보는 정확한 버전을 pin하고 lockfile/빌드 provenance를 기록한다.

## 보존 가능한 기존 장점

- Electron `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- 외부 window/webview/navigation 제한
- single-instance lock
- 현재 서버 authority의 request_id exactly-once
- 서버 RNG
- inventory row lock / Core wallet delta 경유
- 서버 기반 업적 refresh 구조

이 장점은 재사용하되 HIGH 항목을 해결하기 전 현재 경로를 새 리메이크의 최종 구조로 승인하지 않는다.

## 4-2 진입 조건

4-2 채굴 루프 재설계는 아래를 설계 전제로 고정한다.

1. 서버가 채굴 결과·시간·인벤토리·판매가의 최종 판정자다.
2. 클라이언트는 `extension_id + event/action + request/event_id + 검증 가능한 입력`만 전달한다.
3. 모든 경제 증감은 Core exactly-once 경로를 사용한다.
4. live session + owned active non-revoked device/capability를 검증한다.
5. 자동화가 사람 클릭보다 압도적인 이득을 얻지 않게 한다.
6. 기존 사용자 업적/칭호/거래 자산은 감소·초기화하지 않는다.
7. 광물은 4-3 공용 아이템 체계로 이전 가능한 identity를 사용한다.
8. 4-2부터 평균/숙련자/이론상 최대/백그라운드/매크로 수익을 함께 계산한다.

## 미검증

4-1에서 다음은 PASS 처리하지 않았다.

- 실제 v1.1.0 배포 ZIP과 v1.1.1 authority snapshot byte-for-byte 비교
- 실제 광부 Windows 최소화/백그라운드 timer throttling
- 실제 Windows 100/125/150% UI
- 신규 리메이크 코드 실행
- DEV/Production migration
- 기존 사용자 리메이크 E2E
- 설치/업데이트/재설치/재부팅/offline recovery

따라서 Chapter 4 공식 Release Gate는 아직 시작 단계다.
