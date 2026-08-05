import createDOMPurify from "dompurify";
import { browser } from "$app/environment";
import { JSDOM } from "jsdom";

// DOMPurify@2 is a factory: with a real DOM in scope the default export is already a ready
// instance; under SSR (no window) it returns an unbound factory, which we bind to a single
// shared jsdom window. One module-level JSDOM — creating one per sanitize call would be a
// per-request perf/memory cost.
const purify = browser ? createDOMPurify() : createDOMPurify(new JSDOM("").window as unknown as Window);

export const sanitizeHtml = (html: string): string => purify.sanitize(html);
