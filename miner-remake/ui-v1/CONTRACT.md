# SD광부 UI v1 계약 — 4막 5장

이 폴더는 **UI/작업장·광산 연출 전용**이다. 4막 6장 Core 연동 전에는 운영 경제 데이터를 직접 읽거나 수정하지 않는다.

## 권한 경계

- 금지: 로컬 SQLite 지갑 직접 접근
- 금지: 구형 `wallet:*`, `mining:mine`, `shop:*` IPC 호출
- 금지: 클라이언트에서 광물 결과/가격/장비 비용/잔액을 최종 판정
- 기본 실행은 `connection=waiting`이며 경제 버튼은 비활성화
- `?demo=1`은 CI/디자인 미리보기 전용이며 운영 데이터를 변경하지 않는다.

## 서버 → UI

4막 6장 어댑터는 `window.sdMinerUI.applyState(state)`만 호출한다.

```js
{
  connection: "waiting" | "ready" | "error",
  busy: boolean,
  totalMined: number,
  dailyMined: number,
  dailyLimit: number,
  lastOre: "stone" | "copper" | "iron" | "emerald" | "diamond" | null,
  inventory: { stone, copper, iron, emerald, diamond },
  tool: { level, name, cycleMs, next },
  storage: { level, name, capacity, next },
  job: { status: "idle" | "active" | "ready", id, readyAt }
}
```

UI는 입력을 표시용으로 정규화할 뿐 경제 판정을 하지 않는다.

## UI → 4막 6장 어댑터

경제 동작은 `window`의 `sd-miner-ui-action` 이벤트로만 전달한다.

현재 action:

- `start`
- `claim`
- `upgrade-tool`
- `upgrade-storage`
- `sell-all`

4막 6장에서는 이 이벤트를 server v3 RPC의 request-id exact-once 경계에 연결한다. UI 버튼 연타 중복 방지는 `busy` 상태로 처리하고, 경제적 정확성은 Core/서버가 최종 보장한다.

## 오류 표시

서버/어댑터는 원문 SQL/PostgREST/stack trace를 UI에 넘기지 않는다. 공개 오류 코드를 받은 뒤 `window.sdMinerUI.showError(code)`로 전달한다.

UI 내장 코드:

- `AUTH_REQUIRED`
- `SESSION_EXPIRED`
- `DEVICE_REVOKED`
- `MINER_STORAGE_FULL`
- `MINER_JOB_NOT_READY`
- `MINER_DAILY_LIMIT`
- `INSUFFICIENT_FUNDS`
- `NETWORK_UNAVAILABLE`

알 수 없는 오류는 일반 문구로 표시한다.

## UI Gate 경계

자동 Windows 렌더/정적 회귀가 성공해도 실제 Windows 사용자 시각 검증 전에는 최종 UI Gate PASS가 아니다. 100% / 125% / 150% 배율 실제 후보 확인은 후속 실환경 Gate에 남긴다.
