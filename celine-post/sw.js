// 오프라인에서도 앱이 열리도록 화면 파일을 저장해 둬요.
// 앱 파일을 고친 뒤에는 VERSION 숫자를 하나 올려 주세요.
const VERSION = 'celine-v7';
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/engine.js', 'js/card.js', 'js/sound.js', 'js/config.js', 'js/avatar.js', 'js/install.js',
  'js/missions/index.js', 'js/missions/m00_12.js', 'js/missions/m13_18.js', 'js/missions/m19_24.js',
  'js/missions/m25_30.js', 'js/missions/m31_36.js', 'js/missions/m37_plus.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'faces/main.jpg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'celine-fonts').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // 글꼴 · 로그인 도구(Firebase): 한 번 받으면 계속 사용 (인터넷이 없어도 앱이 열려요)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'
    || (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'))) {
    e.respondWith(
      caches.open('celine-fonts').then(async c => {
        const hit = await c.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok || res.type === 'opaque') c.put(request, res.clone());
        return res;
      })
    );
    return;
  }

  // 우리 앱 파일: 인터넷이 되면 최신 파일, 안 되면 저장해 둔 파일
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) caches.open(VERSION).then(c => c.put(request, res.clone()));
          return res;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
    );
  }
  // 그 밖의 요청(Firebase 등)은 건드리지 않아요
});
