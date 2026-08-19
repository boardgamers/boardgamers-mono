import type { DocPage, DocsContent } from "./content.ts";
import { renderMarkdown } from "./markdown.ts";

export function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function pageUrl(path: string): string {
	return path === "" ? "/" : `/${path}`;
}

// The home page is not listed: the header brand already links to it, and its
// "BGS Docs" title would be a redundant first entry.
function navSections(pages: DocPage[]): { title: string; pages: DocPage[] }[] {
	const sections = new Map<string, DocPage[]>();
	for (const page of pages) {
		if (page.path === "") continue;
		const top = page.path.split("/")[0];
		if (!sections.has(top)) sections.set(top, []);
		sections.get(top)!.push(page);
	}
	return [
		...[...sections.entries()].map(([dir, dirPages]) => {
			const index = dirPages.find((p) => p.path === dir);
			// Capitalize the directory name as the section title ("guide" → "Guide").
			const title = dir.charAt(0).toUpperCase() + dir.slice(1);
			return { title: index?.title && index.title !== "Introduction" ? index.title : title, pages: dirPages };
		}),
	];
}

const CSS = `
:root { --accent: #3eaf7c; --text: #2c3e50; --muted: #6a8bad; --border: #eaecef; --bg-sidebar: #f8f9fb; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif; color: var(--text); line-height: 1.7; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
header { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 1rem; padding: 0.7rem 1.5rem; background: #fff; border-bottom: 1px solid var(--border); }
header .brand { font-weight: 600; font-size: 1.1rem; color: var(--text); }
header nav { margin-left: auto; display: flex; gap: 1.2rem; font-size: 0.95rem; }
.layout { display: flex; }
aside { flex: 0 0 240px; padding: 1.5rem 1rem; border-right: 1px solid var(--border); background: var(--bg-sidebar); min-height: calc(100vh - 3.4rem); }
aside .section { margin-bottom: 1.2rem; }
aside .section-title { font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 0 0 0.4rem; }
aside ul { list-style: none; margin: 0; padding: 0; }
aside li a { display: block; padding: 0.25rem 0.6rem; border-radius: 4px; color: var(--text); font-size: 0.95rem; }
aside li a:hover { background: #eef1f4; text-decoration: none; }
aside li a.active { color: var(--accent); font-weight: 600; }
main { flex: 1; min-width: 0; max-width: 960px; padding: 2rem 2.5rem 4rem; }
main img { max-width: 100%; }
main h1 { font-size: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; }
main h2 { font-size: 1.5rem; margin-top: 2.2rem; }
main h3 { font-size: 1.2rem; margin-top: 1.8rem; }
main h1, main h2, main h3, main h4 { font-weight: 600; line-height: 1.25; }
main h1 a.header-anchor, main h2 a.header-anchor, main h3 a.header-anchor, main h4 a.header-anchor { color: var(--text); }
main h1 a.header-anchor:hover, main h2 a.header-anchor:hover, main h3 a.header-anchor:hover, main h4 a.header-anchor:hover { text-decoration: none; }
main code { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 0.9em; background: rgba(27, 31, 35, 0.06); padding: 0.15em 0.35em; border-radius: 4px; }
main pre { background: #282c34; color: #abb2bf; padding: 1rem 1.2rem; border-radius: 6px; overflow-x: auto; line-height: 1.45; }
main pre code { background: none; padding: 0; font-size: 0.88rem; }
main blockquote { margin: 1rem 0; padding: 0.1rem 1.2rem; border-left: 0.3rem solid var(--accent); background: #f3f5f7; color: #666; border-radius: 0 4px 4px 0; }
main table { border-collapse: collapse; margin: 1rem 0; display: block; overflow-x: auto; }
main th, main td { border: 1px solid #dfe2e5; padding: 0.5em 1em; }
main tr:nth-child(2n) { background: #f6f8fa; }
main .features { display: flex; flex-wrap: wrap; gap: 1.5rem; margin-top: 2rem; }
main .features .feature { flex: 1 1 220px; border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.2rem; }
main .features .feature h2 { margin-top: 0; font-size: 1.1rem; }
main .hero { text-align: center; margin: 2rem 0; }
main .hero img { max-height: 180px; }
main .hero .tagline { font-size: 1.3rem; font-weight: 600; margin: 0.8rem 0 0.2rem; }
main .features .feature p:last-child { margin-bottom: 0; }
main .action-button { display: inline-block; margin-top: 1rem; padding: 0.6rem 1.4rem; background: var(--accent); color: #fff; border-radius: 6px; font-size: 1.05rem; }
main .action-button:hover { background: #35966a; text-decoration: none; }
footer.page { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.85rem; }
@media (max-width: 800px) {
  .layout { flex-direction: column; }
  aside { flex: none; border-right: none; border-bottom: 1px solid var(--border); min-height: 0; }
  main { padding: 1.2rem 1rem 3rem; }
}
`;

