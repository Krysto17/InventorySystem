// Minimal service worker (#9): exists so the app is installable as a PWA.
// Network-first passthrough for GET requests — it deliberately does NOT cache
// HTML/auth pages (this is an authenticated app; stale pages would be unsafe).
const OFFLINE = new Response("You are offline.", {
  status: 503,
  headers: { "Content-Type": "text/plain" },
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return; // let the browser handle writes
  event.respondWith(fetch(event.request).catch(() => OFFLINE));
});
