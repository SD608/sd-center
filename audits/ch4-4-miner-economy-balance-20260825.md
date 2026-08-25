# 4막 4장 — 광부 경제 밸런스 확정

검토일: 2026-08-25  
대상: `SD608/sd-center` / PR #77 위 4-4 스택  
범위: 서버 경제 규칙, 악용 상한, 공용 아이템 판매, Core 지급, CI 회귀  
Production 변경: **없음** — 운영 데이터는 읽기 전용 비교만 수행

## 결론

4막 2장의 5초 서버 작업 루프와 4막 3장의 공용 아이템 권한을 유지하고, 광부의 최종 v1 경제 규칙을 다음과 같이 고정한다.

| 자원 | 확률 | 판매가 |
| --- | ---: | ---: |
| 돌 | 47.6% | 50 |
| 구리 | 23.8% | 200 |
| 철 | 14.3% | 500 |
| 에메랄드 | 9.5% | 1,500 |
| 다이아몬드 | 4.8% | 4,000 |

- 채굴 cycle: **5,000ms**
- 사용자당 동시 active job: **1**
- 일일 accepted claim 상한: **3,600회**
- 일일 기준: **Asia/Seoul**
- 완벽한 5초 cadence 기준 일일 활동시간 상한: **5시간**
- ready 상태 자체 수익: **0**
- offline/background 반복 수익: **0**
- 현재 legacy auto-mining 보유권은 보존하지만 자동 채굴 기능은 계속 비활성 상태다.

## 최종 경제 수치

확률가중 기대 판매가:

`0.476×50 + 0.238×200 + 0.143×500 + 0.095×1500 + 0.048×4000 = 477.4`

따라서:

- 1 claim 기대값: **477.4 SD머니**
- 서버 hard throughput: 720 claims/hour
- 완벽 cadence 기대수익: **343,728/hour**
- 90% cadence 기대수익: 약 **309,355/hour**
- 75% cadence 기대수익: 약 **257,796/hour**
- 50% cadence 기대수익: 약 **171,864/hour**
- 일일 3,600 claim 기대수익: **1,718,640/day**
- 모든 claim이 다이아몬드인 수학적 절대 최대: **14,400,000/day**

절대 최대는 RNG상 사실상 현실적 수익 추정치가 아니라, 서버가 허용할 수 있는 최악의 금액 상한을 보기 위한 수치다.

## 기존 구조 대비

### 구 광부 300ms
기존 가격표와 300ms 반복 구조는 기대값 약 **12,086,400/hour**였다. 500,000 자동채굴 업그레이드는 기대 약 2.48분 만에 회수되어 경제 붕괴 위험이 컸다.

### 4막 2장 임시안
5초 cycle로 낮췄지만 구 가격표를 유지해 기대 약 **725,184/hour**였다.

### 4막 4장 확정안
**343,728/hour**로:

- 4-2 임시안 대비 약 **52.6% 감소**
- 구 300ms 구조 대비 약 **97.2% 감소**
- 일일 claim cap으로 장시간 매크로/24시간 반복 우위를 제한

## 운영 경제 읽기 전용 비교

운영 `transactions`를 사용자 식별정보 없이 집계하여 과거 확장팩 유입 규모를 비교했다.

`sd_link_local_deposit` 중 설명 source를 분류한 집계:

| source | 건수 | 유입 합계 | 평균 | 최대 단건 |
| --- | ---: | ---: | ---: | ---: |
| Bitcoin | 20 | 8,334,000,000 | 416,700,000 | 2,426,625,000 |
| Logistics | 13,517 | 1,282,706,685 | 94,895.81 | 2,350,000 |
| Miner | 12 | 2,586,700 | 215,558.33 | 1,139,900 |
| Other | 26 | 26,448,610 | 1,017,254.23 | 10,000,000 |

해석:

- 과거 Bitcoin은 매우 적은 판매 횟수만으로 수십억 단위 유입이 가능했다.
- 새 광부를 같은 방치형 고액 생산기로 설계하지 않는다.
- 이 운영 집계는 과거 기록 비교용이며, 기존 합법적 거래를 회수/수정하지 않는다.

## Bitcoin 코드 기준 비교

검수 스냅샷 `diagnostics/authority-sources/bitcoin` 기준:

- tick: 10초
- GPU당 성공 확률: 0.0002/tick
- 성공 보상: 0.05 BTC
- BTC 기준 판매가: 4,500,000
- 최대 방 기준 GPU 수: 75
- 전기료: GPU당 100,000/day
- GPU 가격: 1,550,000
- room/frame/GPU 전체 최대 설비 초기비용: 약 138,750,000

75 GPU 기대 gross는 약 1,215,000/hour이며 전기료 환산 약 312,500/hour, 내구도 기반 GPU 교체 기대비용까지 단순 환산하면 대략 818,800/hour 수준의 장기 기대 순수익이다. 이는 legacy Bitcoin 자체가 Core 서버 권한으로 최종 재설계됐다는 의미가 아니라, 광부 수익 크기를 비교하기 위한 기존 공식 확장팩 코드 기준치다.

