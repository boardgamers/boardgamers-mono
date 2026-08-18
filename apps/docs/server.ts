import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { assetMime, loadDocs, resolveAsset, type DocsContent } from "./app/content.ts";
import { wantsMarkdown } from "./app/negotiate.ts";
import { renderIndex, renderLlmsTxt, renderPage } from "./app/render.ts";

const DOCS_DIR = fileURLToPath(new URL("./docs/", import.meta.url));
const PORT = Number(process.env.PORT ?? process.env.port ?? 8613);
const HOST = process.env.HOST ?? process.env.listenHost ?? "127.0.0.1";

function send(res: import("node:http").ServerResponse, status: number, type: string, body: string | Buffer) {
	res.writeHead(status, {
		"content-type": type,
		// Pages/assets are small and same-origin; short cache keeps edits quick to propagate.
		"cache-control": "public, max-age=60",
		vary: "accept",
	});
	res.end(body);
}

function handle(
	content: DocsContent,
	req: import("node:http").IncomingMessage,
	res: import("node:http").ServerResponse,
) {
	const url = new URL(req.url ?? "/", "http://docs.local");
	// Strip a trailing slash (except root) so /guide/ and /guide are the same page.
	let pathname = url.pathname.replace(/\/+/g, "/");
	if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);

	if (pathname === "/health") return send(res, 200, "application/json", JSON.stringify({ ok: true }));
	if (pathname === "/llms.txt") return send(res, 200, "text/plain; charset=utf-8", renderLlmsTxt(content));
	if (pathname === "/index.md") return send(res, 200, "text/markdown; charset=utf-8", renderLlmsTxt(content));
	if (pathname === "/markdown-index") return send(res, 200, "text/html; charset=utf-8", renderIndex(content));

	// Explicit markdown: /guide/architecture.md or ?format=md / ?format=markdown.
	let docPath = decodeURIComponent(pathname.slice(1));
	let explicitMd = false;
	if (docPath.toLowerCase().endsWith(".md")) {
		docPath = docPath.slice(0, -3);
		explicitMd = true;
	}
	const format = url.searchParams.get("format");
	if (format === "md" || format === "markdown") explicitMd = true;

	const page = content.byPath.get(docPath);
	if (page) {
		if (explicitMd || wantsMarkdown(req.headers.accept)) {
			return send(res, 200, "text/markdown; charset=utf-8", page.markdown);
		}
		return send(res, 200, "text/html; charset=utf-8", renderPage(content, page));
	}

	// Static assets (images, logo) as loaded from the docs tree.
	const asset = resolveAsset(content, pathname);
	if (asset) return send(res, 200, assetMime(pathname), asset);

	send(
		res,
		404,
		"text/html; charset=utf-8",
		`<!doctype html><title>Not found · BGS Docs</title><h1>404 — not found</h1><p><a href="/">Back to the docs home</a>.</p>`,
	);
}

export function createDocsServer(content: DocsContent = loadDocs(DOCS_DIR)): Server {
	return createServer((req, res) => {
		try {
			handle(content, req, res);
		} catch (error) {
			console.error("[docs] request failed:", error);
			if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
			res.end("internal error");
		}
	});
}

// Direct execution (`node server.ts`) starts the listener; tests import createDocsServer.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
	const server = createDocsServer();
	server.listen(PORT, HOST, () => console.log(`[docs] serving ${DOCS_DIR} on http://${HOST}:${PORT}`));
	const close = () => server.close(() => process.exit(0));
	process.on("SIGINT", close);
	process.on("SIGTERM", close);
}
