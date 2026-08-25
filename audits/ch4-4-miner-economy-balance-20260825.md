# 4막 선행 작업 — 광부 경제 가드레일

검토일: 2026-08-25

이 문서는 최신 공식 로드맵 확인 전 작성된 경제 선행 작업 기록이다. 최신 기준문서상 정식 4막 순서는 `4-4 장비·비용·성장 시스템 → 4-5 새 UI/작업장·광산 연출 → 4-6 Core 경제·업적 연동 → 4-7 경제 밸런스·자동화/시간조작 감사`이다.

따라서 이 PR의 가격/일일 claim cap은 **4-7 최종 경제 감사에 들어갈 선행 가드레일 후보**로 취급한다. 정식 4-4 완료로 간주하지 않는다.

## 선행 경제 후보

| 자원 | 확률 | 판매가 |
| --- | ---: | ---: |
| 돌 | 47.6% | 50 |
| 구리 | 23.8% | 200 |
| 철 | 14.3% | 500 |
| 에메랄드 | 9.5% | 1,500 |
| 다이아몬드 | 4.8% | 4,000 |

- 채굴 cycle 기준: 5,000ms
- 일일 accepted claim 상한 후보: 3,600회 / Asia/Seoul
- 기대값: 477.4/claim
- 완벽 cadence: 343,728/hour
- 일일 cap 기대: 1,718,640/day
- all-diamond 수학적 절대 최대: 14,400,000/day
- ready/offline/background 자동 반복 수익: 0

## 검증 완료 범위

최종 검증 HEAD `ba99887a48edea5f7154a4699fe9ae50a3c5302a` 이전 검증에서 PostgreSQL 17 `Miner Economy Balance v1` run `32814777607` PASS를 확인했다.

검사 항목:
- 4-2 baseline regression
- 4-3 shared-item migration/regression
- 가격/확률/EV math
- 3,599 → 3,600 quota 경계
- 동일 claim retry exact-once
- 날짜 rollover
- background ready 상태 수익 0
- revoked device
- sell/sell-all Core exact-once
- oversell rollback
- 기존 업적 단조 보존

첫 실패 run은 4-3 적용 후 4-2 legacy inventory 기대 테스트를 돌린 workflow 순서 문제였고, `4-2 회귀 → 4-3 적용/회귀 → 경제 후보` 순서로 수정 후 PASS했다.

## 운영 비교

Production은 읽기 전용 집계만 수행했다. 과거 `sd_link_local_deposit` 설명 기준 집계에서 Bitcoin은 20건 8,334,000,000, Logistics는 13,517건 1,282,706,685, Miner는 12건 2,586,700이었다. 기존 합법적 거래나 자산은 수정하지 않았다.

## 판정

이 작업은 **경제 가드레일 선행 후보 + CI 검증 범위 PASS**다. 최신 공식 로드맵의 정식 4막 4장은 별도로 장비·비용·성장 시스템을 구현해야 한다. 이후 4-7에서 장비 효과와 실제 자동화/시간조작 조건을 포함해 경제값을 다시 최종 판정한다.

Production migration, main 병합, 공식 버전/update manifest/Release 변경은 수행하지 않았다.