function sidebar(content: DocsContent, current: DocPage): string {
	const sections = navSections(content.pages)
		.map((section) => {
			const items = section.pages
				.map((page) => {
					const active = page.path === current.path ? ' class="active"' : "";
					return `<li><a href="${pageUrl(page.path)}"${active}>${escapeHtml(page.title)}</a></li>`;
				})
				.join("\n");
			const title = section.title ? `<p class="section-title">${escapeHtml(section.title)}</p>` : "";
			return `<div class="section">${title}<ul>\n${items}\n</ul></div>`;
		})
		.join("\n");
	return `<aside>${sections}</aside>`;
}

export function renderPage(content: DocsContent, page: DocPage): string {
	const body = renderMarkdown(page.markdown, "", page.dir);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)} · BGS Docs</title>
<meta name="description" content="Docs for the boardgamers ecosystem">
<link rel="icon" href="/logo.svg" type="image/svg+xml">
<link rel="alternate" type="text/markdown" href="${pageUrl(page.path)}.md" title="Markdown source">
<style>${CSS}</style>
</head>
<body>
<header>
  <a class="brand" href="/">BGS Docs</a>
  <nav>
    <a href="/guide">Guide</a>
    <a href="https://github.com/boardgamers">GitHub</a>
    <a href="https://boardgamers.space">boardgamers.space</a>
  </nav>
</header>
<div class="layout">
${sidebar(content, page)}
<main>
${body}
<footer class="page">Raw markdown: <a href="${pageUrl(page.path)}.md">${pageUrl(page.path)}.md</a> · Agents: <a href="/llms.txt">/llms.txt</a></footer>
</main>
</div>
</body>
</html>
`;
}

export function renderIndex(content: DocsContent): string {
	const items = content.pages
		.map((page) => {
			const md = `${pageUrl(page.path)}.md`;
			return `<li><a href="${pageUrl(page.path)}">${escapeHtml(page.title)}</a> — <a href="${md}"><code>${md}</code></a></li>`;
		})
		.join("\n");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Markdown index · BGS Docs</title>
<style>${CSS}</style>
</head>
<body>
<header><a class="brand" href="/">BGS Docs</a></header>
<main>
<h1>Markdown index</h1>
<p>Every docs page is available as raw markdown — append <code>.md</code> to its URL, or send
<code>Accept: text/markdown</code>. See <a href="/llms.txt"><code>/llms.txt</code></a> for the
machine-readable listing.</p>
<ul>
${items}
</ul>
</main>
</body>
</html>
`;
}

export function renderLlmsTxt(content: DocsContent): string {
	const lines = [
		"# BGS Docs",
		"",
		"> Docs for the boardgamers ecosystem (boardgamers.space) — how the platform works and how to add a game.",
		"",
		"Every page is available as raw markdown: append `.md` to its URL, or send `Accept: text/markdown`.",
		"",
		"## Docs",
		"",
	];
	for (const page of content.pages) {
		lines.push(`- [${page.title}](${pageUrl(page.path)}.md)`);
	}
	lines.push("");
	return lines.join("\n");
}
