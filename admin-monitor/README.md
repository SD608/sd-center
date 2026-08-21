# SD 사용자 현황

SD종합센터와 분리된 관리자 전용 Windows 운영 도구입니다.

## 제공 기능
- 전체 사용자 온라인/오프라인 현황
- 사용자별 실행 중 앱/확장팩 표시
- 3개 초과 실행 앱은 `+N`으로 접고 클릭 시 전체 펼침
- 동일 확장팩 다중 인스턴스는 `×N` 표시
- 사용자 상세, 계좌번호, 잔액, 최근 거래 조회
- 관리자 입금/출금
- Presence heartbeat 30초, 90초 이상 미수신 시 오프라인 판정

## 경제 안전성
앱은 `wallets.balance`를 직접 수정하지 않습니다. `sd_admin_v1_adjust_wallet`만 호출하며 서버에서 SD Core의 `apply_server_wallet_delta_impl`로 전달됩니다.

입출금 요청은 UUID `request_id`를 사용합니다. 요청 전 로컬 `userData/pending-wallet-adjustment.json`에 원자적으로 기록하고, 응답 유실/5xx/강제 종료 후에도 같은 ID를 재사용합니다. 성공 또는 명확한 실패가 확인되기 전에는 다른 입출금 요청으로 교체하지 않습니다.

관리 API는 `sd_admin_v1_*` 규격으로 고정해 Core 내부 구조가 바뀌어도 어댑터 계층만 수정할 수 있도록 분리했습니다.

## 보안
- Electron `contextIsolation`, sandbox 사용
- renderer의 Node 및 네트워크 접근 차단
- 브라우저 권한/새 창/외부 이동 차단
- 서비스 역할 키 사용 금지, publishable key만 사용
- 관리자 권한은 서버 `profiles.role/status`에서 매 요청 검증
- Presence 테이블 직접 접근 권한 없음
- 내부 SQL/PostgREST 오류 원문을 UI에 노출하지 않음

## 검사
`npm run check`, `npm test`, `npm run test:bug`, `npm run test:error`, `npm run build:win`

실제 운영 DB migration과 홈페이지 변경은 Release Gate에 따라 별도 적용합니다. 이 브랜치의 존재나 CI 빌드 성공은 운영 배포 완료를 의미하지 않습니다.
