# Workarounds

## OG share images: on-demand renders with a best-effort S3 cache

`/share.webp/<kind>/…` screenshots the matching `/thumbnail/<kind>/…` card with
Playwright (PNG) and converts to WebP via sharp, on a cache miss, guarded by a bounded
render queue. Responses carry a content-derived **ETag** (a hash of the exact db fields
the card renders) plus `Cache-Control: public, max-age=300, must-revalidate`, so
clients/CDNs revalidate cheaply (`If-None-Match` → 304, no render) and a changed entity
(player joined, round advanced, karma changed) automatically yields a new ETag and a
fresh render.

When the `S3_*` env vars are set (see `apps/web/.env.example`), rendered webp's are also
cached in an S3 bucket (Scaleway `bgs-assets` in prod) under `share/<route>.<etag>.webp`
— the ETag already captures data changes, so a changed entity renders to a NEW key and
no stale object is ever served. The cache is best-effort: unset env or any S3 error
falls back to plain rendering. Stale keys (old etags) accumulate until the bucket's
lifecycle rules expire them — worth configuring on the bucket. A CDN /
stale-while-revalidate in front is still a possible future improvement.

Secrets live in the gitignored `apps/web/.env` on prod, auto-loaded at startup by
`src/lib/server-env.ts` (which walks up to the package root, so it resolves correctly
from both `src/lib` and the compiled `build/server/chunks/` regardless of PM2's cwd);
real `process.env` values still win, so PM2-injected vars take precedence. Do NOT
commit them to `ecosystem.config.cjs`, which is git-tracked. Locally the same
`apps/web/.env` works, or just export the vars.

Two render-path constraints (in `share-image.server.ts#renderWebp`): the internal
Chromium navigation sends a loopback `x-forwarded-for: 127.0.0.1` because prod runs
adapter-node with `ADDRESS_HEADER=x-forwarded-for`, which **throws** when the header is
absent — and the direct loopback render has no nginx to add it (a cold render would
otherwise 500). And the render refuses to screenshot/cache a non-2xx card page: an
error card cached under the etag key would be served forever, so a non-2xx (or a null
navigation response) throws and the request 503s like a missing Chromium instead.

## `IconStub.svelte` test stub for `$props()` rest-spread leaf components

Leaf components that spread `$props()` rest (`let { ...rest } = $props()` + `{...rest}`
— e.g. `IconClockHistory`, `Badge`) crash with "Cannot convert undefined or null to
object" when `mount()`ed with empty/undefined props in the jsdom + `@sveltejs/vite-plugin-svelte`
vitest env. Production is unaffected (SSR/parent render always passes a props object);
only standalone `mount()` in component specs hits it. Specs that mount a parent which
renders such a leaf should stub it via
`vi.mock("@/components/icons/Icon….svelte", () => import("@/lib/__mocks__/IconStub.svelte"))`
(see `src/components/Game/GameList.spec.ts`). Revisit if the mount env is fixed
(upgrading `svelte` / the vitest plugin, or dropping the rest-spread from the leaves).
Last checked on svelte 5.56.8 + vite-plugin-svelte 7.2.0 (#118): still broken.

## `credentialless` iframe flag set via a Svelte action

`StartedGame.svelte` sets the (untyped) `credentialless` iframe property with a
`use:credentialless` action instead of an attribute spread (`{...{ credentialless: true } as any}`):
spread attributes crash components mounted in the vitest jsdom env
(`TypeError: Cannot convert undefined or null to object` — same family as the leaf
`$props()` rest-spread issue documented on the `src/lib/__mocks__` stubs). If the
jsdom/spread issue is ever fixed, the action can go back to a spread (or a plain
attribute once TS types it).

## `playerClick` legacy `{ name }` payload tolerance

The viewer uplink contract (`apps/docs/docs/guide/viewer-api.md`, "player:clicked") is
`{ index: number }`, relayed verbatim by the iframe shim as `event.data.player`.
`StartedGame.svelte` resolves the username from `game.players[index].name`, but still
honors a legacy `{ name: string }` payload when present. Removable once no published
viewer emits `player:clicked` with a `{ name }` payload. Audited 2026-08-30 (#118)
against every viewer bundle referenced by prod gameinfo docs: the published
gaia-project viewers (`@gaia-project/viewer@5.12.0`, `@gaia-project/old-ui@1.0.0`)
emit `{ name, auth, index }` where `index` can be undefined when the store lacks
player data — the `name` path is load-bearing there — and the take6 3D viewer emits
`{ index, name }`. Condition not met; keep.
