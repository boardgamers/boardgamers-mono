import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
		assert.equal(content.pages.length, 10);
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

	it("shows h2 sub-items in the sidebar for the active page only", async () => {
		const html = await (await get("/guide/engine-api", "text/html")).text();
		const sidebar = html.match(/<aside>[\s\S]*?<\/aside>/)?.[0] ?? "";
		// The active page's h2s render as absolute-path anchor links…
		assert.match(sidebar, /<li class="toc"><a href="\/guide\/engine-api#required-methods">Required methods<\/a><\/li>/);
		assert.match(sidebar, /<li class="toc"><a href="\/guide\/engine-api#optional-methods">Optional methods<\/a><\/li>/);
		// …nested right after the active page's entry…
		assert.match(sidebar, /<a href="\/guide\/engine-api" class="active">[^<]+<\/a><\/li>\n<li class="toc">/);
		// …and no other page gets sub-items.
		assert.equal(sidebar.match(/class="toc"/g)!.length, 2);
		const architecture = await (await get("/guide/architecture", "text/html")).text();
		const archSidebar = architecture.match(/<aside>[\s\S]*?<\/aside>/)?.[0] ?? "";
		assert.doesNotMatch(archSidebar, /engine-api#required-methods/);
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
		const res = await get("/.md", "text/markdown");
		const body = await res.text();
		assert.doesNotMatch(body, /^---/);
		assert.match(body, /<div class="hero">/);
	});

	it("has no leftover Config section or sidebar title", async () => {
		const html = await (await get("/", "text/html")).text();
		assert.doesNotMatch(html, /href="\/config/);
		assert.doesNotMatch(html, />Config</);
		// No redundant "BGS Docs" home entry in the sidebar (the header brand links home).
		const sidebar = html.match(/<aside>[\s\S]*?<\/aside>/)?.[0] ?? "";
		assert.doesNotMatch(sidebar, /BGS Docs/);
		assert.doesNotMatch(sidebar, /href="\/"/);
		assert.equal((await get("/config", "text/html")).status, 404);
		const llms = await (await get("/llms.txt", "text/html")).text();
		assert.doesNotMatch(llms, /config/i);
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

	it("drops the VuePress [[toc]] directive instead of rendering it literally", async () => {
		for (const path of ["/guide/engine-api", "/guide/viewer-api"]) {
			const html = await (await get(path, "text/html")).text();
			assert.doesNotMatch(html, /\[\[toc\]\]/, path);
		}
	});

	it("keeps tags inside code spans as code, not raw HTML", async () => {
		const html = await (await get("/guide/viewer-api", "text/html")).text();
		// `<html class="dark">` is backtick-quoted: it must render as inline code…
		assert.match(html, /<code>&lt;html class=&quot;dark&quot;&gt;<\/code>/);
		// …and the rest of the paragraph stays inline markdown (link, not literal text).
		assert.match(html, /<a href="#theme">theme<\/a>/);
		assert.doesNotMatch(html, /\[theme\]\(#theme\)/);
	});

	it("still passes through raw block HTML on the home page", async () => {
		const html = await (await get("/", "text/html")).text();
		assert.match(html, /<div class="hero">/);
		assert.match(html, /<div class="features">/);
		assert.match(html, /<a class="action-button" href="\/guide">/);
	});

	it("rewrites internal .md links to HTML pages, relative to the current page", async () => {
		const res = await get("/guide/viewer-api", "text/html");
		const html = await res.text();
		// "./engine-api.md#tosave" from /guide/viewer-api → /guide/engine-api#tosave
		assert.match(html, /href="\/guide\/engine-api#tosave"/);
		assert.doesNotMatch(html, /href="[^"]*\.md[.#]/);
		// Fragment-only and external links are untouched
		assert.match(html, /href="#fetchstate"/);
		const adding = await (await get("/guide/adding-a-game", "text/html")).text();
		assert.match(adding, /href="https:\/\/docs\.npmjs\.com\/cli\/commands\/npm-pack"/);
	});

	it("resolves .md links from nested and top-level pages", async () => {
		const dir = mkdtempSync(join(tmpdir(), "bgs-docs-"));
		try {
			writeFileSync(
				join(dir, "README.md"),
				"# Home\n\nSee [the guide](./guide/README.md) and [a page](./page.md#top).\n",
			);
			writeFileSync(join(dir, "page.md"), "# Page\n");
			mkdirSync(join(dir, "guide"));
			writeFileSync(
				join(dir, "guide", "README.md"),
				"# Guide\n\nUp to [page](../page.md), sibling [other](./other.md), external [x](https://example.com/x.md).\n",
			);
			writeFileSync(join(dir, "guide", "other.md"), "# Other\n");
			const nested = createDocsServer(loadDocs(dir));
			await new Promise<void>((resolve) => nested.listen(0, "127.0.0.1", resolve));
			try {
				const address = nested.address();
				assert(address && typeof address === "object");
				const nestedBase = `http://127.0.0.1:${address.port}`;
				const home = await (await fetch(`${nestedBase}/`, { headers: { accept: "text/html" } })).text();
				assert.match(home, /href="\/guide"/);
				assert.match(home, /href="\/page#top"/);
				const guide = await (await fetch(`${nestedBase}/guide`, { headers: { accept: "text/html" } })).text();
				assert.match(guide, /href="\/page"/);
				assert.match(guide, /href="\/guide\/other"/);
				assert.match(guide, /href="https:\/\/example\.com\/x\.md"/);
				// Raw markdown keeps the original .md hrefs
				const raw = await (await fetch(`${nestedBase}/guide`, { headers: { accept: "text/markdown" } })).text();
				assert.match(raw, /\(\.\.\/page\.md\)/);
			} finally {
				nested.close();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
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