## 플레이 시간 해석

완벽 cadence 기준:

- 1,000 claims: 약 **1.39시간**
- 10,000 claims: 약 **13.89시간**
- 판매 누적 1,000,000 기대: 약 **2.91시간**
- 5,000,000: 약 **14.55시간**
- 10,000,000: 약 **29.09시간**
- 100,000,000: 약 **290.93시간**, 일일 cap 기준 약 **58.2일**의 최대활동일 기대치

두 번 연속 다이아몬드는 독립 확률 4.8% 기준 기대 약 454.86 claims, 완벽 cadence 약 **37.9분**이다. 실제 RNG 편차는 존재한다.

## 매크로 / 백그라운드 / 최악 조건

### 매크로
매크로가 클릭 타이밍을 완벽하게 유지해도:

- 서버 5초 `ready_at`보다 빨리 claim 불가
- active job 1개 초과 불가
- 3,600 accepted claim/day 초과 불가

따라서 매크로의 이점은 인간보다 hard ceiling에 더 가까이 붙는 것뿐이며 ceiling 자체를 넘을 수 없다.

### 백그라운드
작업은 `start -> ready_at -> explicit claim` 구조다. 시간이 흘러 ready가 되어도:

- 아이템 자동 지급 없음
- 다음 작업 자동 생성 없음
- Core 돈 자동 지급 없음

앱 종료/네트워크 단절 중 남을 수 있는 것은 최대 pending job 1개다.

### 날짜 전환
일일 사용량은 서버가 Asia/Seoul 날짜로 계산한다. 클라이언트 PC 시각을 사용하지 않는다. 전날 counter가 남아 있으면 다음 정상 job INSERT/claim 전환에서 서버 날짜로 reset된다.

### migration 중간 적용
이미 v3가 운영 중인 상태에서 4-4를 적용해도 migration 시점의 해당 Asia/Seoul 날짜 `claimed` job을 세어 `daily_claims`를 백필한다. migration 적용 때문에 당일 사용량을 0으로 되돌려 추가 quota를 주지 않는다.

## 서버 구현

`database/migrations/sd_miner_economy_balance_v1.sql`

- `sd_miner_accounts.daily_claim_day/daily_claims`
- server economy day/claim limit/cycle helpers
- 테스트 가능한 deterministic ore roll bucket helper
- 최종 sale-price helper
- 당일 기존 claimed job usage 백필
- `sd_miner_jobs` BEFORE INSERT / BEFORE UPDATE OF status trigger로 quota enforcement
- final economy metadata를 `sd_miner_v3_get_state`에서 반환

중요: claim/sell의 기존 보안 경로를 새로 복사하지 않는다.

- session/device/revocation: 4-2 경로 유지
- inventory final authority: 4-3 `sd_user_item_balances`
- item mutation exact-once: 4-3 `sd_item_events`
- wallet final authority: SD Core helper
- sale retry exact-once: 기존 request_id 경로 유지

일일 제한은 같은 DB transaction의 job row transition 앞에서 강제되므로 제한 실패 시 선행 item/account 변경도 함께 rollback된다.

## CI 검사 설계

PostgreSQL 17에서 4-2/4-3 전체 회귀를 먼저 수행한 뒤 4-4를 적용한다.

4-4 전용 회귀:

1. 확률 bucket 정확성 476/238/143/95/48
2. 가격 50/200/500/1500/4000
3. EV/hour/day/absolute-max 수학 계약
4. private helper와 account/item 직접 client write 차단
5. migration 시 당일 기존 accepted claims 보존
6. 3,599 -> 3,600번째 claim 정상 1회
7. 동일 claim retry가 quota/item을 다시 소비하지 않음
8. 3,600 도달 뒤 신규 start fail-closed
9. revoked device 우선 차단
10. 날짜 rollover reset
11. ready 상태 background 수익 0
12. 각 광물 1개 전체 판매 = 정확히 6,250
13. 돌 3개 판매 = 정확히 150
14. sell/sell_all retry exact-once
15. oversell 시 wallet/item/transaction 불변
16. 기존 miner achievement progress/unlock 단조 보존

## 판정 경계

4-4에서 PASS로 판단할 수 있는 것은 **최종 서버 경제 규칙과 PostgreSQL 회귀가 실제 성공한 범위**뿐이다.

아직 별도 검증 대상:

- 실제 Windows miner v3 client
- UI 100/125/150%
- 실제 클릭 cadence와 사용자 체감
- sleep/reboot/minimize/offline recovery
- 설치/업데이트/재설치
- DEV/Production migration
- 운영 기존 사용자 migration 전후 strict digest
- 향후 자동채굴 재설계
- 타 확장팩이 공용 광물을 소비하는 실제 E2E

따라서 4막 전체 Release Gate는 이 장만으로 PASS 처리하지 않는다.
