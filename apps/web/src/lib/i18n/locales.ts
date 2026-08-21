/**
 * Single source of truth for the site's supported UI languages (#306).
 *
 * Adding a locale = add its `messages/<locale>.json` file + one entry in
 * `locales`/`localeNames` below. The paraglide compile step
 * (scripts/compile-i18n.mts), the SSR language resolution (./language.ts),
 * the navbar switcher and the messages completeness spec all read this list —
 * never hardcode the locale list elsewhere.
 */
export const locales = ["en", "de"] as const;

export type Locale = (typeof locales)[number];

/** Source language and final fallback of the resolution chain. */
export const defaultLocale: Locale = "en";

/** Human-readable names shown in the language switcher (each in its own language). */
export const localeNames: Record<Locale, string> = {
	en: "English",
	de: "Deutsch",
};

/** Narrow an arbitrary string (cookie, user setting, Accept-Language) to a supported locale. */
export function isLocale(value: unknown): value is Locale {
	return typeof value === "string" && (locales as readonly string[]).includes(value);
}
