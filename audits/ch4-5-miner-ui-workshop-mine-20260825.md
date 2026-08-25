# 4막 5장 — 새 UI / 작업장·광산 연출

검토일: 2026-08-25  
대상: `SD608/sd-center`  
브랜치: `feat/miner-ui-workshop-mine-v1-20260825`  
PR: **#80 (Draft/Open)**  
상태: **IN_PROGRESS — 실제 Windows 사용자 시각 검증 전 최종 UI Gate PASS 금지**

## 최신 로드맵 기준

공식 4막 순서:

`4-1 광부 감사 → 4-2 채굴 루프 → 4-3 원석/광물 공용 아이템 → 4-4 장비/비용/성장 → 4-5 UI/광산 연출 → 4-6 Core 연동 → 4-7 밸런스/자동화/시간조작 감사 → 4-8 Release`

작업 시작 전에 CURRENT INDEX, 프로젝트 메모리·개발 로드맵, `SD종합센터 로드맵 상태 원본 v1`을 재확인했다. 실제 GitHub 근거와 Sheet가 어긋나 있던 4-1~4-4는 PR/CI 증거로 동기화했고 4-5는 STARTED/IN_PROGRESS로 기록했다.

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

`?demo=1`은 CI/디자인 렌더 전용 샘플 상태이며 운영 데이터와 분리돼 있고 경제 데이터를 저장하지 않는다.

## 오류/UI 안전

- SQL/PostgREST/stack trace 원문 표시 금지
- 공개 오류 코드 → 사용자 문구 변환
- busy 상태에서 경제 버튼 연타 차단 가능 계약
- `innerHTML` 없이 DOM textContent 기반 렌더
- `prefers-reduced-motion` 지원
- 고정 `min-width:930px` 제거
- 1180 / 920 / 650px 반응형 분기

## Windows Gate 실행기 실사용 버그와 수정

2026-08-25 22:21 KST 사용자 실제 Windows에서 첫 Gate 후보를 실행했을 때 다음 오류가 확인됐다.

- 증상: `'powershell.exe' is not recognized as an internal or external command`
- 영향: UI 자체를 열 수 없어 실제 사용자 Windows Gate 진행 불가
- 등급: **High (검증 후보 실행 차단)** — 운영 경제/자산에는 영향 없음
- 원인: `RUN-WINDOWS-UI-GATE.cmd`가 `powershell.exe` PATH 존재를 전제로 PS1을 호출하는 래퍼 구조였음

수정:
1. `RUN-WINDOWS-UI-GATE.ps1` 제거
2. CMD가 `Program Files (x86)` / `Program Files` / `where msedge.exe` 순서로 Edge를 직접 탐색
3. CMD가 로컬 `file:///.../index.html?demo=1` URI를 생성해 Edge app mode로 실행
4. `SD_UI_GATE_VALIDATE_ONLY=1` 검증 모드 추가
5. 정적 계약에서 PowerShell 문자열 및 PS1 재도입을 금지
6. Windows Actions가 실제 `cmd.exe`로 Gate CMD를 호출하도록 회귀 추가

수정 과정에서 CI가 추가로 두 문제를 정확히 검출했다.

- run `32853130870`: `if defined ProgramFiles(x86)`의 CMD 괄호 파싱 문제로 FAIL
- run `32853284393`: validate-only 괄호 블록 안에서 `C:\Program Files (x86)\...` 값을 확장해 다시 파싱 오류가 발생하여 FAIL
- 최종 수정: 괄호 블록을 제거한 label/goto 흐름으로 전환
- 구현 검증 head `1960f595e8a9027d759696f29b289cbffbac7030`
- run `32853443013`: static-contract + Windows render + **실제 CMD launcher validate-only 호출 + artifact 생성 전부 SUCCESS**

