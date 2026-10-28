# SD종합센터 v2.2.8 설치본 정적 감사 ↔ Unity Bridge 정책 초안

상태: **ACTUAL UPLOADED CENTER SOURCE STATIC READ COMPLETE / UNITY LAUNCH & AUTH NOT_IMPLEMENTED / DRAFT**.

사용자 제공 `app-2.2.8.zip` SHA256: `96eeeb71c028868b267553a2947dc4951b41214a9d858c1cae536bb149b789c9`.
해당 ZIP의 `resources/app/package.json`에 `version=2.2.8` 명시. 이전 Windows 바로가기에서 `app-2.2.82` 경로가 관찰되었으나 업로드 ZIP이 실제 현재 실행중인 최신 버전인지는 미검증. ZIP의 원본/사용자 데이터/바이너리는 GitHub에 복사하지 않았으며 로컬에서 소스 정적 검사만 수행.

## 업로드한 설치본의 실제 코드 판독

| 소스 범위 | 확인 결과 |
|---|---|
| `resources/app/main.js` 335~422 | 등록된 자식 앱은 `runChildMode`에서 `entry.entry || 'main.js'`를 `require()`하는 Electron 앱 |
| `resources/app/main.js` 1842~1869 / 1937~1977 | `process.execPath` + `--sd-child-app=<id>`로 동일 SDCenter.exe Electron 자식 실행 |
| `resources/app/preload.js` 19~63 | `sdCenter.launchApp` → `center:launch-app`; native game session/Bridge IPC 미존재 |
| `resources/app/src/app-registry.js` 159~315 | ZIP의 `package.json`/선택적 `sd-app.json` 및 entry 검사. `native-windows-exe` 설치/실행 분기 없음 |
| `resources/app/main.js` 1034~1053 | 공식 ZIP 확장팩은 기대 SHA256와 실제 다운로드 ZIP 비교. Unity .exe의 서명, 설치 후 rehash 및 서버 실행권 검증은 별개 |
| `resources/app/src/sdlink-integration.js` 115~212 | SD Link config/online-session.dat 존재·상태 기반 UI. 유효한 signed Unity PlaySession 자체가 아님 |
| `resources/app/src/sdlink-integration.js` 101~140 | deviceKey/유저 식별자를 포함하는 별도 로컬 binding 기록. Unity에 인증키로 전달하거나 파일 존재만으로 보상 허용 금지 |
| `resources/app/main.js` 2793~2799 | Center Renderer Electron sandbox/contextIsolation 보호 설정 존재. Unity 엔진 권한까지 보장하지 않음 |

## 이 PR의 범위

- `launch-policy.cjs`: **절대 실행하지 않는** fail-closed 자격 검사. official signed catalog attestation + 실제 파일 digest/realpath + trusted server-scoped active nonrevoked device Run session 세 가지 조건이 모두 있어야 `POLICY_ELIGIBLE_ONLY`. 자체 인증 제공·프로세스 실행·지갑 접근 안 함.
- `launch-policy.test.cjs`: 구형 JS entry/경로 탈출·잘못된 digest·단순 SD Link 연결 UI만 존재·권한 취소·session 만료·예외 누출 등에 관한 Node22 격리 단위 테스트.
- 실제 Unity.exe 실행, Windows Named Pipe, Center 토큰 보관/수명, 공식 catalog signing/certificate, server authoritative Run, device revocation, SD Core ledger 연동 모두 **NOT_RUN/BLOCKED**.

## 승인 경계

서버 권위 Run A는 사용자 승인됨. 다만 **API 프로토콜·official Unity app ID·파일 서명 방식·Center session 발급 주체·IPC 운송·native EXE 직접 실행 정책은 기술 초안이며 정본 승인을 가장하지 않는다.**
`POLICY_ELIGIBLE_ONLY`는 인증 성공이나 실제 실행 성공이 아님. mock verifier를 production에서 사용하면 보안 결함이므로 금지.
운영 유저 지갑, 배포 Center, main, 공식 버전/manifest, Supabase 변경 없음. Release Gate **NOT PASS**.

## Release 선행조건

1. 실제 Center v2.2.8 또는 이후 최신 소스와 설치 패키지의 동일성 검증
2. 신뢰된 실제 Windows exe PID/무결성/서명과 런처 allowlist, atomic 업데이트/rollback 설계
3. 센터와 신뢰 서버가 계정·device revocation을 검증해 짧은 scoped game session 발급, Unity가 장기 토큰/서비스키에 접근 불가
4. Unity ↔ Bridge IPC 인증·권한 분리·재접속/중복 실행 정책과 별도 Windows CI/E2E
5. 확정된 world Run/loot/G60 및 Core 경제 트랜잭션 검증, user legal asset 원장 보호, Q16 실게임 E2E

Evidence: `miner_center228_uploaded_runtime_static_audit_contract_draft_20261028`.
