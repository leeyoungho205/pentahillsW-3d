/**
 * 서비스 워커 — 폰에서 앱처럼 쓰기 위한 오프라인 캐시
 *
 * VERSION 은 배포할 때마다 새 값으로 바뀐다.
 * - Cloudflare Pages: 빌드 명령이 __BUILD__ → 커밋 SHA 로 치환
 * - ./deploy.sh: 시각 문자열로 치환
 * 값이 바뀌면 새 캐시 이름으로 갈아타고 옛 캐시를 지운다.
 */

const VERSION = '__BUILD__';
// v3 접두사: 예전 pentahills-__BUILD__ 캐시를 한 번에 비우기 위함
const CACHE = `pentahills-v3-${VERSION}`;

// 앱이 켜지는 데 필요한 파일 전부
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/main.js',
  './js/siteData.js',
  './js/unitData.js',
  './js/sceneryData.js',
  './js/buildings.js',
  './js/site.js',
  './js/sun.js',
  './js/analysis.js',
  './js/heatmap.js',
  './vendor/three/three.module.js',
  './vendor/three/examples/jsm/controls/OrbitControls.js',
  './assets/terrain.png',
  './assets/db.jpg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
];

/** HTML·JS·CSS 등 앱 코드인지 — 배포 후 바로 새 파일을 받도록 네트워크 우선 */
function isAppCode(url) {
  const path = url.pathname;
  return (
    path.endsWith('.html') ||
    path.endsWith('.js') ||
    path.endsWith('.css') ||
    path.endsWith('.json') ||
    path === '/' ||
    path.endsWith('/')
  );
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // 파일 하나가 실패해도 설치 전체가 무산되지 않게 하나씩 담는다
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // sw.js 는 브라우저가 주기적으로 다시 받도록 가로채지 않는다
  if (url.pathname.endsWith('/sw.js')) return;

  // 앱 코드·문서: 네트워크 우선 → 실패 시에만 캐시 (구버전 고착 방지)
  if (req.mode === 'navigate' || isAppCode(url)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => {
            if (hit) return hit;
            if (req.mode === 'navigate') return caches.match('./index.html');
            return new Response('', { status: 504 });
          })
        )
    );
    return;
  }

  // 이미지·벤더 등: 캐시 우선 (용량·오프라인)
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => new Response('', { status: 504 }));
    })
  );
});

// 화면에서 "새로고침"을 눌렀을 때 대기 중인 새 버전을 즉시 적용
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
