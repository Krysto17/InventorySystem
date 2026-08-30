// Minimal service worker (#9): exists so the app is installable as a PWA.
//
// It deliberately caches NOTHING. This is an authenticated app handling money
// and stock; a cached page or API response could be shown to the wrong user, or
// show yesterday's balance as today's. The worker's only job is to give the
// browser something to register and to turn a failed navigation into a readable
// message instead of the browser's dinosaur.
const OFFLINE = new Response(
  "<!doctype html><meta charset=utf-8><title>Offline</title>" +
    "<body style=\"font:16px system-ui;padding:2rem\">You are offline. " +
    "Reconnect and reload — nothing has been saved.</body>",
  { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  // Navigations only. Wrapping every GET meant a hiccup during a PDF download
  // or a Supabase read surfaced as a plain-text 503 in place of the real
  // response; those requests are better left to the browser and the app's own
  // error handling.
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => OFFLINE.clone()));
});
