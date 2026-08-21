# SD 관리자 도구 — 통합 뷰어

하나의 Windows 관리자 도구에서 아래 두 화면을 전환합니다.

- 로드맵
  - 1~14 챕터
  - 각 챕터 X-1~X-8 상세
  - 전체 진행도 / 챕터별 진행도
  - 자동 새로고침 없음
  - `새로고침` 버튼으로 로컬 `roadmap.json` 재읽기
- 접속 현황
  - 기존 Supabase 관리자 로그인 사용
  - `admin_list_sd_members()` RPC 사용
  - service_role/secret key 미사용
  - 회원/잔액/기기/최근 접속 정보 표시
  - 활동 목록이 서버에서 복수로 제공되면 `첫 항목 +N` 형태로 표시하고 활동 셀 클릭/상세 보기로 펼침
  - 현재 운영 RPC가 복수 동시 실행 앱 목록을 제공하지 않는 경우 `latest_page`만 표시하며 동시 실행을 추정하지 않음

## 실행

Python 3.11+가 설치되어 있으면 `SDAdminCenter.pyw`를 실행합니다.
`.pyw`이므로 Windows에서 콘솔 창이 뜨지 않습니다.

## 로드맵 데이터

첫 실행 시 `%LOCALAPPDATA%\SDAdminCenter\roadmap.json`을 생성합니다.
수정 후 앱에서 `새로고침`을 누르면 반영됩니다.

진행률은 완료된 세부 챕터 수 / 전체 세부 챕터 수로만 계산합니다.
진행 중인 세부 챕터의 임의 퍼센트는 추정하지 않습니다.

## Windows EXE 빌드

```powershell
py -3 -m pip install pyinstaller==6.22.0
py -3 -m PyInstaller --noconfirm --clean --onefile --windowed `
  --name SDAdminCenter `
  --add-data "roadmap.default.json;." `
  SDAdminCenter.pyw
```

출력: `dist\SDAdminCenter.exe`

## 보안

- 앱에 들어가는 키는 Supabase publishable key이며 비밀키가 아닙니다.
- 실제 회원 목록 조회는 서버의 `admin_list_sd_members()`가 `sd_assert_active_admin()`으로 관리자 권한을 검증합니다.
- 관리자 비밀번호와 세션 토큰은 파일에 저장하지 않습니다.
- 접속 상태는 heartbeat 기록 시각 기반이며 실제 소켓 연결 여부로 오인하지 않도록 표시합니다.

## 현재 검증

- 로컬 Python unit test 7/7 PASS
- Python syntax compile PASS
- 운영 DB schema/RPC 권한 경로 read-only 확인
- 실제 Windows EXE 실행/100·125·150% UI 시각 검증은 별도 필요
