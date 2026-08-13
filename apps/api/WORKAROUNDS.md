# Workarounds & future cleanups — `apps/api`

Things that are intentional for now but should be revisited / removed later. Add an entry when you leave a temporary shim, a deferred migration, or anything a future reader might mistake for a permanent decision. Keep entries short and link the code.

## Avatar blobs kept in mongo after the S3 migration (`app/routes/user/index.ts`, `app/models/migrations/1.5.0-avatars-to-s3.ts`)

Avatars uploaded before the S3 migration keep their blob in mongo — the boot migration `1.5.0` copies the bytes to S3 and flags the doc `s3: true` but deliberately **never deletes** the blob: it is the serving fallback if the S3 setup is ever abandoned. New uploads (post-#224) are **S3-only** (metadata + etag hash in mongo, no blob) — there is nothing to roll back for those beyond the public S3 object itself. A follow-up migration can `$unset` `images.*.raw` on `s3: true` docs to reclaim the storage once S3 serving has proven itself — do NOT ship that unset in the same change as any code that still reads the blobs.

## S3-only avatars in PR previews fall back to DiceBear when the public base URL is unset (`app/routes/user/index.ts`)

Previews restore a sanitized prod dump that **includes** `images` docs — metadata-only (`s3: true`, no blob) for post-#224 uploads. Preview containers have no S3 creds; if they have `S3_BUCKET` + `S3_PUBLIC_ENDPOINT` (non-secret) they 302 to the public Scaleway gateway like prod (avatar objects are public-read). Without those vars, `serveUploadedAvatar` falls back to the DiceBear generated avatar so previews never 500/broken-image on a missing blob. Blob-bearing (pre-#224) avatars always serve from the dumped mongo bytes regardless.

## secure-cookie-over-insecure diagnostic (`app/models/session.ts`)

Prod logs a chronic "Cannot send secure cookie over unencrypted connection" from `setRefreshCookie` (~25–56/day + bursts): some requests reach the api with `ctx.secure === false` even though prod is HTTPS-only and nginx sets `X-Forwarded-Proto` on the api vhost. The source is **unknown** (internal caller? crawler over http? a route/XFP gap?), and a "drop Secure on http" fix was rejected — the cookie must stay `Secure`. Until the culprit is found, `setRefreshCookie` records the full request context (secure/protocol/hostname/ip/ips, X-Forwarded-*/host/user-agent/referer/origin headers, `app.proxy`) as a `secure-cookie-over-insecure` warn log line **and** an `apierrors` record (`meta.source: "secure-cookie"`, surfaced by `GET /api/admin/errors` → admin health page). Behavior is unchanged — the cookie set still throws, still 500s. Once the root cause is identified and fixed, this diagnostic can be removed.

## Legacy `Domain=` session-cookie cleanup during the host-only migration (`app/app.ts`, `app/models/session.ts`)

A host-only `refreshToken` cookie and a `Domain=boardgamers.space` one are distinct cookies to the browser, and the host-only one sorts **first** in the `Cookie` header — whichever of the two is stale shadows the fresh one and can lock the user out of login until it expires (120-day lifetime). This hazard has bitten from both directions:

- Pre-overhaul (#112) deployments set the cookie host-only; the post-overhaul code set `Domain=env.domain`, and the stale host-only cookie shadowed the fresh Domain= one.
- The apex migration (#153, step 5) flipped the cookie back to **host-only** (apex `boardgamers.space` is canonical; the cookie must not leak to `forum.`/`admin.`/`resources.`/`grafana.`) — now the stale pre-cutover `Domain=boardgamers.space` cookie is the lingering one.

So every code path that sets or clears the cookie now **also clears the other variant**: `setRefreshCookie` sets host-only and deletes the `Domain=env.domain` cookie (a deletion must repeat the exact Domain it was set with or the browser ignores it); `clearRefreshCookie`/`clearAllRefreshCookieVariants` (logout + the dead-session path in `app.ts`) delete both variants.

**TODO(#153, #283):** 120 days after the step-5 deploy (~2026-12-11) every legacy Domain cookie has expired — remove the Domain-cookie cleanup from `setRefreshCookie` and reduce `clearAllRefreshCookieVariants` back to the plain host-only clear.

## Preview session cookie is scoped host-only by the coyo proxy, not the api (`infra/pr-preview/coyo-pr-preview.nginx.conf`)

Historically the api stamped the session cookie `Domain=env.domain`; it had no per-host cookie logic. On PR previews the player (`pr-<n>`) and admin (`admin-pr-<n>`) hosts are siblings, so the admin host would reject a `Domain=pr-<n>` cookie. The fix is a `proxy_cookie_domain … $host;` rewrite in **both** server blocks of the coyo preview vhost, which stores the cookie host-only per preview host (and off the prod `boardgamers.space` namespace). That config lives on coyo, outside this repo's test harness — `apps/api/app/models/session.spec.ts` asserts the api behaviour the proxy relies on (sibling hosts don't share, host-only invariant) but cannot exercise the rewrite itself. Since apex step 5 (#153) the api's cookie is host-only anyway — the rewrite now mainly scrubs the transitional `Domain=env.domain` **deletion** header (above) so a preview never sends a prod-domain cookie clear. If preview login breaks again, check the coyo vhost first.

## Listen host: default `127.0.0.1`, prod binds `::1` (`app/config/env.ts`)

`env.listen.host` defaults to `127.0.0.1` (local dev, `scripts/instance-ip.sh` multi-instance). Prod is full IPv6: `listenHost=::1` in the prod env, and the nginx upstreams dial `::1`. Override via the `listenHost` env var. One rule: server bind and whoever dials it (nginx, vite proxy) must use the **same address family** — on coyo `localhost` binds only `::1`, so an IPv4 dial is refused (and vice versa). Revisit if we move to dual-stack listen or a hostname-based upstream. Game-server (`apps/game-server/app/config/env.ts`) mirrors this.

## Koa doesn't recognise BSON `Binary` as a response body (`app/routes/user/index.ts`)

Koa 2.x only treats Node streams / `Buffer` / string / object as `ctx.body`. A BSON `Binary` (how the Mongo driver returns binary fields) falls through to `JSON.stringify` and serializes as a base64 JSON string.

The avatar route's uploaded-avatar branch coerces the stored upload to a Node `Buffer` for this reason. Avatars are tiny so buffering is fine. (The dicebear branch used to hit the same issue with `fetch()`'s WHATWG `ReadableStream` — gone since #175 made generation local: it now sets a plain string.)

Covered by `app/routes/user/index.spec.ts`. Keep this note until we migrate off Koa to a framework that handles binary bodies natively (Hono, etc.), then revisit the call site.

## Uploaded-avatar ETag hash is only stored for new uploads (`app/routes/account/index.ts`, `packages/models/image.ts`)

`POST /account/avatar` stores a per-format `hash` (sha256 of the webp) on the images doc, which the avatar route uses as the ETag without re-hashing the blob per request. Avatars uploaded **before** this field was added have no `hash`; the route falls back to computing it from the body on the fly (same value, just per-request). No backfill migration — existing avatars get the stored hash the next time the user re-uploads. Add a one-off migration only if the per-request hashing ever shows up in profiles.

## Loki proxy route hardcodes localhost URL (`app/routes/admin/loki.ts`)

`/api/admin/loki/query/:key` proxies pre-built LogQL queries to Loki at `process.env.lokiUrl || "http://127.0.0.1:3100"`. This works because the Loki container and the API run on the same host (coyo). If Loki ever moves to a separate host, set `lokiUrl` in the env. The route is intentionally query-key-only (no raw LogQL from the client) to prevent LogQL injection — the `QUERIES` map in `loki.ts` is the allow-list. New dashboard queries should be added there.

The route inherits `router.use(isAdmin)` from the admin router (`app/routes/admin/index.ts:25`), so it's protected by the existing JWT → `authority === "admin"` check with no additional auth code.

### `fetch()` errors and the `isLokiDown` helper

Node 18+ wraps network failures from `fetch()` as `TypeError("fetch failed")` with the real cause (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, …) on `err.cause`, not on `err.message`. The `isLokiDown()` helper in `loki.ts` checks both layers so a down Loki surfaces as a 503 ("Loki is not running") instead of leaking through as a 500. If we ever drop the `fetch`-based proxy (e.g. switch to undici directly, or Node changes the error shape), revisit the helper.
