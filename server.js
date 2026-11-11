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
const publicPath = fileURLToPath(new URL("./public/", import.meta.url));

// Wisp is how the browser opens connections to other sites, so it's the part worth locking
// down: ordinary web ports only, no UDP, and nothing on private/loopback addresses (so
// visitors can't use your server to reach its own network).
const ALLOWED_PORTS = [80, 443, 8080, 8443];
logging.set_level(logging.ERROR);
Object.assign(wisp.options, {
  allow_udp_streams: false,
  allow_private_ips: false,
  allow_loopback_ips: false,
  port_whitelist: ALLOWED_PORTS,
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
// Scramjet doesn't need them to run, and "require-corp" would block the YouTube / TikTok /
// Instagram embeds and the Audius media on your site.

// Your site (public/ also holds sw.js, which has to live at the root).
fastify.register(fastifyStatic, { root: publicPath, decorateReply: true });

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
