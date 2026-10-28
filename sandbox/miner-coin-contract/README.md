# SD광부 v0.9 — Unity / SD Core 경제 연동을 위한 격리 계약 QA v0.1

**DRAFT / NON-PRODUCTION MOCK / NO REAL UNITY–CORE LINK / RELEASE NOT PASS**

## 목적
2026-10-28 Google Drive CURRENT INDEX 및 [기획] SD광부 리메이크 최종 개발안의 사용자 승인 v0.9 A~E **시험값**을 대상으로 중복발행·아이템 소유권·배낭 잔여평가·G2 시험가격 경계를 검증한다. 기존 Electron/Phaser 보상 코드·운영 Supabase DB 및 정식 광부 주화 시스템을 변경하지 않는다.

현재 개발 방향은 **신규 Unity 2D 프로젝트**, 과거 PR #85 Phaser 보스 런타임 및 PR #88 G60 mock은 기록·검증용 참고로 보존. 이 PR은 PR #88의 개발용 Unity 이동 스캐폴드에 쌓는 별도 **Draft**임.

### 사용
\`\`\`sh
node --test sandbox/miner-coin-contract/authority-mock.test.cjs
\`\`\`

테스트의 \`server*\`는 server-authorized 이벤트를 가정해 주입하는 **in-memory fixture** 메서드이지, 게임 클라이언트가 호출할 수 있는 보안 API가 아니다. 실제 공격자/변조/서버 위조 방어 실증이나 PostgreSQL 원자성 증거로 쓰면 안 된다.

### 모형 불변조건
- **승인된 시험 점수**: 광물 1/2/4/8/16; 일반 몬스터 Small 2/6·Medium 3/9·Large 4/12·Elite 6/18·Midboss 8/24; 아비스테르 반복 소재6/8/10/12/24, 영구 심핵0.
- **주화**: 유효 Run에서 서버가 신규 취득을 확인한 자기 배낭 잔여품만 비소비 평가; 배송/물류·이전 자산 제외. 30/60/100/150/210/280/360/450점에서 1~8개, 상한8, 미달점수 Run 간 이월 없음.
- **멀티**: 같은 Run 서로 다른 플레이어의 보상은 개인 분리. 보스 처치·물품 획득 출처가 무단 타인 소유로 전환되면 안 됨.
- **중복**: acquisition event, shipment id, (run,player) 정상 return, recipe 지출 request id의 replay/변경 충돌 분리. UNKNOWN 배송이 해결되기 전 안전 보류.
- **G2**: Lv10+Q10 그라베돈 적법 처치·해당 Run 정상생환·선행 해금 후 선택한 기본 광물 무기 트리 1개 제작법 **8주화** 시험 결제. 여기서 선행 사실은 테스트 fixture로 대체하며 실제 Q00~Q16 통합 구현이 아니다.
- **G1**: **16주화는 시험가격만 승인**. 정확 자격·선행비 미확정이므로 결제 코드는 fail-closed/TBD. 전체 진행비는 24주화가 아님.
- **Unity**: \`EconomyReadOnlyGateway.cs\`는 \`NotConnected\` read-only 상태만 제공, UI/게임이 자체 주화·공식 보상을 발행할 API 없음.

### 향후 실제 시스템 구현 선행 조건 (USER_DECISION_REQUIRED / BLOCKED)
1. **P0 AUTHORITY_MODEL**: 오프라인 Unity 채광/전투 사실을 공식 서버가 어떻게 믿을 수 있게 검증할지. 권고는 서버-권위 Run·획득 원장, 단순 클라이언트 서명·JWT 또는 \`success=true\` 수신 불가.
2. **P0 CENTER_LAUNCH_API**: 실제 배포 Center의 Unity 프로세스 실행, 서명/해시 검증, auth/session/device revocation, 안전한 권위 서버 호출 경로를 소스와 실행으로 확인.
3. **G1 / Q16**: G5~G3 선행 비용, 정확 G1 요구 Lv·퀘스트 및 실제 개인 제작법 원장. 사용자 승인 없는 숫자/해금 배포 금지.
4. **실제 Core**: 단일 원자적 DB 트랜잭션, 저장·원장·return snapshot에 UNIQUE 멱등 경계, G60 60초/24시간+서버귀책 최대24h, 배송권리, 정상생환·사망, 소재 영구 권리 보존. disposable QA 계정의 rollback/ACK-loss/replay/concurrency까지 확인.
5. **실제 Unity/Windows**: Editor import/compile, 테스트 빌드, 사용자 DPI 100/125/150%, 플레이 수급/주화/h/배낭 패킹과 fresh-account Q00~Q16 E2E.

### 실행 환경 / 보증 제한
Node 22 deterministic unit tests **only**. 현재 코드는 프로세스 내 JavaScript Map을 사용하며 DB transaction, 실 계정/지갑, Unity Editor/Center 연결/실게임 인증, 네트워크/경합/멀티/보안 재현은 전부 **NOT_RUN**. Workflow success가 최종 Unity/운영 배포 PASS가 아니다. Main merge·version/manifest·Production DB 변경 및 공식 Release 금지.

## 추적
- 기준 정본: \`00_[AI 최우선] SD종합센터 지금 어디까지·현재 로드맵 INDEX\`, \`[기획] SD광부 리메이크 최종 개발안\` CURRENT 2026-10-28
- 드래프트 연동 명세: \`[DRAFT] SD광부 Unity ↔ SD종합센터·SD Core 안전 연동 계약 v0.1\` 2026-10-24
- 이전 진행상황: \`[진행상황] 4막·5막·6막 광부·카지노 주화 통합 경제 설계\`
- Evidence: \`miner_v09_unity_core_isolated_contract_design_test_20261028\`
