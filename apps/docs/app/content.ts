import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type DocPage = {
	/** URL path, e.g. "/guide/architecture" ("" for the home page). */
	path: string;
	/** Page title: frontmatter `title`, else the first `# heading`, else the slug. */
	title: string;
	/** Raw markdown source, frontmatter stripped. */
	markdown: string;
};

export type DocsContent = {
	pages: DocPage[];
	byPath: Map<string, DocPage>;
	/** Raw bytes of every non-markdown file (images, …), keyed by URL path. */
	assets: Map<string, Buffer>;
};

const MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".drawio": "application/octet-stream",
};

export function assetMime(urlPath: string): string {
	const ext = urlPath.slice(urlPath.lastIndexOf(".")).toLowerCase();
	return MIME[ext] ?? "application/octet-stream";
}

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/\.md$/, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function stripFrontmatter(markdown: string): Record<string, string> {
	const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	const data: Record<string, string> = {};
	if (!match) return data;
	for (const line of match[1].split(/\r?\n/)) {
		const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (kv) data[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
	}
	return data;
}

function parsePage(file: string, urlPath: string): DocPage {
	const raw = readFileSync(file, "utf8");
	const frontmatter = stripFrontmatter(raw);
	const markdown = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
	const heading = markdown.match(/^#\s+(.+)$/m)?.[1].trim();
	const fallback = urlPath === "" ? "Home" : urlPath.split("/").pop()!;
	return { path: urlPath, title: frontmatter.title ?? heading ?? fallback, markdown };
}

/**
 * Loads every *.md page (and non-markdown asset) under `dir`.
 * README.md becomes its directory's index page ("" → "/", "guide" → "/guide").
 */
export function loadDocs(dir: string): DocsContent {
	const root = resolve(dir);
	const pages: DocPage[] = [];
	const assets = new Map<string, Buffer>();

	const walk = (sub: string) => {
		for (const entry of readdirSync(join(root, sub), { withFileTypes: true })) {
			const rel = sub ? `${sub}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
				walk(rel);
			} else if (entry.name.toLowerCase().endsWith(".md")) {
				const isIndex = entry.name.toLowerCase() === "readme.md";
				const base = isIndex ? sub : `${sub ? `${sub}/` : ""}${slugify(entry.name)}`;
				pages.push(parsePage(join(root, rel), base));
			} else {
				assets.set(`/${rel}`, readFileSync(join(root, rel)));
			}
		}
	};
	walk("");

	pages.sort((a, b) => a.path.localeCompare(b.path));
	return { pages, byPath: new Map(pages.map((p) => [p.path, p])), assets };
}

// Asset keys come from the directory walk, so an exact-match lookup can never
// escape the docs root (a path with ".." simply matches nothing).
export function resolveAsset(content: DocsContent, urlPath: string): Buffer | undefined {
	return content.assets.get(resolve(`/${urlPath.replace(/^\/+/, "")}`));
}
