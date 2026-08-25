/**
 * Single source of truth for the site's supported UI languages (#306).
 *
 * Adding a locale = add its `messages/<locale>.json` file + one entry in
 * `locales`/`localeNames` below. The paraglide compile step
 * (scripts/compile-i18n.mts), the SSR language resolution (./language.ts),
 * the navbar switcher and the messages completeness spec all read this list —
 * never hardcode the locale list elsewhere.
 */
export const locales = ["en", "de", "fr", "pl", "ro", "el", "hi", "ru", "da", "pt-BR"] as const;

export type Locale = (typeof locales)[number];

/** Source language and final fallback of the resolution chain. */
export const defaultLocale: Locale = "en";

/** Human-readable names shown in the language switcher (each in its own language). */
export const localeNames: Record<Locale, string> = {
	en: "English",
	de: "Deutsch",
	fr: "Français",
	pl: "Polski",
	ro: "Română",
	el: "Ελληνικά",
	hi: "हिन्दी",
	ru: "Русский",
	da: "Dansk",
	"pt-BR": "Português (Brasil)",
};

/** Narrow an arbitrary string (cookie, user setting, Accept-Language) to a supported locale. */
export function isLocale(value: unknown): value is Locale {
	return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/**
 * Fallback for a base subtag whose language is only supported in a regional
 * variant — "pt" → "pt-BR". One-way on purpose: "pt-BR" itself stays "pt-BR",
 * and region subtags never generalize ("de-AT" is handled by base-subtag
 * stripping in parseLanguageTag, not here).
 */
export const regionalLocaleDefaults: Record<string, Locale> = {
	pt: "pt-BR",
};
