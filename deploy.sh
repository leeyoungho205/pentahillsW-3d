#!/bin/bash
# Cloudflare Pages 배포
#
#  1) git 에 커밋된 파일만 dist/ 로 뽑는다
#     → .gitignore 로 제외한 이미지(인물이 찍힌 모델하우스 사진 등)가 공개되는 사고를 막는다
#  2) 서비스 워커의 __BUILD__ 를 현재 시각으로 바꾼다
#     → 값이 달라져야 브라우저가 "새 버전"으로 알아채고 캐시를 갱신한다
#  3) 배포
set -e
cd "$(dirname "$0")"

BUILD=$(date +%Y%m%d-%H%M%S)

rm -rf dist && mkdir dist
git archive main | tar -x -C dist
rm -rf dist/.claude dist/.gitignore dist/deploy.sh

# macOS/BSD sed 와 GNU sed 모두에서 동작하도록 -i 뒤에 빈 확장자를 준다
sed -i.bak "s/__BUILD__/$BUILD/" dist/sw.js && rm -f dist/sw.js.bak

echo "빌드 버전: $BUILD"
npx --yes wrangler@3.114.1 pages deploy dist \
  --project-name=pentahillsw-3d --branch=main --commit-dirty=true
