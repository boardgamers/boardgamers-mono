# Frontend workarounds

This app was pinned to an **ancient prerelease of SvelteKit** (`@sveltejs/kit@1.0.0-next.216`, Svelte 3, `@sveltejs/adapter-node@1.0.0-next.58`). As of the recent migration it is now on **Svelte 5 + SvelteKit 2 + adapter-node 5**. The three workarounds listed below have been **resolved and removed** during the migration — they are kept here for historical reference.

> If you hit a new SSR-only crash, check whether it's a residual issue from the migration. The old "prefer a patch over starting the migration" guidance no longer applies — the migration is done.

---

## 1. SSR `fetch` reconstruction throws on null-body statuses — ✅ RESOLVED

**Was:** `src/hooks.ts` — `normalizeNullBodyStatus()` / `externalFetch`

**Resolution:** Modern SvelteKit serializes SSR fetches correctly. `externalFetch` was replaced by `handleFetch` in `hooks.server.ts`, and `normalizeNullBodyStatus` was deleted entirely.

---

## 2. SSR POST to `/account/confirm` breaks on Node 20+ — ✅ RESOLVED

**Was:** `src/routes/confirm.svelte` — the `typeof window === "undefined"` guard

**Resolution:** The confirmation `POST` now runs in the universal `+page.ts` load function normally. The SSR guard was removed. The route is now `confirm/+page.ts` with `ssr = false` (the POST runs client-side only, which is the same effective behavior but without the hack).

---

## 3. SSR HTML mangles multiline attribute values — ✅ RESOLVED

**Was:** `src/hooks.ts` — the `handle` hook post-processing `<meta name="description">`

**Resolution:** Modern SvelteKit serializes multiline attributes correctly. The post-processing hack was deleted from `handle` in `hooks.server.ts`.

---

## Migration notes

The SvelteKit migration is now complete. The following changes were made:

- **Svelte 3 → Svelte 5** (runes mode for new/migrated files; legacy mode for untouched components)
- **SvelteKit next.216 → 2.69** (modern routing, `+page`/`+layout`, `PageLoad`/`ServerLoad`, `hooks.server.ts`)
- **adapter-node next.58 → 5.5**
- **Session handling**: Removed the custom `getSession` → `input.session` → `WeakMap` container. Auth now flows through `event.locals` (server) → `+layout.server.ts` data → `$page.data` (client). The `useLoad`/`useSession`/`defineStore` composition apparatus was replaced with module-level stores in `$lib/`.
- **sveltestrap**: Replaced with thin Svelte 5 wrapper components in `@/modules/cdk` (will be replaced by Tailwind in a later phase).
- **Composition layer**: The entire `src/composition/` directory was removed. All imports now point directly to `$lib/*.svelte.ts` modules.

### Remaining work (not workarounds)

- ~152 `svelte-check` type errors — all pre-existing TypeScript strictness issues (nullable values, implicit `any`) in component code, exposed by the stricter modern toolchain. Not migration regressions.
- Many components still use Svelte 3 `$:` reactive statements and `export let` — they work in Svelte 5 legacy mode but should be migrated to runes eventually.
- Tailwind/Bootstrap redesign is planned as a separate phase.
