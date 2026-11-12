'use strict';

const CACHE_NAME = 'english-hero-shell-v134';
const APP_SHELL = ['./', './index.html', './english-basics.html', './english-tenses-guide.html', './privacy.html', './contact.html', './teacher-pilot.html', './grammar-lesson.html', './grammar-library.html', './grammar-category.html', './grammar-lessons.js?v=4', './manifest.webmanifest', './icon.svg', './config.js', './cloud-sync.js?v=7', './pro-dashboard.js?v=4', './learning-expansion.js?v=62', './english-hero-plus.js?v=69', './vocabulary-20000.json', './site-quick-nav.css?v=1', './site-quick-nav.js?v=1', './auth-gateway.css?v=1', './auth-gateway.js?v=7', './auth-guard.js?v=1', './reading.html', './reading-letters.html', './reading-letter-sounds.html', './reading-digraphs.html', './reading-short-vowels.html', './reading-blends.html', './reading-cvc.html', './reading-magic-e.html', './reading-vowel-teams.html', './reading-r-controlled.html', './reading-diphthongs.html', './reading-syllables.html', './reading-practice.html', './reading-course.css?v=3', './reading-course.js?v=6'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('english-hero-shell-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Always try the network first for page navigations so published fixes appear promptly.
  if (request.mode === 'navigate' || /\/(?:config|cloud-sync|auth-guard|pro-dashboard|ai-chat)\.js$/.test(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          if (request.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
          return Response.error();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
