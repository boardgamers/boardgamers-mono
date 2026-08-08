// Minimal static file server for the admin SPA in a preview env. Serves the
// prebuilt apps/admin/dist with SPA fallback (client-side routing → index.html).
// Only / is static here; /api is proxied to the env's api by the coyo vhost, so this
// server never sees it. No deps — node stdlib only.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = process.env.ADMIN_ROOT ?? "/repo/apps/admin/dist";
const PORT = Number(process.env.ADMIN_PORT ?? 50805);
const HOST = process.env.ADMIN_HOST ?? "0.0.0.0";

const TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ico": "image/x-icon",
	".map": "application/json",
	".txt": "text/plain",
};

function safePath(urlPath) {
	const decoded = decodeURIComponent(urlPath.split("?")[0]);
	const clean = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
	return join(ROOT, clean);
}

const server = createServer(async (req, res) => {
	try {
		let filePath = safePath(req.url ?? "/");
		let s = await stat(filePath).catch(() => null);
		if (s?.isDirectory()) {
			filePath = join(filePath, "index.html");
			s = await stat(filePath).catch(() => null);
		}
		// SPA fallback: unknown non-asset path → index.html.
		if (!s) {
			filePath = join(ROOT, "index.html");
		}
		const body = await readFile(filePath);
		res.writeHead(200, { "content-type": TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream" });
		res.end(body);
	} catch (err) {
		res.writeHead(404, { "content-type": "text/plain" });
		res.end("not found");
	}
});

server.listen(PORT, HOST, () => console.log(`[admin] serving ${ROOT} on ${HOST}:${PORT}`));
