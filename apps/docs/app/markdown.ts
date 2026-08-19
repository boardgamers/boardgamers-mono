import { marked, type Token, type Tokens } from "marked";

// Docs are repo content (same trust level as the rest of the codebase), so the
// renderer allows inline HTML like VuePress did — the home page uses it.
marked.use({ gfm: true, breaks: false });

const VOID = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"source",
	"track",
	"wbr",
]);

function splitTag(text: string): { name: string; closing: boolean; selfClosing: boolean } | undefined {
	const match = text.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*?)(\/?)\s*>$/);
	if (!match) return undefined;
	return { name: match[2].toLowerCase(), closing: match[1] === "/", selfClosing: match[4] === "/" };
}

/** Split HTML containing tags into segments so tag boundaries land on token edges. */
function splitHtml(html: string): string[] {
	const parts = html.split(/(<[^>]*>)/).filter((s) => s.length > 0);
	const out: string[] = [];
	let buffer = "";
	for (const part of parts) {
		buffer += part;
		if (part.startsWith("<") && splitTag(part)) {
			out.push(buffer);
			buffer = "";
		}
	}
	if (buffer) out.push(buffer);
	return out;
}

/**
 * marked's inline lexer has no HTML tokenizer: `<h2><a href=…>` inside a paragraph
 * renders as literal text. Split block html/paragraph tokens at tag boundaries and
 * re-emit each as its own token so `renderer.html` sees whole tags (VuePress-style
 * raw-HTML passthrough).
 */
function retokenizeHtml(tokens: Token[]): Token[] {
	const out: Token[] = [];
	for (const token of tokens) {
		if (token.type === "html") {
			for (const part of splitHtml(token.text)) out.push({ type: "html", raw: part, text: part } as Token);
		} else if (token.type === "paragraph" && /<[a-zA-Z/]/.test(token.text)) {
			for (const part of splitHtml((token as Tokens.Paragraph).tokens ? token.text : token.text)) {
				if (splitTag(part)) {
					out.push({ type: "html", raw: part, text: part } as Token);
				} else {
					out.push({ type: "paragraph", raw: part, text: part, tokens: marked.Lexer.lexInline(part) } as Token);
				}
			}
		} else {
			out.push(token);
		}
	}
	return out;
}

const HEADING_RE = /^(\s{0,3}#{1,6}\s+)(.+?)\s*$/;

/**
 * Rewrite a docs-internal `.md` href for HTML output: strip the suffix and resolve
 * the relative path against the current page's directory (`./engine-api.md#x` from
 * `/guide/viewer-api` → `/guide/engine-api#x`) — a README.md index page links
 * relative to the directory it serves, same as the README links would. README.md
 * targets map to the directory index. Fragment-only and external links are left
 * alone — an href starting with a scheme or `//` can never be a docs page.
 * Raw-markdown responses keep the original hrefs.
 */
export function resolveMdHref(href: string, currentDir: string): string {
	if (href.startsWith("#") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith("//")) {
		return href;
	}
	const match = href.match(/^([^#?]*?)\.md([#?].*)?$/i);
	if (!match) {
		return href;
	}
	const segments: string[] = [];
	for (const segment of [...(currentDir ? currentDir.split("/") : []), ...match[1].split("/")]) {
		if (segment === "." || segment === "") {
			continue;
		}
		if (segment === "..") {
			segments.pop();
		} else {
			segments.push(segment);
		}
	}
	if (segments.at(-1)?.toLowerCase() === "readme") {
		segments.pop();
	}
	return `/${segments.join("/")}${match[2] ?? ""}`;
}

/** Prefix every heading id (from `# Heading` anchors) so fragment links stay valid. */
export function reanchorMarkdown(markdown: string, prefix: string): string {
	if (!prefix) return markdown;
	let inFence = false;
	return markdown
		.split("\n")
		.map((line) => {
			if (/^\s*```/.test(line)) inFence = !inFence;
			if (inFence) return line;
			const heading = line.match(HEADING_RE);
			if (heading) return `${heading[1]}${prefix}${heading[2]}`;
			return line.replace(/\[([^\]]*)\]\(#([^)]*)\)/g, (_m, text, anchor) => `[${text}](#${prefix}${anchor})`);
		})
		.join("\n");
}

export function renderMarkdown(markdown: string, headingPrefix = "", currentPath = ""): string {
	const tokens = retokenizeHtml(marked.lexer(reanchorMarkdown(markdown, headingPrefix)));
	const stack: string[] = [];
	const renderer = new marked.Renderer();
	renderer.link = ({ href, tokens: linkTokens }: Tokens.Link): string => {
		const text = parser.parseInline(linkTokens);
		return `<a href="${resolveMdHref(href, currentPath)}">${text}</a>`;
	};
	renderer.heading = ({ tokens: headingTokens, depth }: Tokens.Heading): string => {
		const text = parser.parseInline(headingTokens);
		const id = text
			.toLowerCase()
			.replace(/<[^>]*>/g, "")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
		return `<h${depth} id="${id}"><a class="header-anchor" href="#${id}">${text}</a></h${depth}>\n`;
	};
	renderer.html = ({ text }: Tokens.HTML): string => {
		const tag = splitTag(text);
		if (!tag) return text;
		if (tag.closing) {
			if (stack.includes(tag.name)) {
				while (stack.length && stack.pop() !== tag.name) {
					/* drop unclosed inner tags */
				}
				return text;
			}
			return ""; // stray closing tag — drop (matches VuePress/marked behaviour)
		}
		if (!tag.selfClosing && !VOID.has(tag.name)) stack.push(tag.name);
		return text;
	};
	const parser = new marked.Parser({ ...marked.defaults, renderer });
	let html = parser.parse(tokens);
	while (stack.length) html += `</${stack.pop()}>`;
	return html;
}