새 후보 artifact:
- artifact id: `9565203180`
- artifact SHA-256: `311a6fdc4b57901f0614d5cceab5865ce29c24702678353d2664ab77c96443d0`
- 다운로드 후 동일 SHA-256 재확인
- ZIP 내부 6개 파일: `CONTRACT.md`, `index.html`, `RUN-WINDOWS-UI-GATE.cmd`, `styles.css`, `ui.js`, `WINDOWS-UI-GATE.txt`
- `.ps1` 파일 0개
- CMD 내 `powershell` 토큰 없음
- demo-only `?demo=1` 및 validate-only 계약 확인

따라서 최초 사용자 후보는 **FAIL**, 수정 후보는 **Windows CI/패키지 검사 범위 PASS**로 기록한다. 아직 수정 후보를 사용자의 동일 실제 Windows에서 재실행하지 않았으므로 실제 사용자 UI Gate는 미검증 상태다.

## 자동 검증 결과

Workflow: `Miner UI Workshop Mine v1`

검사:
1. UI JS syntax
2. 필수 작업장/광산 DOM 계약
3. 구형 로컬 지갑/채굴/상점 authority 호출 금지
4. default fail-closed / demo opt-in
5. 공개 오류 변환 / innerHTML 미사용
6. responsive breakpoint / reduced motion
7. Windows 2025 Edge 렌더
8. 작업장·광산 100/125/150 대응 크기 프록시에서 horizontal overflow / viewport 밖 패널·버튼 / 지나치게 작은 버튼 검사
9. PowerShell 없는 CMD Gate 실행기 실제 validate-only 실행
10. Windows PNG 6장 + 사용자 Gate 후보 artifact 생성

초기 자동 렌더 run `32819159446`:
- `static-contract`: **SUCCESS**
- `windows-render`: **SUCCESS**
- Windows render artifact id: `9552474151`
- 렌더: 작업장/광산 각각 100/125/150 대응 크기, 총 PNG 6장

CMD-only 수정 구현 검증 run `32853443013`:
- `static-contract`: **SUCCESS**
- `windows-render`: **SUCCESS**
- `Validate Windows Gate launcher through CMD`: **SUCCESS**
- Gate candidate artifact: `9565203180`
- Gate candidate SHA-256: `311a6fdc4b57901f0614d5cceab5865ce29c24702678353d2664ab77c96443d0`
- render artifact: `9565202402`

AI가 생성된 Windows 자동 렌더 PNG를 확인한 범위에서는 패널·버튼의 명백한 잘림/겹침/화면 이탈을 발견하지 못했다. 이 검사는 GitHub Windows runner + Edge 자동 렌더 증거이며 사용자의 실제 Windows 후보를 직접 본 것이 아니다.

이 감사 문서 기록 커밋으로 HEAD가 이동하므로 workflow가 이 문서 경로도 감시하며 최종 HEAD에서 동일 검증을 다시 실행한다. 최종 exact-head run은 PR comment 및 로드맵 evidence에 기록한다.

## Gate

현재 판정:
- UI 정적/authority 계약: **PASS (검사 범위)**
- GitHub Windows 2025 자동 렌더: **PASS (검사 범위)**
- CMD-only Windows Gate 실행기: **PASS (Windows CI 검사 범위)**
- 첫 사용자 실Windows 후보 실행: **FAIL — PowerShell 의존성, 수정 완료**
- 수정 후보 사용자 실Windows 재실행: **미검증**
- 실제 사용자 Windows 100/125/150% 시각 Gate: **미검증**
- 4막 5장 최종 상태: **IN_PROGRESS**

따라서 수정 후보를 사용자 실제 Windows에서 다시 실행하고 100/125/150% 시각 확인하기 전에는 **UI Gate 최종 PASS가 아니며**, 로드맵 4-5를 COMPLETE/PASS/100으로 올리지 않는다.

4-6 Core 경제·업적 연동은 CURRENT INDEX 기준에 따라 4-5 사용자 UI Gate 확인 후 진행한다.
