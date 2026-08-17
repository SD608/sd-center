# SD종합센터 디스코드 봇 v1

SD종합센터의 Supabase 데이터를 읽어 디스코드에서 잔액/랭킹을 조회하고, 센터 또는 확장팩 업데이트가 배포되면 지정 채널에 자동 공지하는 봇입니다.

## 기능

- `/잔액 조회`
  - `닉네임` 옵션을 생략하면 디스코드 표시 이름/사용자명과 같은 SD종합센터 닉네임을 찾습니다.
  - 닉네임이 다르면 `/잔액 조회 닉네임:내닉네임`처럼 직접 입력할 수 있습니다.
  - 응답은 본인에게만 보이는 메시지(ephemeral)로 표시됩니다.
- `/랭킹 조회`
  - 기존 홈페이지와 동일하게 `list_sd_member_wallets` RPC 결과를 잔액순으로 정렬합니다.
  - 관리자 계정은 제외하고 상위 10명을 표시합니다.
- 업데이트 자동 공지
  - `update/center-update.json`의 센터 버전 변경 감지
  - `update/extensions-catalog.json`의 각 확장팩 버전 변경 감지
  - 첫 실행에서는 현재 버전만 기준점으로 저장하고 과거 버전은 공지하지 않습니다.
  - 이후 버전이 바뀔 때만 `UPDATE_CHANNEL_ID` 채널에 공지합니다.

## 1. Discord 애플리케이션 만들기

Discord Developer Portal에서 새 Application을 만들고 Bot을 추가합니다.

필요한 값:

- Bot Token → `DISCORD_TOKEN`
- Application ID → `DISCORD_CLIENT_ID`
- 테스트할 서버 ID → `DISCORD_GUILD_ID`
- 업데이트 공지를 받을 텍스트 채널 ID → `UPDATE_CHANNEL_ID`

봇 초대 권한은 최소한 다음이면 됩니다.

- View Channels
- Send Messages
- Embed Links

이 봇은 일반 메시지 내용을 읽지 않으므로 Message Content Intent는 필요하지 않습니다.

## 2. 환경변수 설정

```powershell
cd discord-bot
Copy-Item .env.example .env
```

`.env`에 값을 채웁니다.

```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...
UPDATE_CHANNEL_ID=...
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

`SUPABASE_SERVICE_ROLE_KEY`는 서버 전용 비밀키입니다. 절대 웹 코드나 GitHub에 올리지 마세요.

## 3. 설치

Node.js 24.17 이상을 사용합니다.

```powershell
npm install
```

## 4. 슬래시 명령어 등록

```powershell
npm run deploy:commands
```

`DISCORD_GUILD_ID`가 있으면 해당 서버에 명령어를 등록합니다. 개발 단계에서는 서버 명령어 방식이 편합니다. `DISCORD_GUILD_ID`를 비우면 전역 명령어로 등록합니다.

## 5. 봇 실행

```powershell
npm start
```

정상 실행되면 콘솔에 다음과 비슷하게 표시됩니다.

```text
[SD종합센터 봇] MyBot#0000 로그인 완료
[업데이트 공지] 현재 버전을 기준점으로 저장했습니다.
```

## 업데이트 공지 동작

기본 확인 주기는 60초입니다. 필요하면 `.env`의 `UPDATE_POLL_INTERVAL_MS`를 수정할 수 있으며 최소 30초로 제한됩니다.

버전이 변경되면 예를 들어 다음 형태의 Embed가 공지 채널에 전송됩니다.

```text
📢 SD광부 업데이트
v1.1.0 → v1.1.1
변경 내용: ...
```

상태는 로컬 `data/update-state.json`에 저장됩니다. 봇을 영구 실행할 서버에서는 이 파일이 유지되는 디스크를 사용하는 것이 좋습니다.

## 보안

- `.env`는 `.gitignore`에 포함되어 있습니다.
- Bot Token과 Supabase service role key를 소스코드에 직접 넣지 마세요.
- 키가 외부에 노출되면 즉시 폐기하고 새로 발급하세요.
