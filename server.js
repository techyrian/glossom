// GLOSSOM server: your site + Scramjet's browser files + the Wisp websocket the proxy talks through.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";
const sitePath = fileURLToPath(new URL("./", import.meta.url));

// The site lives in the repo root, so only these files/folders are served from it
// (never node_modules, server.js, package.json or .git).
const SITE_FILES = new Set(["/", "/index.html", "/sw.js"]);
const SITE_DIRS = ["/images/", "/games/", "/games-icon/"];
const isSiteFile = (p) => SITE_FILES.has(p) || SITE_DIRS.some((d) => p.startsWith(d));

// Wisp is how the browser opens connections to other sites, so it's the part worth locking
// down: ordinary web ports only, no UDP, and nothing on private/loopback addresses (so
// visitors can't use your server to reach its own network).
logging.set_level(logging.ERROR);
Object.assign(wisp.options, {
  allow_udp_streams: false,
  allow_private_ips: false,
  allow_loopback_ips: false,
  port_whitelist: [80, 443, 8080, 8443],
});

const fastify = Fastify({
  // Fastify needs a custom server so websocket upgrades can be handed to Wisp.
  serverFactory: (handler) =>
    createServer()
      .on("request", (req, res) => handler(req, res))
      .on("upgrade", (req, socket, head) => {
        socket.on("error", () => {}); // a client dropping mid-handshake must not crash the server
        let pathname = "";
        try {
          pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        } catch {
          // malformed URL: rejected below
        }
        if (pathname === "/wisp/") {
          req.url = pathname;
          wisp.routeRequest(req, socket, head);
        } else {
          socket.destroy();
        }
      }),
});

// NOTE: don't add Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy headers here.
// Scramjet doesn't need them, and "require-corp" would break the site's other embeds.

// Your site (sw.js has to be served from the root so its scope covers the whole site).
fastify.register(fastifyStatic, {
  root: sitePath,
  dotfiles: "deny",
  allowedPath: (pathname) => isSiteFile(pathname),
  decorateReply: true,
});

// Scramjet's browser files, at the paths index.html and sw.js expect.
fastify.register(fastifyStatic, { root: scramjetPath, prefix: "/scram/", decorateReply: false });
fastify.register(fastifyStatic, { root: libcurlPath, prefix: "/libcurl/", decorateReply: false });
fastify.register(fastifyStatic, { root: baremuxPath, prefix: "/baremux/", decorateReply: false });

try {
  await fastify.listen({ port: PORT, host: HOST });
  console.log(`GLOSSOM is running on http://localhost:${PORT}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
