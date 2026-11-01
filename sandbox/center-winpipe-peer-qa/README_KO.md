# SD광부 Windows Game Bridge 피어 검증 — 비운영 실험

## 판정
- 사용자 확정: (1) 공식 Run은 신뢰 서버 권위, (2) Center↔Unity 로컬 IPC는 Windows Named Pipe.
- 이번 범위: .NET 8 Windows runner 내 서로 다른 두 테스트 프로세스가 실제 Named Pipe를 연결했을 때 운영체제 PID/Windows 세션 ID, 이미지 경로와 SHA-256을 조회·대조.
- 실제 증거: GitHub Draft PR #93, Windows Actions run #41305682523, harness 10/10 PASS.
- **운영 센터 실행·Unity 프로세스·SD Core 인증/지급/DB 연동·Windows 다른 사용자 ACL 거부 테스트는 미구현/NOT_RUN. Release Gate NOT PASS.**

## 구현
- NamedPipeServerStream + PipeOptions.CurrentUserOnly + PipeOptions.Asynchronous.
- Windows GetNamedPipeClientProcessId / GetNamedPipeClientSessionId로 연결된 pipe handle의 피어 정보 조회.
- OS PID는 테스트가 실제로 실행한 child PID와 일치 확인. child 이미지 경로와 SHA256 digest는 테스트가 예상한 파일과 비교.
- 일회용 임시 nonce 재사용 거부, 새 nonce 재접속 허용, 검증 가능한 디바이스·세션의 모의 취소/만료, 주화/전리품 쓰기 명령 무조건 거부, READ_ONLY 응답만 허용.
- CI 단계에서 dotnet publish win-x64 후 실행. parent PR #92 Node IPC 모형과는 독립적인 **OS 피어 스모크 테스트**.

## 엄격한 미검증·보안 경계
- CurrentUserOnly는 같은 사용자 제한 옵션을 켠 것일 뿐 **다른 Windows 사용자 계정이 실제 거절되는 E2E는 하지 않음**. 공식 출시 전 사용자 SID/토큰 ACL 검증·다중 Windows 세션·관리자 상승·저무결성 프로세스 접근 검증 필요.
- PID/프로세스 경로/해시만으로 Unity 인증을 완료할 수 없음. 프로세스 주입, PID 재사용, 프로세스 파일 교체 및 파일서명 신뢰·공식 업데이트 검증이 별도 필요.
- 이 실험은 **임시 nonce를 커맨드라인으로 전달하는 QA fixture**를 사용한다. 이 방식을 실제품 세션토큰·로그인 비밀·기기 키에 재사용하면 안 됨. 실제 신뢰 브리지는 안전한 초기 채널을 만들어 토큰을 다른 프로세스에 노출하지 않고 전달해야 함.
- 서버 승인, deviceActive, revoked, expiresAtMs 등은 테스트가 고정값으로 생성하는 **모의 데이터**일 뿐 SD Core 인증 결과가 아니다.
- Win32 API OS 확인 성공은 실제 Unity C# NamedPipeClientStream와 Center Electron Main bridge를 통한 실행 성공이 아니다.
- 실제 적격 경제 변경은 권위 서버가 Run/item/return facts를 검증하고 SD Core가 정확 1회 원자적 소유권/보상 정산하는 별도 승인 구조를 따른다. 이 코드에서 경제 변경 RPC 없음.

## 다음 필요한 검증
1. Center 실제 source의 native Unity EXE 관리 실행 경로와 Official Build digest/서명 정책(DRAFT, 사용자 승인 전 정본 반영 금지).
2. 런처가 실제 프로세스 handle·이미지 무결성·Windows pipe ACL/SID와 peer PID를 함께 확인하고 안전하게 부트스트랩한다는 E2E.
3. 센터가 서버 인증 로그인·active nonrevoked device·game scope·run owner/TTL을 확인하여 **짧은 범위 권한**을 발급하고 연결 중 취소 시 즉시 fail closed 되는지 검증.
4. Unity Editor/Windows 실환경 테스트, G60·Run/Core 합법 자산·Q16 및 Release Gate 증거.

운영 main/Supabase/기존 유저 자산·공식 버전/manifest/릴리즈 변경 없음.
Evidence: miner_winpipe_os_pid_image_smoke_pr93_20261101.
