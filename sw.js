/**
 * 서비스 워커 — 폰에서 앱처럼 쓰기 위한 오프라인 캐시
 *
 * 처음 한 번 열어두면 필요한 파일(3D 라이브러리·지형 이미지·코드)이 전부 저장돼서
 * 그다음부터는 **인터넷 없이도** 열린다. 모델하우스나 현장처럼 신호가 약한 곳에서 특히 쓸모 있다.
 *
 * VERSION 은 배포할 때마다 새 값으로 바뀐다(배포 명령이 __BUILD__ 를 치환).
 * 값이 바뀌면 브라우저가 이 파일이 달라진 걸 알아채고 새 캐시를 받는다.
 */

const VERSION = '__BUILD__';
const CACHE = `pentahills-${VERSION}`;

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

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // 파일 하나가 실패해도 설치 전체가 무산되지 않게 하나씩 담는다
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null))))
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
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          // 새로 받은 것도 캐시에 넣어 다음엔 오프라인에서 쓸 수 있게 한다
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // 오프라인인데 캐시에도 없으면, 페이지 요청은 첫 화면으로 대신 응답
          if (req.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 504 });
        });
    })
  );
});

// 화면에서 "새로고침"을 눌렀을 때 대기 중인 새 버전을 즉시 적용
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
