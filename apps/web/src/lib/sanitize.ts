import createDOMPurify from "dompurify";

// jsdom is server-only and ~5.7 MB — it must never reach the client bundle. It is
// loaded via a dynamic import guarded by `import.meta.env.SSR` (a compile-time
// constant: `true` building the server, `false` building the client), so Vite splits
// sanitize-ssr + jsdom into a chunk the client never downloads. A *static* jsdom
// import can't be tree-shaken out (jsdom's module side effects defeat it), so the
// dynamic import is what actually keeps the client lean. The top-level await runs
// once at module init; `sanitizeHtml` stays synchronous for `{@html}` markup.
let purify: ReturnType<typeof createDOMPurify>;

if (import.meta.env.SSR) {
	const { serverPurify } = await import("./sanitize-ssr");
	purify = serverPurify;
} else {
	// DOMPurify hooks the ambient window lazily, on first sanitize.
	purify = createDOMPurify();
}

export const sanitizeHtml = (html: string): string => purify.sanitize(html);
