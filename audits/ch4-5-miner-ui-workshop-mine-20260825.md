# 4막 5장 — 새 UI / 작업장·광산 연출

검토일: 2026-08-25  
대상: `SD608/sd-center`  
브랜치: `feat/miner-ui-workshop-mine-v1-20260825`  
PR: **#80 (Draft/Open)**  
상태: **IN_PROGRESS — 실제 Windows 사용자 100/125/150% 시각 검증 전 최종 UI Gate PASS 금지**

## 최신 로드맵 기준

공식 4막 순서:

`4-1 광부 감사 → 4-2 채굴 루프 → 4-3 원석/광물 공용 아이템 → 4-4 장비/비용/성장 → 4-5 UI/광산 연출 → 4-6 Core 연동 → 4-7 밸런스/자동화/시간조작 감사 → 4-8 Release`

CURRENT INDEX 기준 4-5 사용자 UI Gate가 끝나기 전 4-6은 시작하지 않는다.

## UI 구조

### 작업장
- 현재 채굴 도구 / 운반 장비
- 서버 성장 단계 표시 영역
- 장비 강화 액션 자리
- CSS 기반 작업대 / 공구 선반 / 광차 연출
- 공용 광물 보관함
- 광산 이동

### 광산
- CSS 기반 갱도 / 지지대 / 광맥 / 레일 / 곡괭이 연출
- 서버 job 상태 영역
- 채굴 시작 / explicit claim 액션 자리
- cycle / 총 채굴 / 일일 채굴 / 최근 광물
- 공용 인벤토리 요약
- 작업장 이동

## 권한 경계

4-5 UI는 경제 권한을 구현하지 않는다.

- 기본 상태는 `Core 연동 대기`
- Core 어댑터가 없으면 경제 버튼 fail-closed
- 구형 로컬 SQLite 지갑 선택/직접 balance 수정 경로 없음
- 구형 `wallet:*`, `mining:mine`, `shop:*`, 자동채굴 IPC 호출 없음
- UI는 광물 결과/가격/잔액/성장 조건을 최종 판정하지 않음
- 4-6 어댑터가 `window.sdMinerUI.applyState()`로 서버 정본을 전달
- UI 경제 액션은 `sd-miner-ui-action` 이벤트만 발생
- 운영 광부/지갑/사용자 자산 DB write 없음
- `?demo=1`은 UI Gate/CI 전용이며 경제 데이터를 저장하지 않음

## 오류/UI 안전

- SQL/PostgREST/stack trace 원문 표시 금지
- 공개 오류 코드 → 사용자 문구 변환
- busy 상태 중복 클릭 차단 계약
- `innerHTML` 없이 DOM textContent 기반 렌더
- `prefers-reduced-motion` 지원
- 1180 / 920 / 650px 반응형 분기

## 사용자 실제 Windows Gate 실패 이력

### FAIL 1 — PowerShell 의존성

사용자 실제 Windows에서 최초 Gate 후보 실행 시:

- 증상: `'powershell.exe' is not recognized as an internal or external command`
- 영향: UI 후보 자체 실행 불가
- 운영 경제/자산 영향: 없음
- 원인: CMD가 PowerShell/PS1 실행을 전제로 한 래퍼 구조

수정:
- PS1 제거
- CMD가 Edge 직접 탐색
- PowerShell 재도입 정적 금지
- Windows Actions에서 실제 CMD 호출 검증

수정 중 회귀:
- run `32853130870`: `if defined ProgramFiles(x86)` CMD 파싱 문제 FAIL
- run `32853284393`: 괄호 블록에서 `Program Files (x86)` 확장 파싱 문제 FAIL
- label/goto 방식으로 수정
- run `32853443013`: CMD validate-only + Windows render SUCCESS

### FAIL 2 — Edge만 열리고 SD광부 미로드

사용자 실제 Windows에서 두 번째 후보 실행 시:

