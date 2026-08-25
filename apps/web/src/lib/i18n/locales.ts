/**
 * The supported UI languages (#306) live in `@bgs/models` (shared with the
 * admin panel and the api) — this module re-exports them so existing web
 * imports keep working. Never hardcode the locale list elsewhere.
 *
 * Import from `@bgs/models/locale` (not the package root): the root pulls in
 * helpers.ts → mongodb, which can't init in the browser bundle.
 */
export { locales, defaultLocale, localeNames, isLocale, regionalLocaleDefaults, type Locale } from "@bgs/models/locale";
