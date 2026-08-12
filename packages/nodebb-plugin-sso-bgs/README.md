# nodebb-plugin-sso-bgs

Boardgamers SSO for the NodeBB forum (issue [#196](https://github.com/boardgamers/boardgamers-mono/issues/196)).
A thin shim around [`nodebb-plugin-sso-oauth2-multiple`](https://github.com/NodeBB/nodebb-plugin-sso-oauth2-multiple)
that makes it work against the Boardgamers OAuth2/OIDC provider
(`apps/api/app/routes/oauth2` in this monorepo).

## Why this exists

The provider is a **CIMD + PKCE-only public-client** provider:

- `GET /api/oauth2/authorize` **requires** `code_challenge` + `code_challenge_method=S256`;
- `POST /api/oauth2/token` **requires** `code_verifier` and **rejects any `client_secret`**
  (public clients: PKCE replaces client auth);
- the `client_id` is a URL hosting a
  [Client ID Metadata Document](https://drafts.oauth.net/draft-ietf-oauth-client-id-metadata-document/draft-ietf-oauth-client-id-metadata-document.html)
  — `redirect_uris` inside are exact-string matched.

The stock `sso-oauth2-multiple` plugin can't do that: it never enables PKCE/state on the
passport strategy, and the underlying `node-oauth` token POST always sends a
`client_secret` key (even an empty one is rejected by the provider). Everything else the
plugin does — userinfo fetching, claim normalization, and the login/account-linking
(`{name}Id:uid` lookup, then verified-email linking, then user creation) — is exactly
what we need, so this shim:

1. registers a passport OAuth2 strategy for the `boardgamers` strategy with
   `pkce: true, state: true` (S256 challenge/verifier + CSRF state, both handled by
   passport-oauth2's session store). The registered strategy **resolves the PKCE
   strategy at request time** from the current db config (see "Why request-time
   resolution" below) — it is registered at module load and re-registered on the
   per-request `filter:auth.options` hook, so it wins regardless of when the ACP
   strategy was saved relative to boot. The two plugins share the `loginStrategies`
   array; the shim hooks `filter:auth.init` at **priority 12** (after the stock
   plugin's 10) to replace the stock button descriptor with one carrying
   `checkState: false` (see below);
2. **overrides `authenticate`** to strip `options.state`. NodeBB core sets
   `opts.state = req.session.ssoState` (a string) before `passport.authenticate`, and
   passport-oauth2 — given a string state — skips its PKCE session store, so the
   `code_verifier` would never be persisted and the callback would 403. Stripping it
   lets the PKCE store run (persist the verifier + mint its own single-use handle).
   `checkState: false` tells core to skip its own `ssoState` equality gate; CSRF is
   still enforced by `PKCESessionStore.verify` (handle match + single-use);
3. replaces the token exchange so **no `client_secret` key is sent at all**;
4. delegates userinfo fetch, claim normalization, login/account-linking, and the
   post-login extras to the stock plugin (`getUserProfile` → `parseUserReturn` →
   `OAuth.login` → `onSuccessfulLogin`/`assignGroups`/`updateProfile`, firing
   `action:oauth2.login`);
5. serves the Client ID Metadata Document (`static/client-metadata.json`) at
   **`/client-metadata.json`** — the exact URL used as `client_id`, so the plugin is
   self-contained (no nginx change needed);
6. adds **silent (passive) SSO** — see below.

## Silent (passive) SSO

A visitor with an active boardgamers.space session who browses the forum logged-out
is auto-logged-in **without a click**, via one OIDC `prompt=none` round-trip. The
provider (`apps/api`) supports `prompt=none`: logged-in → returns a code; logged-out
→ redirects back with `error=login_required`. The flow:

1. **Detect** — an app-level middleware (mounted in `static:app.load`, so it runs
   before the page router) inspects every request and redirects **once** to
   `/auth/boardgamers?silent=1` when _all_ hold: anonymous (`req.uid <= 0`, not
   `req.loggedIn`), **not a spider** (`req.isSpider()` from core's
   `@nodebb/spider-detector`, falling back to UA parsing), a **GET** page request
   (skips `/api/*`, paths with a file extension — assets/uploads/robots/sitemap),
   not already on `/auth/boardgamers*` / `/login` / `/logout`, no `?logout` marker,
   and no fresh cooldown cookie. It sets `req.session.bgsSilent` so the callback can
   recognise the round-trip.
2. **Silent kickoff** — the `filter:auth.options` hook (already used for the
   strategy safety-net) sees the `?silent=1` + session-flag pair and turns the
   kickoff into a `prompt=none` authorize redirect, **reusing the exact PKCE/state
   machinery** (code_challenge/verifier, single-use state) the manual button uses.
   `prompt=none` is threaded via the PKCE state store's metadata (`opts.state`
   object) because passport-oauth2's stock `authorizationParams()` returns `{}`.
   `prompt=none` also suppresses the provider's consent interstitial — a user who
   hasn't consented gets `error=consent_required`, handled like any other failure.
3. **Return to the original page** — the page middleware captures `req.originalUrl`
   (the page the user was reading), validated same-origin by `safeReturnPath`, and
   threads it through the PKCE state-store metadata (`{prompt:"none", returnTo}`)
   alongside the prompt marker — persisted server-side in the session, so it can't
   be tampered with en route. Two app-level middlewares (mounted in
   `static:app.load` at `/auth/boardgamers/callback`, so they run _before_ NodeBB's
   callback route handler) use it. Core's callback route goes straight to
   `passport.authenticate` and does **not** fire `filter:auth.options` (that hook is
   kickoff-only), so this handling **cannot** live in the hook — it must be real
   middleware on the callback path. The PKCE metadata is read _before_
   passport-oauth2's `PKCESessionStore.verify` deletes it:
   - **Failure** (`error=login_required` / `consent_required` / …): the gate arms a
     timestamped cookie (`bgs_silent`, 1 h window inside a 1-day cookie) and
     **redirects back to `returnTo`** — the user lands on the page they were on,
     never sees an OIDC error page. While the cookie is fresh, page GETs skip the
     silent attempt — **no redirect loop** for logged-out users.
   - **Success** (a `code`): the second middleware wraps `res.redirect` so core's
     final post-login redirect (which core hardcodes to `strategy.successUrl || '/'`
     — it does not honour `req.session.returnTo` for SSO) lands back on `returnTo`
     instead — seamless login on the page they were reading. Explicit non-root
     redirects (e.g. a registration interstitial) are left alone.
4. **Explicit logout respected** — the middleware skips any request carrying a
   `?logout` marker (and the `/logout` path), so a user who just logged out is not
   instantly re-logged-in silently. The failure/logout cooldown expires on its own;
   logging in on the main site again and returning also works once it clears.

The **manual login button is untouched**: a kickoff without `?silent=1` clears any
stale session flag, never gets `prompt=none`, and keeps core's default post-login
landing (`/`), so it stays an interactive login. Spiders are never redirected (both
via `req.isSpider()` and a UA-regex fallback).

**Open-redirect safety** — `returnTo` only ever redirects to a same-origin relative
forum path: `safeReturnPath` requires a single leading `/`, rejects `//`/`/\`/`\\`
(protocol-relative/backslash) and non-`/` values (absolute URLs, `scheme:…`), and
rejects the SSO/`/login`/`/logout`/`/api` paths (pointless or a loop to land there
after a failed silent attempt). Anything suspicious falls back to `/`.

## Why request-time resolution (the live bug this fixes)

`filter:auth.init` — the hook that builds passport strategies — is fired by NodeBB
core **once per route reload** (boot / plugin reload), not per request. The first
version of this shim built its PKCE strategy only inside that hook. If the ACP
strategy config was saved **after** that one firing — the normal order when
installing the shim on a live forum (deploy + activate, restart, _then_ configure) —
the shim no-oped (no config yet), while the stock plugin's `loadStrategies`
(priority 10) registered its **non-PKCE** strategy on the next reload.
`passport.use(name)` is last-write-wins, so the stale stock strategy kept answering
`/auth/boardgamers` and redirected to authorize **without** `code_challenge` — which
the PKCE-only provider 403s (`expected string, received undefined at code_challenge`).

The fix: the passport strategy NodeBB resolves for `boardgamers` builds the real
PKCE strategy **from the current db config on each request** (cached by config, so
it's built once until the config changes). Boot order, ACP-save timing, and
`passport.use` overwrites by the stock plugin no longer matter — no
rebuild/restart is required after saving the strategy in the ACP.

## Install (forum server)

From the NodeBB install directory:

```bash
npm install /path/to/boardgamers-mono/packages/nodebb-plugin-sso-bgs
# npm resolves this shim's own dependency on nodebb-plugin-sso-oauth2-multiple.
./nodebb activate nodebb-plugin-sso-bgs
./nodebb activate nodebb-plugin-sso-oauth2-multiple
./nodebb build && ./nodebb restart
```

(`npm pack` this directory first if the monorepo checkout isn't on the forum box.)

This package is not part of the pnpm workspace install graph (`pnpm-workspace.yaml`
enumerates packages explicitly, and this plugin has its own npm-style dependency
manifest) — nothing to build, plain CommonJS.

## ACP configuration

ACP → Plugins → SSO OAuth2 → add strategy:

| Key                  | Value                                                    |
| -------------------- | -------------------------------------------------------- |
| `name`               | `boardgamers` (**exactly** — hardcoded in the shim)      |
| `authUrl`            | `https://www.boardgamers.space/api/oauth2/authorize`     |
| `tokenUrl`           | `https://www.boardgamers.space/api/oauth2/token`         |
| `userRoute`          | `https://www.boardgamers.space/api/oauth2/userinfo`      |
| `id`                 | `https://forum.boardgamers.space/client-metadata.json`   |
| `secret`             | any value (the shim never sends a secret)                |
| `scope`              | `openid profile email role`                              |
| `trustEmailVerified` | **on** — links existing forum accounts by verified email |
| `syncPicture`        | optional (userinfo exposes `picture`)                    |

Verify the metadata document is served:
`curl -s https://forum.boardgamers.space/client-metadata.json` → HTTP 200,
`content-type: application/json`, and its `client_id` must equal the URL itself.

## API-side step (maintainer)

Consent: CIMD clients are self-asserted, so the consent interstitial shows on every
user's first authorize — unless the recorded consent doc for
`clientId: https://forum.boardgamers.space/client-metadata.json` is flagged
`trusted: true` (the out-of-band first-party escape hatch). Do that once the first
consent doc exists (i.e. after one user has gone through the flow), or pre-create it.

## Tests

A regression harness simulating NodeBB v4.14 core (shared `loginStrategies` array,
last-write-wins `passport.use`, core's string-state calling convention, hook
priorities, the `static:app.load` page middleware, and core's `req.isSpider()`) runs
the shim against the **real** `passport`, `passport-oauth2`, and
`@nodebb/spider-detector`. It lives in `test/`.

```bash
npm install --no-save --prefix /tmp/sso-bgs-deps passport@0.7.0 passport-oauth@1.0.0 @nodebb/spider-detector@2.0.3
node --test 'test/*.spec.cjs'
```

It covers: ACP-save-after-boot (the live bug), config-present-at-boot, config edits
without a restart, disabling the strategy, the full kickoff→callback PKCE
round-trip (verifier persisted, no `client_secret`, single-use state), and the
string-`opts.state` override — plus the silent-SSO suite: one silent redirect with
`prompt=none` + PKCE, the `login_required`→cooldown→no-loop path (driven through a
callback harness faithful to core: the cooldown gate runs as an app-level callback
middleware, NOT via `filter:auth.options`, which core never fires on the callback),
the successful silent round-trip, **silent success and failure both returning to
the original page** (with the open-redirect guard falling back to `/` for
tampered/external `returnTo`), logged-in/spider/logout/SSO-path/API/asset
suppression, and the manual-button isolation.

## Notes / limitations

- Users **without an email** on their BGS account (email-less social signups, #211)
  cannot log in via OAuth. Such a user still has `security.confirmed: true`, so they
  **pass the provider's authorize gate**, complete the code exchange, and reach
  userinfo — which then omits the `email`/`email_verified` claims. The shim triggers
  purely on the **userinfo response lacking the `email` claim** and **fails with a
  user-facing message** (NodeBB redirects the failure `info.message` to
  `/?register=<message>`): "This boardgamers account has no email address. Add one in
  your boardgamers.space account settings to log into the forum." They must add an
  email to their BGS account first.
- PKCE/state use the forum's session store (`req.session`), which NodeBB always
  provides — no extra middleware needed.
- **Group mapping**: with the `role` scope granted, userinfo carries a standard
  `roles` array claim (e.g. `["admin"]` for admins, omitted for regular users). The
  stock plugin's `assignGroups` maps `profile.roles` entries onto same-named NodeBB
  groups (the built-in `administrators` group is a system group and is NOT assignable
  this way — map to a custom `admin` group instead, per its ACP settings).
- **No restart is needed after saving the `boardgamers` strategy in the ACP** — the
  strategy is resolved from the current db config at request time. (The login
  _button's_ `scope` label is captured at route-reload time by NodeBB core, like any
  SSO plugin, so a scope-only change is picked up on the next request anyway; only
  adding the very first strategy benefits from a rebuild to render the button.)
