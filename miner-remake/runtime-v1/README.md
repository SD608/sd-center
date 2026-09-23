# SD광부 Boss Encounter Runtime Foundation v1

4막 5장 Boss/encounter runtime 기반의 첫 구현이다. 이 디렉터리는 **운영 경제 권한을 가지지 않으며**, PR #80 UI와 4막6장 Core adapter 사이에 들어갈 게임 runtime foundation만 제공한다.

핵심 경계:
- Phaser 4.2.1 + Arcade Physics는 렌더/입력/충돌 질의를 담당한다.
- `EncounterCore` serializable state가 durable authority다. Phaser 객체는 저장하지 않는다.
- 좌표는 block/world unit을 canonical 값으로 사용한다.
- Recovery는 fail-closed이며 P1/HP3600 fresh reset으로 우회하지 않는다.
- renderer는 파일 시스템에 직접 접근하지 않고 `RuntimePersistenceClient`의 고정 IPC 채널만 사용한다.
- Electron main 쪽 `RuntimeStorageService`가 snapshot/journal 파일 I/O와 checksum/fsync/atomic rename을 담당한다.
- 현재 싱글 우선 `authority_epoch=0`; multiplayer election/transport는 후속이다.
- `AbisterFoundationController`는 scene/core wiring 검증용 dummy이며 실제 공격/밸런스 authority가 아니다.

`dev/index.html`은 `npm ci` 뒤 로컬 `node_modules/phaser/dist/phaser.js`를 읽는 CI/dev harness다. 운영 CDN 의존성이 아니다.
