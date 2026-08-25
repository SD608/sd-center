# 4막 3장 — 공용 원석·광물 아이템 체계

날짜: 2026-08-25

## 목표

광부의 돌/구리/철/에메랄드/다이아를 광부 로컬 또는 광부 전용 현재수량 테이블에 가두지 않고, SD Core 계열 기능이 공통으로 읽고 향후 소비할 수 있는 서버 권위형 수량 자산으로 전환한다.

## 범위

- 공용 아이템 카탈로그
- 사용자별 공용 수량/누적 획득/누적 소비
- exact-once 아이템 이벤트 원장
- 광부 v2 현재 수량/획득 이력 1회 백필
- 광부 v3 claim/sell/sell_all 공용 수량 권위로 전환
- 기존 업적 진행/해금 단조 보존
- authenticated 클라이언트 직접 DML 차단
- 기존 플리마켓 개별 아이템 구조와 분리

## 기존 구조 확인

Production/DEV 읽기 전용 확인에서 다음 공용 테이블 이름은 존재하지 않았다.

- `sd_item_catalog`
- `sd_user_item_balances`
- `sd_item_events`

기존에는 `sd_flea_items`와 `sd_miner_inventory`가 존재한다. `sd_flea_items`는 개별 물건 인스턴스/상태/가격 중심이고, 이번 광석은 수량형 자산이므로 직접 합치지 않는다.

Production/DEV에 이 작업의 DDL/write는 수행하지 않았다.

## 공용 자산 모델

### `sd_item_catalog`

아이템 정체성만 정의한다. 가격은 정의하지 않는다.

현재 광부 항목:

- `miner.ore.stone`
- `miner.ore.copper`
- `miner.ore.iron`
- `miner.gem.emerald`
- `miner.gem.diamond`

가격/희귀도는 광부 경제 규칙이며 4막 4장에서 별도 확정한다. 공용 아이템 체계가 특정 확장팩 가격을 전역 가격으로 만들지 않는다.

### `sd_user_item_balances`

사용자별 현재 수량과 이력을 보관한다.

- `quantity`
- `lifetime_acquired`
- `lifetime_spent`

최종 현재 수량 판정자는 이 테이블이다.

### `sd_item_events`

모든 신뢰된 수량 변경을 exact-once 이벤트로 기록한다.

- `event_id`
- user/item/delta
- before/after
- source_app / event_type
- metadata / result

동일 `event_id` 재시도는 같은 결과를 재생하고, 다른 user/item/delta/source/event_type으로 재사용하면 충돌 처리한다.

## 권한

- catalog: authenticated read-only
- balances: 본인 행 read-only
- item events: 본인 행 read-only
- insert/update/delete: authenticated/anon 차단
- 실제 수량 변경 helper는 `private.apply_sd_item_delta_impl(...)`이며 client role EXECUTE 차단

따라서 검수되지 않은 ZIP이나 일반 클라이언트가 REST/RPC로 공용 수량을 직접 증가시키는 경로를 만들지 않는다.

## 광부 migration

`sd_miner_inventory`의 현재 값은 cutover 시 한 번만 복사한다.

- `quantity` → 동일 수량
- `lifetime_acquired` → `greatest(acquired_count, quantity)`
- `lifetime_spent` → `greatest(acquired_count - quantity, 0)`

`ON CONFLICT DO NOTHING`을 사용해 migration이 실수로 재실행되더라도 이후 합법적으로 소비된 아이템을 옛 수량으로 복원하지 않도록 한다.

양수 수량은 `migration:miner-v2:<user>:<ore>` 이벤트로 migration 원장도 남긴다.

cutover 이후 `sd_miner_inventory.quantity`는 현재 권위가 아니며 legacy compatibility/history snapshot으로 남긴다. 기존 사용자 자산을 삭제하지 않는다.

## 광부 v3 연결

### claim

`start → ready_at → claim` 완료 시 서버 RNG가 광물을 결정하고, claim request UUID를 item `event_id`로 사용해 공용 수량 +1을 정확히 한 번 반영한다.

### sell

1. 공용 수량 row lock
2. 부족 수량 거부
3. 공용 item event로 수량 차감
4. SD Core wallet helper로 동일 요청의 판매금 지급
5. 광부 판매 누적/업적 갱신

모두 하나의 Postgres 함수 transaction이므로 중간 단계 실패 시 함께 rollback된다.

### sell_all

한 요청이 여러 item을 줄일 수 있으므로 각 item sub-event는:

`<request_uuid>:<item_key>`

형태의 결정적 event ID를 사용한다. Core 지갑 지급은 원래 request UUID 1건만 사용한다.

## 업적 보존

- miner-01/05: `sd_miner_accounts.total_mined`
- miner-02/03/04/09: Core-routed 누적 판매
- miner-06/07: 서버 diamond 상태
- miner-08: 공용 아이템 `lifetime_acquired > 0` 광물 종류 수

기존 `sd_achievement_progress`는 기존 monotonic upsert 규칙을 계속 사용하여 이전 진행도/해금/해금시각을 낮추지 않는다.

## 회귀 계획

PostgreSQL 17 CI에서 먼저 기존 4-2 전체 회귀를 통과시킨 뒤 4-3 migration을 적용한다.

4-3 검사:

- 5개 catalog 존재
- client balance/event DML 금지
- private writer client EXECUTE 금지
- 본인만 balance/event 조회 가능
- v2 → 공용 수량/획득/소비 정확한 백필
- migration journal 중복 없음
- migration 전 시작된 v3 작업을 migration 후 claim 가능
- claim exact-once
- legacy miner quantity snapshot 불변
- single sell 공용 수량 차감 + Core 1회 지급
- oversell 거부 및 wallet 불변
- sell_all item별 exact-once + Core 1회 지급
- retry/replay 중복 없음
- 기존 업적 진행/해금 단조 보존
- 공용 helper event conflict 거부

## 경제

3장에서는 최종 가격을 결정하지 않는다. 4-2의 임시 가격/확률은 호환을 위해 API에 남아 있으며 4막 4장에서 평균/숙련자/이론상 최대/백그라운드/매크로 수익을 다시 계산해 확정한다.

## 미검증 / 다음 Gate

- 실제 Windows 광부 클라이언트의 공용 inventory 렌더링
- Windows 100/125/150% UI
- DEV migration 실제 적용
- Production migration 실제 적용 및 전후 사용자 자산 기준값 비교
- 설치/업데이트/재설치/재부팅/offline recovery
- 다른 확장팩이 공용 광물을 소비하는 실제 E2E
- 4막 4장 최종 경제 밸런스

이 문서/PR만으로 4막 전체 Release Gate PASS를 선언하지 않는다.
