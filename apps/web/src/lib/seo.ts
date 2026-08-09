// Pure SEO helpers and constants. The reactive head store lives in `seo.svelte.ts`
// (`.svelte.ts` so the `$state` rune compiles both for the app build and under vitest,
// where plain `.ts` files are not run through the Svelte compiler). Re-exported here so
// existing `@/lib/seo` imports keep working.
export * from "./seo.svelte";
