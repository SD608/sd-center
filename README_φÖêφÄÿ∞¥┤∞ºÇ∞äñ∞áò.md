# SD종합센터 홈페이지 설정

## 가장 먼저 수정할 파일

`site-config.js`

```js
window.SD_SITE_CONFIG = {
  productName: "SD종합센터",
  version: "2.1.0",
  releaseLabel: "Final",
  updatedAt: "2026-07-31",
  fileName: "SDCenterSetup.exe",
  downloadUrl: "https://github.com/SD608/sd-center/releases/latest/download/SDCenterSetup.exe",
  releasePageUrl: "https://github.com/SD608/sd-center/releases/latest",
  sourcePageUrl: "https://github.com/SD608/sd-center",
  systemRequirement: "Windows 10/11 64비트",
};
```

GitHub 아이디와 저장소 이름을 수정하지 않으면 다운로드 버튼을 눌렀을 때 설정 안내가 표시됩니다.

## 로컬 미리보기

`index.html`을 더블클릭해도 기본 화면을 확인할 수 있습니다.

일부 브라우저에서 로컬 파일의 JavaScript 동작을 제한하면, 해당 폴더에서 다음 명령을 사용할 수 있습니다.

```bat
python -m http.server 8080
```

그 후 브라우저에서 `http://localhost:8080`에 접속합니다.

## 주요 문구 수정

- 메인 소개: `index.html`의 `hero-description`
- 앱 설명: `index.html`의 `app-card`
- 설치 과정: `index.html`의 `steps`
- 색상과 크기: `assets/css/style.css`
