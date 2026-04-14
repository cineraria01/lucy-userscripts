# Lucy Userscripts

이 폴더는 `Tampermonkey` 공개 배포 전용 산출물입니다.

포함 파일:
- `lucy-flow-loader.user.js`
- `lucy-flow-auto-generator.js`

현재 서비스 런타임 원본은 아래 경로입니다.
- `/app/static/js/tampermonkey/lucy-flow-loader.user.js`
- `/app/static/js/tampermonkey/lucy-flow-auto-generator.js`

동기화 명령:
- `./scripts/sync_userscripts.sh export`
  현재 서비스 원본을 이 폴더용 공개 배포 형태로 생성합니다.
- `./scripts/sync_userscripts.sh verify`
  현재 서비스 원본 기준으로 이 폴더가 최신 공개 배포 형태와 동일한지 확인합니다.

공개 저장소:
- `git@github.com:cineraria01/lucy-userscripts.git`

설치 URL:
- `https://raw.githubusercontent.com/cineraria01/lucy-userscripts/main/lucy-flow-loader.user.js`

별도 공개 저장소로 분리하는 방법:
1. 이 폴더만 별도 저장소에 복사하거나 subtree split 합니다.
2. 예시:
   `git subtree split --prefix=userscripts -b userscripts-publish`
3. 이후 공개 저장소로 push:
   `git push git@github.com:cineraria01/lucy-userscripts.git userscripts-publish:main --force`

주의:
- 이 폴더의 로더는 `GitHub Raw` 주소를 기준으로 동작합니다.
- 서비스 런타임 경로의 로더와는 설치 URL, `REMOTE_SCRIPT_URL`, 메타데이터가 다를 수 있습니다.