- 증상: Edge 창은 열리지만 SD광부 화면이 열리지 않음
- 영향: 실제 사용자 UI Gate 진행 불가
- 운영 경제/자산 영향: 없음
- 중요한 누락: 기존 CI는 **CMD가 Edge 실행 명령을 성공적으로 반환하는지만 확인했고, Edge가 실제 SD광부 DOM을 로드했는지는 검사하지 않았음**

기존 실행기는 CMD에서 수제 `file:///.../index.html?demo=1` 문자열을 만들고 `--app`으로 넘겼다. 사용자 실제 경로에서 이 방식이 실패했으므로 해당 실행 방식을 폐기했다. 사용자 경로의 공백/한글 등 정확한 단일 원인을 사용자 PC에서 자동 수집하지 않았으므로 추측으로 확정하지 않는다.

수정 구조:
1. `WINDOWS-UI-GATE.html` 로컬 bootstrap 추가
2. CMD는 쿼리 문자열/file URI를 직접 만들지 않음
3. CMD가 bootstrap의 실제 Windows 파일 경로를 Edge `--new-window`에 전달
4. bootstrap이 상대경로 `./index.html?demo=1`로 이동
5. 네트워크 URL 사용 없음
6. `launcher-e2e.cjs` 추가
7. Windows CI가 실제 CMD 실행 → 실제 Edge 실행 → CDP 연결 → SD광부 DOM 로드까지 검사

새 E2E 필수 판정:
- 페이지 title = `SD광부`
- URL이 `index.html?demo=1`
- `#connectionLabel` = `UI 미리보기`
- `#previewBadge` = `UI PREVIEW`이며 visible
- 작업장 view visible
- 장비 이름 DOM 존재
- 광물 inventory row 정확히 5개
- E2E screenshot 생성

첫 E2E 도입 run `32855492514`에서는 로그상 `miner-ui-v1 CMD -> Edge -> SD광부 E2E PASS`까지 성공했으나, 종료 직후 임시 Edge 프로필 삭제가 `EBUSY`로 실패해 전체 job은 FAIL 처리됐다. 이는 SD광부 로드 실패가 아니라 테스트 cleanup 결함이었다.

cleanup을 retry/non-blocking으로 수정한 run `32855679157`에서는:
- `static-contract`: SUCCESS
- Windows 100/125/150 대응 자동 render: SUCCESS
- CMD validate-only: SUCCESS
- **CMD → Edge → SD광부 실제 navigation E2E: SUCCESS**
- artifact upload: SUCCESS

이 감사 문서 커밋으로 HEAD가 이동하므로 workflow가 다시 실행된다. 최종 exact-head run/artifact/SHA는 PR comment와 로드맵 evidence에 기록한다.

## 현재 Gate 판정

- UI 정적/authority 계약: **PASS (검사 범위)**
- GitHub Windows 2025 자동 렌더: **PASS (검사 범위)**
- PowerShell 없는 CMD 실행기: **PASS (검사 범위)**
- CMD → Edge → SD광부 실제 navigation E2E: **PASS (GitHub Windows 2025 검사 범위)**
- 사용자 실제 Windows 후보 1: **FAIL — PowerShell 의존성**
- 사용자 실제 Windows 후보 2: **FAIL — Edge만 열리고 SD광부 미로드**
- 새 bootstrap/E2E 후보 사용자 실제 Windows 재실행: **미검증**
- 실제 사용자 Windows 100/125/150% 시각 Gate: **미검증**
- 4막 5장 최종 상태: **IN_PROGRESS**

따라서 새 E2E 후보를 사용자 실제 Windows에서 다시 실행하고 100/125/150% 시각 확인하기 전에는 **UI Gate 최종 PASS가 아니며**, 로드맵 4-5를 COMPLETE/PASS/100으로 올리지 않는다.

4-6 Core 경제·업적 연동은 CURRENT INDEX 기준에 따라 4-5 사용자 UI Gate 확인 후 진행한다.
