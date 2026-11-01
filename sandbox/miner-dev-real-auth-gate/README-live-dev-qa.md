# SD-Core-Dev 실제 Auth E2E — 수동 실행 전용

**상태: 도구 연결 환경에서는 Auth 관리자 계정 생성/실제 로그인 실행이 불가능하여 LIVE NOT_RUN.**

- 대상 프로젝트: `SD-Core-Dev` (ref `rwjueffaziiawdebbwpf`)만 허용.
- 운영 `SD608-Online`, main, wallet, 재화, 공식 GameSession 발급은 테스트 범위 밖.
- `dev-auth-e2e.mjs`는 명시적 수동 실행 시에만 임시 Supabase Auth 사용자를 Admin API로 생성하고, 실제 이메일/비밀번호 로그인 JWT를 발급받는다.
- DEV DB에 임시 profile/device를 만든 뒤, active JWT가 Run 서버 미연결로 503을 반환하는지 확인하고, device revoke는 403, 재활성화는 503, session logout은 401/403인지 확인한다.
- 종료 시 테스트 디바이스, 프로필, Auth 사용자를 순서대로 삭제하려고 시도한다. **실패 시 반드시 DEV DB에 잔류 계정/데이터를 확인**해야 한다.
- 이메일은 `sd-miner-qa-<uuid>@example.com` 형태이며 이메일 인증은 Admin API에서 자동 확인한다. 임의 제3자 주소를 사용하지 않는다.
- Password/JWT/refresh/service-role은 로그, 소스, 문서, CI 변수에 저장하지 않는다. **절대 채팅이나 GitHub 이슈에 비밀 키를 붙이지 마.**

## 실행 전 확인

1. Supabase 대시보드에서 프로젝트 **SD-Core-Dev**인지 확인하고, 별도의 DEV 서비스 롤 키를 **신뢰되는 로컬 환경 변수**로만 준비.
2. DEV Edge Function `miner-dev-auth-gate-20261101`에서 `SUPABASE_DB_URL` 서버 환경이 구성됐는지 확인. 없으면 정상 로그인 검증도 503 `DB_NOT_READY`로 **BLOCKED**.
3. Node.js 22 이상 환경에서, 네트워크 접근 가능한 신뢰된 로컬 머신에서 실행.

```powershell
$env:SD_CORE_DEV_PROJECT_REF="rwjueffaziiawdebbwpf"
$env:SD_CORE_DEV_URL="https://rwjueffaziiawdebbwpf.supabase.co"
$env:SD_CORE_DEV_SERVICE_ROLE_KEY="<DEV 서비스 롤 비밀 키를 로컬에서만 입력>"
$env:SD_CORE_DEV_QA_ACK="I_CONFIRM_DEV_ONLY"
node sandbox/miner-dev-real-auth-gate/dev-auth-e2e.mjs
Remove-Item Env:SD_CORE_DEV_SERVICE_ROLE_KEY
```

사전 점검만 하려면 `node sandbox/miner-dev-real-auth-gate/dev-auth-e2e.mjs --preflight`를 실행한다. **사전 점검 성공은 실제 인증 검증 성공이 아니다.**

## 검증 판정

- `LIVE_DEV_AUTH_E2E_PASS`와 모든 `CLEANUP_OK`를 함께 확인해야 일회용 QA의 성공/정리 확인으로 기록한다.
- `GATE_MISMATCH_...`, `AUTH_*_NOT_VALID`, `CLEANUP_FAILED` 또는 `BLOCKED_...`는 PASS가 아니다.
- 이 QA는 공식 Run Authority/게임 세션 발급/Unity Windows/Center/경제·자산의 운영 안전성을 보증하지 않는다.
- 테스트 후 DEV `auth.users`, `auth.sessions`, `profiles`, `devices` 잔류 건수도 별도 재조회할 것.
