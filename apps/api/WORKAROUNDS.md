# Workarounds & future cleanups — `apps/api`

Things that are intentional for now but should be revisited / removed later. Add an entry when you leave a temporary shim, a deferred migration, or anything a future reader might mistake for a permanent decision. Keep entries short and link the code.

## Migration-order CI guard supports the old layout (`scripts/check-migrations.ts`)

`check-migrations.ts` reads the base branch's migration registry across **both** the old single-file (`migrations.ts`) and new per-version (`migrations/`) layouts, because the refactor straddles that change. Once the new layout is on `master`, the old-layout fallback (`baseSource()`'s second candidate path) can be dropped.

## Koa doesn't recognise web streams or BSON `Binary` as response bodies (`app/routes/user/index.ts`)

Koa 2.x only treats Node streams / `Buffer` / string / object as `ctx.body`. Two non-obvious values fall through to `JSON.stringify`:

- a WHATWG `ReadableStream` (what `fetch().body` returns) serializes as `{}`;
- a BSON `Binary` (how the Mongo driver returns binary fields) serializes as a base64 JSON string.

Both bit the avatar route. It now buffers the dicebear SVG via `Buffer.from(await response.arrayBuffer())` and coerces the stored upload to a Node `Buffer`. SVGs/avatars are tiny so buffering is fine, but any future endpoint proxying a large `fetch()` body should convert with `Readable.fromWeb(...)` (mind the DOM-vs-`node:stream/web` `ReadableStream` type mismatch) rather than passing the web stream straight through.

Covered by `app/routes/user/index.spec.ts`. Keep this note until we migrate off Koa to a framework that handles web streams / binary bodies natively (Hono, etc.), then revisit both call sites.
