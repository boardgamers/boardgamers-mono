import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { loadDocs } from "./app/content.ts";
import { wantsMarkdown } from "./app/negotiate.ts";
import { createDocsServer } from "./server.ts";

const DOCS_DIR = fileURLToPath(new URL("./docs/", import.meta.url));

describe("content negotiation", () => {
	it("prefers markdown on an explicit text/markdown accept", () => {
		assert.equal(wantsMarkdown("text/markdown"), true);
		assert.equal(wantsMarkdown("text/markdown, text/html;q=0.9"), true);
		assert.equal(wantsMarkdown("text/html;q=0.5, text/markdown"), true);
	});

	it("prefers HTML for browsers", () => {
		assert.equal(wantsMarkdown("text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8"), false);
		assert.equal(wantsMarkdown("text/html"), false);
	});

	it("defaults to markdown for non-browser agents", () => {
		assert.equal(wantsMarkdown("*/*"), true);
		assert.equal(wantsMarkdown(undefined), true);
	});

	it("honours q-values both ways", () => {
		assert.equal(wantsMarkdown("text/markdown;q=0.5, text/html;q=0.9"), false);
		assert.equal(wantsMarkdown("text/markdown;q=0.9, text/html;q=0.5"), true);
		assert.equal(wantsMarkdown("text/markdown;q=0"), false);
	});
});

describe("docs server", () => {
	let server: ReturnType<typeof createDocsServer>;
	let base: string;

	before(async () => {
		server = createDocsServer(loadDocs(DOCS_DIR));
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		assert(address && typeof address === "object");
		base = `http://127.0.0.1:${address.port}`;
	});
	after(() => server.close());

	const get = (path: string, accept?: string) =>
		fetch(`${base}${path}`, accept === undefined ? {} : { headers: { accept } });

	it("serves every docs page as HTML to browsers", async () => {
		const content = loadDocs(DOCS_DIR);
		assert.equal(content.pages.length, 8);
		for (const page of content.pages) {
			const res = await get(page.path === "" ? "/" : `/${page.path}`, "text/html");
			assert.equal(res.status, 200, page.path);
			assert.match(res.headers.get("content-type") ?? "", /text\/html/);
			assert.match(await res.text(), /<html/);
		}
	});

	it("renders navigation between pages", async () => {
		const res = await get("/guide/architecture", "text/html");
		const html = await res.text();
		assert.match(html, /<aside>/);
		assert.match(html, /href="\/guide\/engine-api"/);
		assert.match(html, /href="\/guide"/);
	});

	it("serves raw markdown when the agent asks for it", async () => {
		const res = await get("/guide/architecture", "text/markdown");
		assert.equal(res.status, 200);
		assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
		const body = await res.text();
		assert.match(body, /^# /m);
		assert.doesNotMatch(body, /<html/);
	});

	it("serves raw markdown on the .md suffix", async () => {
		const res = await get("/guide/architecture.md", "text/html");
		assert.equal(res.status, 200);
		assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
		assert.match(await res.text(), /^# /m);
	});

	it("serves raw markdown on ?format=md", async () => {
		const res = await get("/guide/engine-api?format=md", "text/html");
		assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
	});

	it("strips frontmatter from served markdown", async () => {
		const res = await get("/config.md", "text/markdown");
		const body = await res.text();
		assert.doesNotMatch(body, /^---/);
		assert.match(body, /# Config/);
	});

	it("serves the home page and the guide index", async () => {
		assert.equal((await get("/", "text/html")).status, 200);
		assert.equal((await get("/guide", "text/html")).status, 200);
		assert.equal((await get("/guide/", "text/html")).status, 200);
	});

	it("serves images and the logo", async () => {
		const png = await get("/guide/architecture.png", "text/html");
		assert.equal(png.status, 200);
		assert.match(png.headers.get("content-type") ?? "", /image\/png/);
		const svg = await get("/logo.svg", "text/html");
		assert.equal(svg.status, 200);
		assert.match(svg.headers.get("content-type") ?? "", /image\/svg\+xml/);
	});

	it("serves llms.txt listing every page as a markdown link", async () => {
		const res = await get("/llms.txt", "text/html");
		assert.equal(res.status, 200);
		const body = await res.text();
		assert.match(body, /# BGS Docs/);
		for (const page of loadDocs(DOCS_DIR).pages) {
			const url = page.path === "" ? "/" : `/${page.path}`;
			assert.match(body, new RegExp(`\\(${url.replace("/", "\\/")}\\.md\\)`), page.path);
		}
	});

	it("rewrites heading anchors inside multi-page output", async () => {
		const res = await get("/guide/engine-api", "text/html");
		const html = await res.text();
		assert.match(html, /id="options-player"/);
		assert.match(html, /href="#options-player"/);
	});

	it("404s unknown pages without leaking paths", async () => {
		const res = await get("/nope", "text/html");
		assert.equal(res.status, 404);
		const traversal = await get("/../../package.json", "text/html");
		assert.notEqual(traversal.status, 200);
	});
});

describe("markdown loading", () => {
	it("maps README.md to the directory index and slugs filenames", () => {
		const dir = mkdtempSync(join(tmpdir(), "bgs-docs-"));
		try {
			writeFileSync(join(dir, "README.md"), "# Home\n");
			writeFileSync(join(dir, "My Page.md"), "# Custom\n");
			const content = loadDocs(dir);
			assert.deepEqual(content.pages.map((p) => p.path).sort(), ["", "my-page"]);
			assert.equal(content.byPath.get("")?.title, "Home");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
