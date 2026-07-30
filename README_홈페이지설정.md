# SD종합센터 홈페이지 업로드 방법

이 홈페이지는 `SD608/sd-center` 저장소 주소에 맞게 설정되어 있습니다.

## 지금 할 일

1. 이 ZIP을 압축 해제합니다.
2. GitHub 저장소 화면에서 **uploading an existing file**을 누릅니다.
3. `website` 폴더 안의 파일과 `assets` 폴더를 전부 끌어다 놓습니다.
   - `website` 폴더 자체를 올리는 것이 아니라, 그 안의 `index.html`, `site-config.js`, `assets` 등을 올립니다.
4. 화면 아래 **Commit changes**를 누릅니다.
5. 저장소의 **Settings → Pages**로 이동합니다.
6. Source를 **Deploy from a branch**, Branch를 **main / root**로 선택하고 저장합니다.

홈페이지 주소는 배포 후 다음 형식이 됩니다.

`https://sd608.github.io/sd-center/`

다운로드 버튼은 다음 설치 파일을 찾습니다.

`https://github.com/SD608/sd-center/releases/latest/download/SDCenterSetup.exe`

따라서 나중에 GitHub Releases에 설치 파일 이름을 정확히 `SDCenterSetup.exe`로 올려야 합니다.
