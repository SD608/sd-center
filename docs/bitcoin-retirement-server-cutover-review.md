# SD비트코인 서버 휴업 전환 검토서 (DRAFT / NOT DEPLOYED)

2026-11-06. 사용자 요청에 따른 독립 코드 후보와 QA 증빙. 정본 정책 변경이나 운영 배포 근거가 아님.

## 현재 확인한 사실
- 기존 BTC·시설·SD Core 지갑·거래·업적·칭호·계정/원본 소스는 보존. 별도 현금화·시설 환불 취소.
- 운영 인증 사용자 권한으로 BTC 채굴 tick, room/frame/GPU 구매, 전기 재가동, BTC 판매, 구형 snapshot upsert 등 7개 함수 호출 가능.
- tick은 누적 채굴·전기세 차감·GPU 내구도 감소를 발생시킬 수 있고 sell은 Core 지갑 증가 기능을 호출함.
- 기존 상태 조회 함수 2개는 private ensure_account를 호출해 존재하지 않던 비트코인 계정과 기본 방을 생성할 수 있음. 7개 경제 RPC 차단만으로는 모든 신규 데이터 생성 차단 불충분.
- 기존 운영 Supabase BTC 테이블은 authenticated INSERT/UPDATE/DELETE 직접 권한이 없고, 구형 SD Link push는 신규 양수 입금을 거부. 단 이 사실만으로 전체 경제 우회 부재 판정 불가.

## 구현 후보
1. docs/bitcoin-retirement-server-rpc-revoke-candidate.sql — BTC 경제/legacy upsert 7개 RPC 실행권한 회수 (운영 미적용).
2. docs/bitcoin-retirement-readonly-getters-candidate.sql — 상태 조회 2개에서 lazy 계정 생성 제거, 이미 존재하는 사용자의 조회 데이터 형식 보존 (운영 미적용).
3. tools/test-bitcoin-retirement-rpc-acl-fixture.sql, -assert.sql 및 test-bitcoin-retirement-readonly-getters.sql — PostgreSQL17 격리 테스트.
4. .github/workflows/test-retired-bitcoin-rpc-acl.yml — 운영 DB와 무관한 CI.
5. 기존 PR #86 UI Preview v0.24 상점 비노출·설치 요청 거부와 Pages ZIP 삭제 후보 유지.

## 격리 검증
PostgreSQL17 테스트는 권한 회수, 정상 조회, 타 앱 SD Link 권한 보존, 기존 BTC/시설 불변, 미가입자 계정·방 신규 생성 거부, 후보 SQL 재실행을 검사. CI run 42169779838 성공. Windows v2.2.7 기반 패치 CI 42169779879는 실제 사용자 v0.24 배포본 시험과 다름.

## 운영 적용 전 필수 Gate
- 운영 계정·BTC/시설·GPU 내구·SD머니 지갑·거래·업적/칭호 스냅샷 및 복구 가능 백업.
- 현재 함수 시그니처·정의·호출권한과 후보 파일의 일치 확인.
- 구버전 클라이언트/수동 ZIP/REST/legacy Link/서버 Core/오프라인 복귀 경제 악용 경로·자산 무손실 E2E.
- Windows 실제 v0.24 후보 신규 설치/업데이트/재설치/종료·재실행/재부팅/오프라인/배율 100·125·150% 검증.
- Release Gate Critical/High 0건 확인 전 main merge/운영 SQL/공식 manifest/version/Release/Pages 변경 중단. 운영 적용 자체의 안전성도 별도 검증 필요.
- 직접 ZIP URL 404, 공개 상점 비노출, 이전 설치기와 사용자 자산 보존을 실제 배포 이후 다시 검증. 실패 시 롤백·복구 절차는 변경 대상에 맞게 별도 사전 승인 및 리허설.

## 읽기 전용 운영 집계 (2026-11-06)
BTC 계정 1, BTC 합계 126.85, 보유 방 5, GPU 75, GPU 내구 합계 7500, snapshot 1, BTC actions 0, SD Core wallet 8, SD머니 지갑 총합 5,102,598,191, 거래 14,858. 개별 사용자 식별정보 및 개인 거래 미표시.

**최종 상태: DRAFT / CI_SCOPE_PASS / LIVE_ECONOMY_BLOCKED / RELEASE_GATE_NOT_PASS / 운영 DB 쓰기 0.**
