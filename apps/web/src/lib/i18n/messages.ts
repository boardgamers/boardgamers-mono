import { browser } from "$app/environment";
import { overwriteGetLocale, getLocale, getServerAsyncLocalStorage } from "@/lib/paraglide/runtime.js";
import * as messages from "@/lib/paraglide/messages.js";
import { defaultLocale, isLocale, type Locale } from "./locales";
import { setLanguageCookie } from "./language";
import { currentLocale, language, peekLocale, setLocale } from "./messages.svelte";

export { language };

/**
 * Client/server glue between our language resolution chain
 * (src/lib/i18n/language.ts) and the compiled paraglide messages.
 *
 * - The active locale is NOT paraglide's internal `_locale` global: it lives in
 *   the `language` store (seeded per-request from the SSR layout data, see
 *   +layout.ts) and `overwriteGetLocale` points paraglide at it. Message
 *   functions read the store's signal form when CALLED (see the `m` proxy
 *   below), so a language switch re-renders the whole tree without a reload.
 * - Message functions dispatch statically (`if (locale === "de") …`) into
 *   per-locale modules. The initial client bundle therefore contains only the
 *   locales whose modules are statically imported here — English (the
 *   fallback, always needed) plus the SSR'd locale when it differs (see
 *   initLanguage below). Any other locale is loaded on demand as ONE chunk
 *   (loadLocale) before switching to it.
 * - SSR: hooks wrap each request in the paraglide AsyncLocalStorage
 *   (hooks.server.ts), so `getLocale()` returns the per-request locale and
 *   never the shared store — no cross-request leakage.
 */

// Point paraglide's locale resolution at the store. On the server the
// per-request AsyncLocalStorage value (hooks.server.ts) shadows this, so SSR
// renders use the request's locale even though the store is module-global.
//
// IMPORTANT: preserve the stock AsyncLocalStorage read FIRST. overwriteGetLocale
// replaces getLocale() wholesale (including its serverAsyncLocalStorage branch),
// so without re-checking the store here SSR would render the module-global
// default ("en") instead of the request's locale (#306).
overwriteGetLocale(() => {
	const store = getServerAsyncLocalStorage()?.getStore();
	if (store?.locale && isLocale(store.locale)) {
		return store.locale;
	}
	return peekLocale();
});

// Message functions with full typing (per-key inputs), wrapped so each CALL
// first reads the store's signal form, marking it as a dependency of the
// calling component's render effect. Svelte 5 only re-runs effects whose
// tracked reads changed, and paraglide's internal getLocale() is invisible to
// the compiler, so without this tracked read a language switch wouldn't
// re-render. (An earlier version did the tracked read in the proxy's `get`
// handler — but that runs at property-ACCESS time, outside the render effect,
// so nothing ever tracked it.)
//
// The compiled module exports messages under their dotted ids
// (m["gameList.noGames"]). To keep call sites idiomatic we also accept the
// underscore alias (m.gameList_noGames) — paraglide's own codegen uses the
// same [^a-zA-Z0-9] → "_" mapping for its JS function names.
type Messages = typeof messages;
type MessageKey = keyof Messages & string;
/** "gameList.noGames" → "gameList_noGames" (dots are the only separator we use). */
type UnderscoreAlias<K extends string> = K extends `${infer Head}.${infer Tail}`
	? `${Head}_${UnderscoreAlias<Tail>}`
	: K;
/** Every message, accessible by dotted id AND by underscore alias. */
type MessageMap = {
	[K in MessageKey as K | UnderscoreAlias<K>]: Messages[K];
};

// Message fns have per-key input shapes; the proxy erases them and MessageMap
// restores them at the call sites.
type AnyMessageFn = (...args: unknown[]) => unknown;

const messageCache = new Map<string, AnyMessageFn>();

export const m = new Proxy(messages as unknown as Record<string, unknown>, {
	get(target, key: string) {
		const cached = messageCache.get(key);
		if (cached) {
			return cached;
		}
		const fn = (target[key] ?? target[key.replace(/_/g, ".")]) as AnyMessageFn | undefined;
		if (typeof fn !== "function") {
			throw new Error(`[i18n] unknown message "${key}" — add it to messages/${defaultLocale}.json`);
		}
		const wrapped = (...args: unknown[]) => {
			// Tracked read: inside a render effect this subscribes the effect to
			// language switches; getLocale() then resolves the new locale.
			void currentLocale();
			return fn(...args);
		};
		messageCache.set(key, wrapped);
		return wrapped;
	},
}) as MessageMap;

const localeModules: Record<Locale, () => Promise<unknown>> = {
	en: () => import("@/lib/paraglide/messages/en.js"),
	de: () => import("@/lib/paraglide/messages/de.js"),
	fr: () => import("@/lib/paraglide/messages/fr.js"),
};

const loadedLocales = new Set<Locale>([defaultLocale]);

/**
 * Pull a locale's message module into the bundle graph. With the
 * `locale-modules` output structure this is a single dynamic-import chunk.
 * Modules are loaded for their registration side effect on the dispatcher —
 * en.js/de.js only export pure functions, so "loading" is simply importing
 * them into the same module instance the dispatcher already closed over.
 */
export async function loadLocale(locale: Locale): Promise<void> {
	if (loadedLocales.has(locale)) {
		return;
	}
	await localeModules[locale]();
	loadedLocales.add(locale);
}

/**
 * Seed the client with the SSR-resolved language (root +layout.ts). Also
 * pre-loads the locale's module when it isn't the default — a German first
 * paint must render German messages on hydration, not English ones.
 */
export async function initLanguage(locale: Locale): Promise<void> {
	await loadLocale(locale);
	setLocale(locale);
}

/**
 * Switch the UI language client-side: load the locale's messages (if needed),
 * flip the store (re-renders the tree), and stamp the `lang` cookie so the
 * next SSR paint — and any subsequent anonymous session — resolves the same
 * language. The account-preference persistence for logged-in users lives in
 * the switcher component (it owns the error toast).
 */
export async function switchLanguage(locale: Locale): Promise<void> {
	if (!isLocale(locale) || locale === getLocale()) {
		return;
	}
	await loadLocale(locale);
	setLocale(locale);
	setLanguageCookie(locale);
	if (browser) {
		document.documentElement.lang = locale;
	}
}
