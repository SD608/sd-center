# SD Core 실서명 JWT 검증 — DEV 전용 실행 게이트

상태: DRAFT / LIVE TEST NOT RUN. GitHub PR #100은 별도 PostgreSQL 17의 **모의 JWT claim** 검사만 통과한 상태다.

## 실행 조건
- 정확히 SD-Core-Dev 프로젝트 `rwjueffaziiawdebbwpf`의 **전용 일회성 Auth 테스트 사용자**가 필요하다.
- 해당 사용자 이메일 인증/비밀번호 로그인 활성 상태를 사전에 확인한다.
- `SD_CORE_QA_PUBLISHABLE_KEY`에는 DEV의 **publishable key**만 사용한다. `service_role`, secret key, JWT signing secret 금지.
- 인증정보는 로컬 실행 환경변수에만 설정한다. 채팅·GitHub Issue·PR·CI Secrets·Google Drive에 비밀번호나 JWT를 남기지 않는다.
- 스크립트는 테스트 사용자를 만들거나 지갑/기기/원장을 변경하지 않으며 프로젝트 URL을 정확하게 고정 검증한다.
- 본 스크립트를 GitHub Actions에 자동 실행하도록 연결하지 않는다. 사용자 액션이 필요한 실제 로그인 테스트다.

## Windows PowerShell 실행 예시

프로젝트 체크아웃 후 해당 폴더에서 실행. Node.js 22 이상 권장.

```powershell
$env:SD_CORE_QA_URL = "https://rwjueffaziiawdebbwpf.supabase.co"
$env:SD_CORE_QA_PUBLISHABLE_KEY = "<DEV 프로젝트 publishable key>"
$env:SD_CORE_QA_EMAIL = "<DEV 전용 테스트 계정 이메일>"
$secure = Read-Host "DEV test account password" -AsSecureString
$env:SD_CORE_QA_PASSWORD = [System.Net.NetworkCredential]::new("", $secure).Password
$env:SD_CORE_QA_DISPOSABLE = "YES"
node tests/sd-core-auth-boundary/dev_signed_jwt_readonly_smoke.mjs
Remove-Item Env:SD_CORE_QA_PASSWORD,Env:SD_CORE_QA_EMAIL,Env:SD_CORE_QA_PUBLISHABLE_KEY,Env:SD_CORE_QA_DISPOSABLE -ErrorAction SilentlyContinue
```

## 결과 판정

- `DEV_SIGNED_JWT_READONLY_SMOKE_PASS`: 실제 GoTrue 비밀번호 로그인 성공, 서명 JWT로 `/auth/v1/user` 조회, 인증 사용자 권한으로 REST devices 읽기 성공. 정상 서명 JWT/사용자 본인 확인의 제한적 근거다.
- `DEV_SIGNED_JWT_READONLY_SMOKE_FAILED`: 코드에 표시된 유형을 먼저 확인. 인증 오류, 토큰 전달 오류, RLS/권한 오류, 잘못된 대상 등은 별개.
- 이 검사가 성공해도 **폐기 기기 차단, 서명 세션 철회, JWT 만료, 관리자 권한·경제 지급, 동시 거래, Windows/Unity 연결 및 Release Gate는 PASS가 아니다.**
- 테스트 종료 후 DEV 테스트 사용자 및 Auth 세션 정리는 별도 허가받은 관리자 경로에서 증거와 함께 수행. 유저를 임의로 SQL DELETE하지 않는다.

## 중요한 Supabase Auth 정책

Supabase의 로그아웃은 refresh token을 철회하지만, **이미 발급된 access JWT는 통상 만료 시각까지 유효**하다. 따라서 로그아웃 즉시 HTTP 401을 기대하는 테스트는 잘못됐다. 즉시 철회 보장이 필요한 경제·관리자 API라면 별도의 서버 측 `session_id`/사용자·기기 상태 검사와 정책 확정·추가 검증이 필요하다. 본 스크립트는 해당 정책을 구현하거나 판정하지 않는다.

참고: https://supabase.com/docs/guides/auth/signout 및 https://supabase.com/docs/guides/auth/sessions
