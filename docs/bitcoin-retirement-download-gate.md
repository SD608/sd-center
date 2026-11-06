# SD비트코인 채굴장 공개 다운로드 철회 — Release 자산 및 웹 검증

상태: 비배포 Draft PR 검토 중. 기존 사용자 지갑·업적·칭호·BTC 기록·기획 소스는 보존한다.

## GitHub Release에 남은 ZIP 1개

- 저장소: SD608/sd-center
- Release tag: v.2.2.1
- 정확한 첨부 이름: SDBitcoinMiner_v1.2.2_Desktop.zip
- 2026-10-11 조회 시 GitHub Release asset ID: 516865122, 크기 79,637바이트
- URL: https://github.com/SD608/sd-center/releases/download/v.2.2.1/SDBitcoinMiner_v1.2.2_Desktop.zip

현재 연결에서는 GitHub Release 첨부 삭제 API가 제공되지 않으므로 이 파일은 자동 제거하지 않는다.

### 적용자가 확인할 절차

1. GitHub Releases의 `v.2.2.1` **Edit** 화면에서 위 정확한 이름의 ZIP 첨부 한 개만 삭제한다. Release/태그 자체는 삭제하지 않는다.
2. 다른 첨부인 `SDCenterSetup.exe`, `SDCenter-Mobile.apk`, `SDMiner_v1.1.0_Desktop.zip`, `SDOddEven_v1.1.0_Desktop.zip`, `SDVault_v1.2.0_Desktop.zip`, `BUILD_INFO.txt`, `SHA256.txt`는 보존한다.
3. 해당 직접 URL이 공개 사용자 기준 404가 되는지 확인한다. 인증/캐시 리다이렉트/기존 복제본은 별도로 구분한다.
4. GitHub Actions의 **Gate Retired Bitcoin Release Asset** 재실행 후 성공을 확인한다.

### CLI를 사용하는 경우 (GitHub 관리 권한 필요)

원본 Release 첨부 리스트를 먼저 확인한다:

```bash
gh release view 'v.2.2.1' --repo SD608/sd-center --json assets
```

정확히 일치하는 대상 1개만 제거한다:

```bash
gh release delete-asset 'v.2.2.1' 'SDBitcoinMiner_v1.2.2_Desktop.zip' --repo SD608/sd-center --yes
```

명령 실행 전과 후의 첨부 목록을 대조하여 나머지 7개가 보존됐는지 확인한다.

## 웹사이트 경로 — PR #86 (Gate 전 운영 미반영)

검토 브랜치에서는 `extensions-data.js`, `assets/js/extensions-data.js`, `update/extensions-catalog.json`의 비트코인 배포 항목과 `downloads/extensions/` 내 SDBitcoinMiner v1.2.0/1.2.1/1.2.2 ZIP 3개를 제거했다. 다른 공식 확장팩은 유지한다.

- **Release Gate 통과 전** PR #86을 main으로 병합하거나 공식 update manifest를 배포하지 않는다.
- Gate 충족 후 PR/CI를 확인하고 반영한다.
- Pages가 반영된 뒤 공개 인터넷에서 해당 3개 ZIP URL에 **200이 아닌 404**가 반환되는지 확인한다.
- 기존 SD Center 앱이 캐시한 과거 카탈로그 URL, CDN/브라우저 캐시도 검증한다.
- 과거 Git 커밋의 Git 객체 및 제3자 재배포본까지 회수·무효화하는 작업은 본 철회 범위가 아니다.

## 기존 설치자 영향 경계

기존 설치자의 앱, SD지갑, 시설·BTC, 과거 거래·업적·칭호를 삭제하지 않는다. 공식 서버에서 신규 채굴·매도·구매를 막는 HIGH 경로는 **별도 경제 무결성 검증 작업**이므로 다운로드 제거만으로 종료됐다고 표시하지 않는다.

판정 기준: 공개 ZIP 첨부 없음 + 운영 Pages ZIP 3개 접근 차단 + 상점 두 카탈로그에서 미노출 + 업데이트 카탈로그에 미포함 + CI/Release Gate + 기존 사용자 무영향 검증 후에만 다운로드 차단 완료로 보고한다.
