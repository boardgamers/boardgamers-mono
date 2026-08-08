# Workarounds & future cleanups — `apps/api`

Things that are intentional for now but should be revisited / removed later. Add an entry when you leave a temporary shim, a deferred migration, or anything a future reader might mistake for a permanent decision. Keep entries short and link the code.

## Dead-session cookie clearing also clears the legacy host-only variant (`app/app.ts`, `app/models/session.ts`)

Pre-overhaul (#112) deployments set the `refreshToken` cookie host-only (no `domain`); the current code sets `domain=env.domain`. Browsers treat those as two distinct cookies, and the older host-only one sorts first in the `Cookie` header, shadowing the fresh cookie — affected users can't log in at all. When the cookie-session middleware sees a code that no longer exists in `jwtrefreshtokens`, it clears **both** variants (`clearAllRefreshCookieVariants`). Safe to reduce back to `clearRefreshCookie` once pre-overhaul cookies have aged out (120-day expiry from the last pre-#112 deploy).

## Listen host: default `127.0.0.1`, prod binds `::1` (`app/config/env.ts`)

`env.listen.host` defaults to `127.0.0.1` (local dev, `scripts/instance-ip.sh` multi-instance). Prod is full IPv6: `listenHost=::1` in the prod env, and the nginx upstreams dial `::1`. Override via the `listenHost` env var. One rule: server bind and whoever dials it (nginx, vite proxy) must use the **same address family** — on coyo `localhost` binds only `::1`, so an IPv4 dial is refused (and vice versa). Revisit if we move to dual-stack listen or a hostname-based upstream. Game-server (`apps/game-server/app/config/env.ts`) mirrors this.

## Koa doesn't recognise web streams or BSON `Binary` as response bodies (`app/routes/user/index.ts`)

Koa 2.x only treats Node streams / `Buffer` / string / object as `ctx.body`. Two non-obvious values fall through to `JSON.stringify`:

- a WHATWG `ReadableStream` (what `fetch().body` returns) serializes as `{}`;
- a BSON `Binary` (how the Mongo driver returns binary fields) serializes as a base64 JSON string.

Both bit the avatar route. It now buffers the dicebear SVG via `Buffer.from(await response.arrayBuffer())` and coerces the stored upload to a Node `Buffer`. SVGs/avatars are tiny so buffering is fine, but any future endpoint proxying a large `fetch()` body should convert with `Readable.fromWeb(...)` (mind the DOM-vs-`node:stream/web` `ReadableStream` type mismatch) rather than passing the web stream straight through.

Covered by `app/routes/user/index.spec.ts`. Keep this note until we migrate off Koa to a framework that handles web streams / binary bodies natively (Hono, etc.), then revisit both call sites.

## Loki proxy route hardcodes localhost URL (`app/routes/admin/loki.ts`)

`/api/admin/loki/query/:key` proxies pre-built LogQL queries to Loki at `process.env.lokiUrl || "http://127.0.0.1:3100"`. This works because the Loki container and the API run on the same host (coyo). If Loki ever moves to a separate host, set `lokiUrl` in the env. The route is intentionally query-key-only (no raw LogQL from the client) to prevent LogQL injection — the `QUERIES` map in `loki.ts` is the allow-list. New dashboard queries should be added there.

The route inherits `router.use(isAdmin)` from the admin router (`app/routes/admin/index.ts:25`), so it's protected by the existing JWT → `authority === "admin"` check with no additional auth code.

### `fetch()` errors and the `isLokiDown` helper

Node 18+ wraps network failures from `fetch()` as `TypeError("fetch failed")` with the real cause (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, …) on `err.cause`, not on `err.message`. The `isLokiDown()` helper in `loki.ts` checks both layers so a down Loki surfaces as a 503 ("Loki is not running") instead of leaking through as a 500. If we ever drop the `fetch`-based proxy (e.g. switch to undici directly, or Node changes the error shape), revisit the helper.

## Hugging Face login via CIMD — no registered app, no relay (`app/config/passport.ts`, `apps/web/src/routes/.well-known/oauth-cimd/+server.ts`)

Hugging Face supports CIMD (Client ID Metadata Documents): the OAuth `client_id` is the
env's OWN `/.well-known/oauth-cimd` URL (served by the web app), which HF fetches and
validates. That doc names the env's own `/auth/huggingface/callback` as the redirect, so
every environment (prod + each PR preview) does HF login directly — the old prod
redirect-**relay** (`/huggingface?returnTo=…` + `/relay/callback`) is gone entirely, and
no `huggingfaceId`/`huggingfaceSecret` env or HF OAuth app registration is needed.

Because the client_id is per-origin and passport-oauth2 bakes it into the strategy, HF
strategies are built lazily and cached per origin (`huggingfaceStrategy(origin)`).
CIMD mandates a public PKCE client (`token_endpoint_auth_method: "none"`), so there is
no secret by design. The PKCE state lives in Mongo `oauthflows` (`models/oauthflows.ts`)
— single-use, TTL-expired, shared across processes.

The CIMD endpoint must be publicly reachable over HTTPS at
`https://<host>/.well-known/oauth-cimd` (it's on the web app, which nginx routes the
public origin to). The other providers (google/discord/facebook/github) have no CIMD
support — they keep their pre-registered confidential-client (or, for github, PKCE) apps
with prod's fixed callback, so on preview envs their social login simply isn't wired up.
