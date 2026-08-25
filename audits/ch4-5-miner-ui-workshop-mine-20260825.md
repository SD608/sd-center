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
9. Windows PNG 6장 artifact 생성

검증 run `32819159446`:
- `static-contract`: **SUCCESS**
- `windows-render`: **SUCCESS**
- Windows render artifact id: `9552474151`
- artifact size: `2,058,086 bytes`
- artifact SHA-256: `f7eda09cf7c9ef842035555e4b918fd103fdcce06bcfd984767b03b58b4d2b8e`
- 렌더: 작업장/광산 각각 100/125/150 대응 크기, 총 PNG 6장

AI가 생성된 Windows 자동 렌더 PNG를 추가 확인한 범위에서는 패널·버튼의 명백한 잘림/겹침/화면 이탈을 발견하지 못했다. 이 검사는 GitHub Windows runner + Edge headless의 자동 렌더 증거이며 사용자의 실제 Windows 후보를 직접 본 것이 아니다.

감사 문서 기록으로 HEAD가 이동하므로 workflow가 이 문서 경로도 감시하며, 최종 HEAD에서 동일 검증을 다시 실행한다.

## Gate

현재 판정:
- UI 정적/authority 계약: **PASS (검사 범위)**
- GitHub Windows 2025 자동 렌더: **PASS (검사 범위)**
- 실제 사용자 Windows 100/125/150% 시각 Gate: **미검증**
- 4막 5장 최종 상태: **IN_PROGRESS**

따라서 실제 사용자 Windows 후보의 100/125/150% 시각 확인 전에는 **UI Gate 최종 PASS가 아니며**, 로드맵 4-5를 COMPLETE/PASS/100으로 올리지 않는다.

4-6에서 서버 v3 / Core 경제·업적 어댑터를 연결하고, 4-8에서 설치·업데이트·재실행·재부팅·오프라인·기존 userData와 실제 Windows UI Gate를 마감한다.
