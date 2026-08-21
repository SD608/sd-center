# SD종합센터 Theme Package Spec v1

UI Preview v0.20부터 신규 원격 테마는 `catalog.json`의 목록 메타데이터와 테마별 `manifest.json`으로 배포한다.

```json
{
  "id": "example-theme",
  "name": "Example Theme",
  "version": "1",
  "manifestUrl": "https://raw.githubusercontent.com/SD608/sd-center/theme-catalog/themes/assets/example-theme/manifest.json",
  "manifestSha256": "64자리 sha256",
  "enabled": true
}
```

manifest는 `home`, `sub`, 선택적 `thumbnail` 에셋의 URL/SHA-256과 `backgroundColor`, `accent`, `sidebarAccent`, `sidebarStrength`, `overlay`, `subOverlay` 스타일을 가진다.

설치 규칙:
- manifest와 모든 에셋 SHA-256 일치 필수
- 허용 경로: `raw.githubusercontent.com/SD608/sd-center/theme-catalog/themes/assets/`
- staging 다운로드 후 전체 검증 성공 시에만 active 버전 교체
- 실패 시 기존 정상 설치본 유지
- 설치본은 로컬 캐시에 보관되어 오프라인 재실행 가능
- 손상/누락 시 SD Classic으로 안전 복귀
