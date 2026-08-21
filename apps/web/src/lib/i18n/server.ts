import { AsyncLocalStorage } from "node:async_hooks";
import { overwriteServerAsyncLocalStorage } from "@/lib/paraglide/runtime.js";
import type { Locale } from "./locales";

/**
 * Per-request locale for SSR message rendering. Message functions call
 * paraglide's `getLocale()`, which reads this AsyncLocalStorage first — so a
 * German request renders German messages even though the client-side language
 * store (i18n/messages.ts) is module-global and shared across requests.
 *
 * Imported for its side effect by hooks.server.ts (server-only module).
 */
export const languageStorage = new AsyncLocalStorage<{ locale: Locale }>();

// Paraglide's own structural type adds optional fields (origin, messageCalls)
// our store never sets — the cast documents that the `locale` slot is all we use.
overwriteServerAsyncLocalStorage(languageStorage as unknown as Parameters<typeof overwriteServerAsyncLocalStorage>[0]);
