# SD광부 Game Bridge — Windows Named Pipe 기술 계약 v0.1

승인 2026-11-01: 서버 권위 Run A 유지, SD종합센터 ↔ Unity 로컬 IPC로 Windows Named Pipe 방향 선택. 실제 게임 실행/세션 발급/운영 API는 별도 미확정.

## 비운영 샌드박스
- Windows CI에서 실제 Windows Named Pipe를 열어 일회용 테스트 티켓, 인증 실패, 재연결, 권한 취소, 과대 메시지 차단을 검사한다. Linux는 Unix socket으로 회귀검사.
- 현재 validator는 메모리 fixture뿐이다. 공식 SD Core 로그인/기기 조회, 진짜 인증 GameSession, Unity C# NamedPipeClientStream 연결 없음.
- 지원 명령은 PING과 GET_STATUS 모의 조회만. 계좌, 아이템, 주화, 업적 및 월드 사실 쓰기 금지.
- Node net 라이브러리만으로 Windows Pipe DACL, OS Peer PID 및 안전한 세션 전달을 검증하지 못한다. 실환경 권한 증명이 아니라 전송 검증이다.
- 단명 ticket은 실행 인자, 환경변수, 공개 로그, 임의 파일에 노출하면 안 된다. 안전한 발급/전달/채널 바인딩은 미구현.
- 테스트용 appId miner-unity, wire version 1은 공식 확정 ID/프로토콜이 아니다.

## 선행 Center 설치본 감사와의 관계
- 실제 사용자 v2.2.8 설치본에서는 Electron JS child launch 경로 확인, native Unity EXE 실행과 scoped server GameSession 전달 경로는 미확인.
- 본 브랜치는 기존 설치 소스/main을 수정하지 않는 테스트 격리 코드다.
- Windows CI PASS여도 Node→Node IPC 테스트이지 Center→Unity Editor/Windows 정식 통합 성공이 아니다.
- 운영 DB/Core, 기존 사용자 합법 자산, G60, Q16, 공식 버전·manifest·Release 변경 없음. Gate NOT PASS.

Evidence miner_named_pipe_local_transport_windows_ci_20261101.
