// sw.js - Service Worker for PWA (大人の本格風水羅盤ナビ)
const CACHE_NAME = 'luopan-cache-v5';

// プリキャッシュする重要アセット
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
];

// インストール処理：エラーで中断しないよう各アセットを堅牢にキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        PRECACHE_ASSETS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (response.ok || response.type === 'opaque') {
              await cache.put(url, response);
            }
          } catch (e) {
            console.warn('[SW] Precache failed for:', url, e);
          }
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// アクティベート処理：古いキャッシュの削除とクライアントの即時制御
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

// フェッチ処理：ホーム画面起動時・オフライン時にも確実に画面を表示するキャッシュ戦略
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // GETリクエスト以外や拡張機能等のリクエストはスキップ
  if (req.method !== 'GET') return;
  if (!req.url.startsWith('http')) return;

  // 1. ナビゲーションリクエスト（ホーム画面からの起動やページ再読み込み）
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // ネットワーク取得を試行（タイムアウト1.5秒で即座にキャッシュフォールバック）
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 1500);
          const networkResponse = await fetch(req, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (networkResponse && networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, networkResponse.clone());
            return networkResponse;
          }
        } catch (e) {
          // ネットワークエラー、オフライン、またはタイムアウト時はキャッシュから返却
        }

        // キャッシュから index.html を探して返却（ホーム画面起動時の白画面を完全に防ぐ）
        const cached = await caches.match(req)
                    || await caches.match('./index.html')
                    || await caches.match('index.html')
                    || await caches.match('./');
        if (cached) return cached;

        // キャッシュにない場合はネットワークを直接再試行
        return fetch(req);
      })()
    );
    return;
  }

  // 2. 静的アセット（JS, CSS, 画像, フォント等）：Cache First + Stale-While-Revalidate
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) {
        // キャッシュがあれば即返却し、バックグラウンドで最新版に更新
        fetch(req).then(async (networkResponse) => {
          if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, networkResponse);
          }
        }).catch(() => {});
        return cached;
      }

      // キャッシュにない場合はネットワークから取得してキャッシュ
      try {
        const networkResponse = await fetch(req);
        if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, networkResponse.clone());
        }
        return networkResponse;
      } catch (err) {
        // 画像リクエストが失敗した場合はフォールバック
        if (req.destination === 'image') {
          const iconCached = await caches.match('./icon-192.png');
          if (iconCached) return iconCached;
        }
        throw err;
      }
    })()
  );
});
