# 4막 4장 — 장비·비용·성장 시스템

검토일: 2026-08-25  
대상: `SD608/sd-center`  
범위: 서버 장비 정본, 성장 조건, Core 업그레이드 비용, 채굴 속도, 저장 용량, 회귀  
Production 변경: **없음**

## 공식 로드맵 정렬

최신 기준문서의 4막 순서는 다음과 같다.

`4-1 광부 감사 → 4-2 채굴 루프 → 4-3 공용 원석/광물 → 4-4 장비·비용·성장 → 4-5 UI/작업장·광산 연출 → 4-6 Core 경제·업적 → 4-7 경제 밸런스·자동화/시간조작 감사 → 4-8 회귀·Windows/Release`

이전에 작성된 경제 제한 PR #78은 정식 4-4가 아니라 4-7 최종 감사에 사용할 선행 가드레일 후보로 재분류했다.

## 장비 트랙

### 채굴 도구

| Lv | 장비 | 필요 누적 채굴 | 비용 | 서버 cycle |
| ---: | --- | ---: | ---: | ---: |
| 1 | 낡은 곡괭이 | 0 | 0 | 5,000ms |
| 2 | 보강 곡괭이 | 100 | 100,000 | 4,600ms |
| 3 | 강철 곡괭이 | 500 | 500,000 | 4,200ms |
| 4 | 전동 드릴 | 1,500 | 2,000,000 | 3,800ms |
| 5 | 산업용 드릴 | 4,000 | 6,000,000 | 3,400ms |

### 운반 장비

| Lv | 장비 | 필요 누적 채굴 | 비용 | 저장 한도 |
| ---: | --- | ---: | ---: | ---: |
| 1 | 광석 자루 | 0 | 0 | 500 |
| 2 | 광석 상자 | 100 | 75,000 | 1,000 |
| 3 | 광산 수레 | 500 | 300,000 | 2,000 |
| 4 | 보강 광차 | 1,500 | 1,000,000 | 4,000 |
| 5 | 동력 운반차 | 4,000 | 3,000,000 | 8,000 |

수치는 4-7 최종 경제 감사에서 실제 장비 효과를 포함해 다시 판정한다. 현재 일일 claim hard cap은 선행 가드레일로 유지되므로 도구 업그레이드는 주로 동일 일일 상한에 도달하는 시간을 줄인다.

## 서버 권한

- `sd_miner_equipment_catalog`: 서버 장비 정의
- `sd_miner_user_equipment`: 사용자 현재 장비 단계
- authenticated는 두 테이블을 직접 수정할 수 없음
- 사용자 장비는 본인만 RLS read 가능
- 성장 조건은 client 값이 아니라 `sd_miner_accounts.total_mined` 사용
- 업그레이드 비용은 client 입력을 받지 않고 catalog 가격을 서버가 선택
- 비용은 `sd_core_private.apply_server_wallet_delta_impl` exact-once spend만 사용
- 장비 요청도 `sd_miner_actions` request_id exact-once 경계 재사용
- `expected_level`을 요구하여 중복 클릭/동시 stale 요청이 두 레벨 연속 구매되는 것을 차단

## 실제 효과

- `sd_miner_v3_start`가 현재 도구 레벨을 서버에서 읽어 `cycle_ms`와 `ready_at` 결정
- 운반 장비 한도 이상이면 신규 start fail-closed
- claim 도중 다른 경로의 아이템 증가로 저장 한도를 초과하면 job status trigger가 같은 DB transaction을 실패시켜 claim item/account 변경도 rollback
- legacy auto-mining entitlement는 `preserved_disabled` 상태로 유지하며 새 장비로 임의 전환하거나 회수하지 않음

## 보안

Supabase 현재 권고에 맞춰 새 `SECURITY DEFINER` 함수는 `search_path=''`를 사용하고 relation/function을 schema-qualified 하며, private helper는 `PUBLIC/anon/authenticated` EXECUTE를 revoke한다. public RPC만 authenticated에 명시적으로 grant한다.

## 회귀 목표

PostgreSQL 17에서 기존 4-2, 4-3, 경제 가드레일 회귀를 먼저 수행한 뒤 다음을 검사한다.

1. 장비 catalog 정확성
2. client DML/private helper 차단
3. 기존 legacy auto entitlement 보존
4. 신규 사용자 Lv1/Lv1 기본값
5. 다른 사용자 장비 RLS 차단
6. 채굴 횟수 미달 업그레이드 차단, 지갑 불변
7. 도구 Lv2 비용 100,000 Core exact-once
8. 동일 request retry 중복 차감/중복 레벨 없음
9. stale expected_level 두 번째 클릭 차단
10. 도구 Lv2 실제 server job 4,600ms
11. 운반 Lv2 비용 75,000 / capacity 1,000
12. storage full start 차단
13. 999/1000에서 claim 1회만 허용
14. 잔액 부족 업그레이드 rollback
15. revoked device 업그레이드 차단
16. 기존 광부 업적 진행/해금 단조 보존

## Gate 경계

이 장에서 PASS 가능한 범위는 서버 장비·비용·성장 구현과 PostgreSQL 회귀뿐이다. 실제 Windows UI/작업장 연출은 4-5, Core 전체 통합은 4-6, 최종 경제/자동화/시간조작은 4-7, 실제 Windows 설치·업데이트·DPI·오프라인·기존 userData는 4-8에서 별도 검증한다.
