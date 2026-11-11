// GLOSSOM service worker for Scramjet.
// Must be served from the site root (/sw.js) so its scope covers the whole site.
importScripts("/scram/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

// Scramjet's default prefix; proxied pages live under /scramjet/<encoded url>.
// Keep in sync with the prefix the page's ScramjetController uses (it uses the default).
const PREFIX = "/scramjet/";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function isProxyRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && url.pathname.startsWith(PREFIX);
}

async function handleRequest(event) {
  try {
    await scramjet.loadConfig();
    if (scramjet.route(event)) return await scramjet.fetch(event);
    return await fetch(event.request);
  } catch (err) {
    return new Response("GLOSSOM proxy error: " + err, {
      status: 502,
      headers: { "content-type": "text/plain" },
    });
  }
}

// Only take over proxied requests. Everything else (your games, music, images,
// embeds) goes straight to the network as if this worker didn't exist, so a proxy
// problem can never break the rest of the site.
self.addEventListener("fetch", (event) => {
  if (!isProxyRequest(event.request)) return;
  event.respondWith(handleRequest(event));
});
