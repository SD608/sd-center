# Presence 연동 규칙

이 폴더는 현재 2-8 Release 후보에 직접 합치지 않고, 관리자 접속현황 앱과 병렬 개발하기 위한 연동 모듈입니다.

## 적용 시점
- 2-8 검증/출시 후보 소스에는 지금 직접 삽입하지 않습니다.
- 2-8 마감 후 최종 종합센터/공식 확장팩 소스에 작은 별도 커밋으로 적용합니다.
- Presence 장애가 지갑/Core 거래를 막아서는 안 됩니다.

## 기본 사용
```js
const { PresenceReporter, createSupabaseRpc } = require("./presence-reporter");

const presence = new PresenceReporter({
  rpc: createSupabaseRpc(supabaseClient),
  appId: "sd.center",
  appName: "SD종합센터",
  appVersion: CURRENT_VERSION,
  deviceId: linkedDeviceId || null,
  intervalMs: 30000,
  onError(error) {
    // 로컬 로그만 기록. 사용자 핵심 기능이나 Core 거래는 중단하지 않음.
  }
});

// 인증 완료 후
await presence.start();

// 정상 로그아웃/종료 직전
await presence.stop();
```

## 필수 규칙
1. `app_id`는 표시 이름과 분리된 안정적인 식별자여야 합니다.
2. 프로세스 인스턴스마다 `instance_id`는 하나만 사용합니다.
3. heartbeat는 기본 30초, 서버 온라인 TTL은 90초입니다.
4. heartbeat 요청이 아직 끝나지 않았으면 다음 heartbeat를 겹쳐 보내지 않습니다.
5. 정상 종료 시 `sd_presence_v1_end`를 보내되, 네트워크 실패/강제 종료 시에는 서버 TTL로 자동 오프라인 처리합니다.
6. Presence 실패를 이유로 reward/spend/transfer, 저장, 앱 실행을 실패 처리하지 않습니다.
7. 인증된 사용자의 Supabase 세션만 사용하며 service role/secret key를 클라이언트에 넣지 않습니다.
8. device_id를 보낼 경우 현재 로그인 사용자 소유의 active/non-revoked device만 사용합니다.
9. 같은 `instance_id`에 다른 app_id/device_id를 재사용하지 않습니다.
10. 종합센터와 각 확장팩은 독립 인스턴스로 보고해야 여러 앱 동시 실행과 `+N` 표시가 정확해집니다.

## 종료/오류 정책
- 최초 heartbeat가 실패하면 Presence 시작만 실패하고 앱 자체는 계속 사용할 수 있어야 합니다.
- 주기 heartbeat 실패는 내부적으로 흡수하고 다음 주기에 다시 시도합니다.
- `start()`/`stop()` 동시 호출은 하나의 작업으로 합쳐 중복 타이머/중복 종료 RPC를 만들지 않습니다.
- 종료 RPC 응답을 못 받아도 90초 TTL이 최종 fallback입니다.

## 2-8 이후 실제 통합 smoke
- 종합센터 로그인 → 30초 heartbeat → 관리자 앱 온라인 표시
- 확장팩 1개/3개/5개 동시 실행 → `+2` 펼침/접기
- 동일 확장팩 2개 실행 → `×2` 표시
- 확장팩 정상 종료 → 해당 앱만 목록에서 제거
- 확장팩 강제 종료 → 90초 이후 자동 제거
- 인터넷 단절 → 기존 Core 거래 영향 없음 → 복구 후 Presence 재표시
- 로그아웃 → Presence 종료, 다른 기기 세션은 유지
