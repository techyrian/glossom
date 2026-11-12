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

// Scramjet v1 bug workaround: when the page sends its config by postMessage, the worker stores
// it on scramjet.config but never applies it to the global config that URL decoding uses, and
// loadConfig() then skips loading because scramjet.config is already set. Every proxied request
// would then fail with "Cannot read properties of undefined (reading 'prefix')".
// So reload the config from IndexedDB properly (the page saves it there before messaging us)
// once per worker start and again after every config message.
let configPromise = null;
self.addEventListener("message", (event) => {
  if (event.data && event.data.scramjet$type === "loadConfig") configPromise = null;
});
function ensureConfig() {
  if (!configPromise) {
    const current = scramjet.config;
    scramjet.config = undefined;              // loadConfig() checks this synchronously...
    const loading = scramjet.loadConfig();
    if (!scramjet.config) scramjet.config = current;   // ...so in-flight requests keep a config meanwhile
    configPromise = loading.then(() => {
      if (!scramjet.config) throw new Error("Scramjet config not found; reload the page");
    });
    configPromise.catch(() => { configPromise = null; });
  }
  return configPromise;
}

async function handleRequest(event) {
  try {
    await ensureConfig();
    if (scramjet.route(event)) return await scramjet.fetch(event);
    return await fetch(event.request);
  } catch (err) {
    return new Response("GLOSSOM proxy error: " + (err && err.stack || err), {
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
