import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

// SSR DOMPurify binding: with a real DOM in scope the default export is already a
// ready instance, but under SSR (no window) it must be bound to one — one module-level
// jsdom JSDOM, shared across requests (creating one per sanitize call would be a
// per-request perf/memory cost). Only ever loaded on the server (see sanitize.ts), so
// jsdom stays out of the client bundle.
export const serverPurify = createDOMPurify(new JSDOM("").window as unknown as Window);
