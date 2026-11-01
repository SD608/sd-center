# SD광부 Core-issued Game Session + Center 전달 분리 v0.1

**2026-11-01 사용자가 동의한 아키텍처**
- 공식 SD Core 측 **신뢰 서버만** 유효한 게임 세션을 발급·인증한다.
- SD종합센터 Center는 검증된 Unity 프로세스에 **로컬 Windows Named Pipe 통로로 전달만** 한다. Center는 게임 세션·광산 보상·아이템 권한을 생성하거나 정산하지 않는다.
- Unity는 입력·게임 렌더링/예측만 담당한다. 공식 Run·광맥·몬스터·획득·생환 사실은 신뢰된 게임 서버가 검증하고 SD Core가 최종 자산을 정산한다.

**승인 범위**: 세션 *발급 주체와 책임 분리*의 설계 승인. 실제 토큰 타입/서명 규격/TTL, 앱 ID, API route/RPC, Windows OS pipe ACL, launcher bootstrap, 온라인 로그인·세션/기기 취소 검증 방법, 서버 운용방식, 운영 DB 변경은 **아직 기술 초안 또는 미확정**.

## 비운영 데모
- `mock-core-session.cjs`: 프로젝트에 연결하지 않은 순수 Node 인메모리 Mock. 시뮬레이션 권위 callback으로 임시 무작위 ticket을 만들고, 서버 승인·소유 Run·기기 활성·빌드 일치·만료 재검증 후에만 1회 사용.
- `createCenter`: `deliver` callback만 주입받아 opaque ticket을 한 번 전달하는 흉내. 게임 세션 issuer, wallet, 게임/광산 보상 mutation 함수 없음.
- `mock-core-session.test.cjs`: 이 모델과 부모 PR #92의 실제 Windows named pipe(Windows 러너)/Unix socket(Linux 러너)를 조합해 발급·권한 취소·기기 소유/Run 변경·반복사용/클라이언트 위조 차단을 검증한다.
- 테스트가 입력한 server callback은 **실제 SD Core 인증 근거가 아님**. 이 파일을 진짜 Core issuer로 배포하면 보안 결함임. 테스트 grant 전달 예는 공식 로그인 비밀을 취급하지 않으며 실환경에서는 초기 보안 채널·OS PID/서명/ACL binding 후 비밀 유출 없는 전달이 필요.
- Core issuer 모델은 클라이언트가 요청한 본인 신분·Run·보상 수치를 신뢰하지 않도록 되어 있지만 callback 권위 원천이 가짜임. 새 공식 로그인 세션 API가 존재하거나 연동되었다는 뜻이 아님.

## 실제 작업 분리 및 보류
1. 인증 및 기기 확인: 실제 Supabase Auth 사용자·active/nonrevoked device 확인 및 session/token revocation 재조회, 공식 Run membership/fencing 정책 구현 **NOT_RUN**.
2. 실제 Center 코드: 업로드 설치본 v2.2.8은 Electron `--sd-child-app` 전용. Native Unity EXE installer/launcher·PID 서명/무결성·Windows Named Pipe OS ACL과 안전한 세션 bootstrap **NOT_IMPLEMENTED**.
3. Unity 게임 C# client와 Windows 에디터·실제 게임서버 연결 **NOT_RUN**.
4. 공식 광부 주화·업적·G60 배송·SD Core ledger RLS/원자성·실경쟁/시즌 공유, Q16 엔드투엔드 **NOT_RUN**.
5. 운영 Supabase, 기존 사용자 지갑/합법 아이템, `main`, 공식 버전 및 확장팩 manifest·Release **무변경**.

CI **Mock pass ≠ 실제 Core/Center/Unity session pass**. 이 브랜치는 격리 실험이며 Release Gate는 **NOT PASS**.

Evidence: `miner_core_only_issuer_center_relay_contract_20261101`.
