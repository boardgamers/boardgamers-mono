import { fromStore, get, writable, type Readable } from "svelte/store";
import { defaultLocale, type Locale } from "./locales";

/**
 * The client-side UI language (#306), bridging two worlds:
 *
 * - `languageStore` is a plain svelte/store writable, so `$language` auto-
 *   subscriptions keep working in components (Appbar's switcher, …) — including
 *   during SSR, where `$effect`-based facades can't run.
 * - `languageState` wraps it with `fromStore`, exposing `.current` as a SIGNAL.
 *   Every message function (`m.*` in ./messages.ts) reads that signal when
 *   CALLED, registering it as a dependency of the calling component's render
 *   effect — so flipping the language re-renders the whole tree in the new
 *   language, no page reload. (`fromStore` itself feeds the signal with an
 *   effect-root subscription, so it updates outside any component.)
 *
 * Kept in a `.svelte.ts` module because plain `.ts` files may not reference
 * runes (`fromStore` emits `$effect.root` internally).
 */
export const languageStore = writable<Locale>(defaultLocale);

const languageSignal = fromStore(languageStore);

/** Reactive read of the active locale — tracked when called inside a render effect. */
export function currentLocale(): Locale {
	return languageSignal.current;
}

/** Set the active locale (after its message module is loaded). */
export function setLocale(locale: Locale): void {
	languageStore.set(locale);
}

/** Store interface of the same value, for `$language` in templates / `get()` in TS. */
export const language: Readable<Locale> = { subscribe: languageStore.subscribe };

/** Non-reactive read (message dispatch on the server, guards). */
export function peekLocale(): Locale {
	return get(languageStore);
}
