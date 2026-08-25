/**
 * The supported UI languages (#306) live in `@bgs/models` (shared with the
 * admin panel and the api) — this module re-exports them so existing web
 * imports keep working. Never hardcode the locale list elsewhere.
 */
export { locales, defaultLocale, localeNames, isLocale, regionalLocaleDefaults, type Locale } from "@bgs/models";
