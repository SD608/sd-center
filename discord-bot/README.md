# SD종합센터 디스코드 공지봇 v1.1

SD종합센터와 확장팩의 새 버전을 감지해 지정한 디스코드 채널에 자동 공지하는 전용 봇입니다.

## 기능

- `update/center-update.json`의 센터 버전 변경 감지
- `update/extensions-catalog.json`의 확장팩 버전 변경 감지
- 첫 실행에서는 현재 버전을 기준점으로 저장하고 과거 업데이트는 공지하지 않음
- 이후 버전이 바뀔 때만 `UPDATE_CHANNEL_ID` 채널에 Embed 공지
- Supabase 연결 및 잔액/랭킹 조회 기능 없음

## 설정

`.env.example`을 `.env`로 복사한 뒤 값을 채웁니다.

```env
DISCORD_TOKEN=...
UPDATE_CHANNEL_ID=...

UPDATE_POLL_INTERVAL_MS=60000
CENTER_UPDATE_URL=https://sd608.github.io/sd-center/update/center-update.json
EXTENSIONS_CATALOG_URL=https://sd608.github.io/sd-center/update/extensions-catalog.json
```

기존 `/잔액 조회`, `/랭킹 조회` 명령어를 이미 등록했다면 `.env`에 `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`도 남겨두고 한 번만 아래 명령을 실행하세요.

```powershell
npm.cmd run clear:commands
```

## 설치 및 실행

Node.js 24.17 이상을 사용합니다.

```powershell
npm.cmd install
npm.cmd start
```

정상 실행되면 다음과 비슷하게 표시됩니다.

```text
[SD종합센터 공지봇] MyBot#0000 로그인 완료
[업데이트 공지] 현재 버전을 기준점으로 저장했습니다.
```

기본 확인 주기는 60초이며 최소 30초입니다. 업데이트가 감지되면 예를 들어 다음과 같이 공지합니다.

```text
📢 SD광부 업데이트
v1.1.0 → v1.1.1
변경 내용: ...
```

상태는 로컬 `data/update-state.json`에 저장됩니다. Bot Token은 절대 GitHub나 채팅에 공개하지 마세요.
