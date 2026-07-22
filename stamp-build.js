/**
 * Cloudflare Pages / 로컬 배포 시 sw.js 의 __BUILD__ 를 고유 값으로 치환한다.
 * CF 환경변수 CF_PAGES_COMMIT_SHA 가 있으면 그걸 쓰고, 없으면 시각 문자열을 쓴다.
 */
const fs = require('fs');
const path = require('path');

const swPath = path.join(__dirname, 'sw.js');
const stamp =
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.BUILD_ID ||
  new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

let source;
try {
  source = fs.readFileSync(swPath, 'utf8');
} catch (err) {
  console.error('sw.js 를 읽을 수 없습니다:', err.message);
  process.exit(1);
}

if (!source.includes('__BUILD__')) {
  console.warn('경고: __BUILD__ 가 없습니다. 이미 스탬프됐을 수 있습니다.');
  process.exit(0);
}

fs.writeFileSync(swPath, source.split('__BUILD__').join(stamp), 'utf8');
console.log('빌드 버전:', stamp);
