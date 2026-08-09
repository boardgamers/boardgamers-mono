# Design: forum SSO via an OAuth2/OIDC provider on the API (#76, #153)

**Status: proposal.** This is a design document, not an implementation. It describes how
`forum.boardgamers.space` (NodeBB) moves off the bespoke signed-JWT `token` cookie and onto a
standard OAuth2 authorization-code flow against the boardgamers API acting as an OAuth2/OIDC
**provider**.

- Issue #76 — OAuth2 support (possibly CIMD)
- Issue #153 — cookie-domain pain of the current forum SSO cookie
- Issue #152 — the re-sign/clear churn of the current cookie (made tolerable, but the underlying
  mechanism is still a shared cookie across subdomains)

---

## 1. Where we are today

### 1.1 Forum SSO as it exists

The API is the identity system; NodeBB sits on `forum.boardgamers.space`.

- `apps/api/app/models/forumsso.ts` signs a short-lived (1 h) RS256/HS256 JWT
  `{ id, username, email }` and sets it as the `token` cookie with `Domain=boardgamers.space` so the
  forum subdomain can read it.
- A response middleware in `apps/api/app/app.ts` re-issues that cookie on every authenticated
  response where the cookie is absent, invalid, stale, or under half its life
  (`reissueForumSsoCookieIfNeeded`), and clears **both** the domain and host-only variants on
  logout (`clearForumSsoCookie`, with the `forumSsoCookieCleared` dance to avoid double-clearing).
- NodeBB validates the JWT with the API's public key and logs the user in transparently.

Pain points, all rooted in "the forum shares a cookie with the main site":

- **#153 (cookie domains)** — the cookie must be scoped `Domain=boardgamers.space`, which means it
  rides **every** request to **every** subdomain (admin, resources, grafana, previews), and the
  domain/host-only variants must be cleared in pairs on logout or a stale shadow cookie locks the
  user out (#152 was exactly this class of bug). Any future app on `*.boardgamers.space` inherits
  the credential whether it wants it or not.
- The forum's logged-in state is a side effect of a cookie it doesn't own: no explicit consent
  step, no way to see/revoke "the forum" as a session, no logout propagation (clearing our cookie
  doesn't end the NodeBB session and vice versa).
- The mechanism is bespoke — nothing else can reuse it, and every consumer needs the JWT public
  key plus our exact claim contract.

### 1.2 The API is an OAuth *client*, not a provider

`apps/api/app/routes/account/auth.ts` + `apps/api/app/config/passport.ts` log users in via
Google/Discord/Facebook/GitHub/Hugging Face. Notable pieces we can reuse:

- **Server-side, single-use, TTL-expired flow state** in the `oauthflows` collection
  (`packages/models/oauthflow.ts`, `apps/api/app/models/oauthflows.ts`): today `oauth-state`
  (PKCE verifier) and `pending-signup` (one-time signup ticket), both via `findOneAndDelete` —
  genuinely single-use, surviving restarts and PM2 workers.
- **Session model** (`apps/api/app/models/session.ts`, `jwtrefreshtokens.ts`): the browser holds a
  long-lived (120-day, sliding) `refreshToken` cookie whose raw code is a 256-bit random value,
  stored **hashed** (sha256) in `jwtRefreshTokens` since #164. Short-lived (1 h) access tokens are
  RS256/HS256 JWTs `{ userId, scopes, isAdmin }` from `createAccessToken`, verified in `app.ts` with
  `accessTokenPayloadSchema` (only the `"all"` scope currently authenticates as a user).
- **Hugging Face login uses CIMD** (Client ID Metadata Documents): the `client_id` is the env's own
  `/.well-known/oauth-cimd` URL served by the web app, which names the callback — no pre-registered
  OAuth app needed. See §6 for why this does **not** apply to the provider direction.

**Nothing today hosts an OAuth *provider***: there is no `/oauth/authorize`, no `/oauth/token`, no
userinfo endpoint for third parties.

## 2. What NodeBB needs

Research on the NodeBB SSO plugin ecosystem (see appendix):

- The original `nodebb-plugin-sso-oauth2` (julianlam) is effectively superseded by
  **`nodebb-plugin-sso-oauth2-multiple`** (NodeBB org, actively maintained, supports NodeBB
  ^3.3/^4.x, multiple named strategies configured in the ACP).
- Per-strategy config keys (ACP → SSO → OAuth2): `name` (slug, defines `/auth/{name}` +
  `/auth/{name}/callback`), `authUrl`, `tokenUrl`, `userRoute` (userinfo URL, may be relative to the
  `authUrl` host), `id` (client id), `secret` (client secret), `scope` (default
  `openid email profile`), button labels/icon, and toggles: `usernameViaEmail`,
  `forceUsernameViaEmail`, **`trustEmailVerified`** (gates email-based account linking),
  `idKey` (alternative id claim), `syncFullname`, `syncPicture`.
- The runtime is **plain OAuth2 via passport-oauth2**: manual endpoints (the ACP only *prefills*
  from `https://{domain}/.well-known/openid-configuration` as an admin convenience), **no PKCE, no
  ID-token validation, no JWKS** — the access token is exchanged server-side with
  `client_id`/`client_secret` and the userinfo endpoint is called with a `Bearer` header.
- **Userinfo contract** (flat, top-level keys only — no nested-claim mapping):
  - id: `profile[idKey] || id || sub`
  - username: `nickname || preferred_username || name` (else email local-part if enabled)
  - fullname: `name` or `given_name [middle_name] family_name`
  - `email` (required), `email_verified` (truthy → confirmed email + linking when trusted)
  - optional `picture`, `roles: []` (group associations)
  - **Hard requirement: id, a display name, and email must all be truthy** or login fails with
    `insufficient-scope`.
- **Account handling**: lookup by `{name}Id:uid` (remote id → NodeBB uid); fallback linking by
  email **only** when `trustEmailVerified` is on and `email_verified` is truthy; otherwise a new
  NodeBB user is auto-created (`username` = displayName, NodeBB dedups collisions).

So the provider contract is small: an authorize endpoint, a token endpoint doing
secret-based client auth, and a userinfo endpoint returning flat claims.

## 3. Options considered

### Option A — Minimal OAuth2/OIDC provider on the API (recommended)

Add four endpoints to `apps/api` implementing the authorization-code flow for **registered
first-party clients**, with the forum as the first (and initially only) client:

| Endpoint                                 | Purpose                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /api/oauth/authorize`               | Consent/redirect entry point. Requires a signed-in BGS session.                |
| `POST /api/oauth/token`                  | `authorization_code` grant (+ optional `refresh_token` grant), secret auth.    |
| `GET /api/oauth/userinfo`                | OIDC-flavored claims for a bearer access token.                                |
| `GET /api/oauth/.well-known/…` (optional) | OIDC discovery metadata, purely for the NodeBB ACP autofill UX.               |

Why this is the right call:

- It matches the issue's intent (#76) and **deletes the entire cookie-domain problem class**
  (#153, and the #152 shadow-cookie bugs) instead of working around it: the forum gets its own
  server-side session, established by an explicit redirect handshake. No cookie is ever shared with
  `*.boardgamers.space` again — the API only ever reads the `refreshToken` cookie on its own
  origin during `/oauth/authorize`.
- The plugin needs nothing exotic. Everything it wants is plain OAuth2 we fully control.
- The building blocks already exist: single-use flow store (`oauthflows`), access-token minting
  (`createAccessToken`), session cookies, RS256 keys in prod.
- It generalizes: once the provider exists, "log in with boardgamers" for other tools (future
  mobile app, Discord bots, third-party game tools) is a config row, not a new bespoke bridge.

### Option B — Pragmatic intermediate: `nodebb-plugin-session-sharing`

NodeBB's session-sharing plugin also does cookie/JWT SSO (it's what many NodeBB+parent-app setups
use) — but it has the **same fundamental shape as what we already have**: a shared cookie read on
the forum domain. It would standardize the NodeBB *side* of the current mechanism without fixing
#153 at all. Rejected as a destination; not needed as a stepping stone because Option A is small.

### Option C — Make the forum log in via an external provider we already trust (GitHub/HF)

Pushing forum accounts through GitHub login would force every forum user to have/link a GitHub
account and would sever forum identity from BGS identity. Rejected.

**Recommendation: Option A**, with the forum as the sole registered client in phase 1.

## 4. Proposed design

### 4.1 Flow (authorization code, confidential client)

```
Browser                     forum.boardgamers.space            boardgamers.space (API)
  |  "Log in"                    |                                    |
  |----------------------------->|  302 /api/oauth/authorize?         |
  |                              |    client_id=nodebb-forum&         |
  |                              |    redirect_uri=https://forum…/    |
  |                              |      auth/boardgamers/callback&    |
  |                              |    response_type=code&scope=openid |
  |                              |      profile email&state=…         |
  |------------------------------------------------------------>|     |
  |        (refreshToken session cookie rides this request —    |     |
  |         same origin as the site, no cross-domain cookie)    |     |
  |                                                             |-- not signed in → 303 /login?then=<full authorize URL>
  |                                                             |-- signed in → 303 redirect_uri?code=…&state=…
  |<------------------------------------------------------------|     |
  |----------------------------->|  POST /api/oauth/token             |
  |                              |    grant_type=authorization_code,  |
  |                              |    code, redirect_uri,             |
  |                              |    client_id + client_secret  ---->|-- single-use code check (findOneAndDelete)
  |                              |                                    |-- mint access JWT (1h) + refresh code (30d)
  |                              |<--- { access_token, refresh_token, |
  |                              |       token_type, expires_in }     |
  |                              |  GET /api/oauth/userinfo           |
  |                              |    Authorization: Bearer … ------->|-- 200 { sub, preferred_username, name,
  |                              |                                    |       email, email_verified, picture? }
  |                              |  NodeBB creates/links + logs in    |
```

The only browser↔API contact is the authorize redirect, where the existing first-party session
cookie authenticates the user. Everything else is server-to-server between NodeBB and the API.

### 4.2 Endpoints

All under `/api/oauth`, new router `apps/api/app/routes/oauth.ts`:

**`GET /api/oauth/authorize`**

- Query: `client_id`, `redirect_uri`, `response_type=code`, `scope`, `state`.
- Validate: client exists in `oauthclients`, `redirect_uri` **exactly matches** one of the client's
  registered URIs (string equality — no prefix/pattern matching), `response_type === "code"`,
  scope ⊆ client's allowed scopes.
- If `ctx.state.user` is unset (no session cookie): 303 to the web login page with a `then`
  parameter carrying the full authorize URL (the login flow already redirects post-auth; social
  auth landing preserves query params — to be verified during implementation; worst case a tiny
  interstitial "Continue to forum" page after login).
- If signed in: issue a code — `oauthflows` doc, new variant
  `kind: "oauth-code"` (see §4.3), then 303 to `redirect_uri?code=…&state=…`.
- **Consent screen: deferred.** First-party client + the narrow scope (identity claims the forum
  already receives today via the JWT cookie) make an explicit consent page optional for phase 1;
  the client registry keeps a `trusted: true` flag meaning "skip consent". Adding a consent page
  later is purely additive (set `trusted: false` → render an approve/deny page at authorize time).

**`POST /api/oauth/token`** (`application/x-www-form-urlencoded`)

- `grant_type=authorization_code`: params `code`, `redirect_uri`, `client_id`, `client_secret`.
  - Client auth: HTTP Basic preferred, body params accepted (passport-oauth2 sends body by
    default — support both). Compare the secret with a timing-safe compare against the stored
    **hash**.
  - Redeem the code via `findOneAndDelete` on `oauthflows` (single-use), check 10-min expiry,
    check the stored `clientId`/`redirectUri` match the request.
  - Respond `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token, scope }`.
- `grant_type=refresh_token` (phase 2, optional): rotate the forum's refresh code. NodeBB's plugin
  doesn't refresh tokens (it only uses the access token once, at login), so this grant only matters
  for future clients that keep server-side sessions. Cheap to add; can wait.

**`GET /api/oauth/userinfo`**

- `Authorization: Bearer <access_token>`. Verify with the existing public key; require
  `aud`/scope `forum` (see §4.4) — a token minted for the forum must not authenticate as a full
  API session and vice versa.
- Response (flat claims, exactly what `nodebb-plugin-sso-oauth2-multiple` parses):

```json
{
  "sub": "<user _id>",
  "id": "<user _id>",
  "preferred_username": "<account.username>",
  "name": "<account.username>",
  "email": "<account.email>",
  "email_verified": true,
  "picture": "<avatar url if any>"
}
```

`email_verified: true` is honest: BGS accounts confirm their email at signup (confirmKey flow), and
social signups come from providers with verified emails. This flag is what lets NodeBB link a
pre-existing forum account by email (`trustEmailVerified`), which matters for the migration (§4.6).

### 4.3 Data model additions

**Extend `oauthFlowSchema`** (`packages/models/oauthflow.ts`) with a third variant — same
single-use, TTL-indexed collection, same `findOneAndDelete` redemption:

```ts
z.object({
  kind: z.literal("oauth-code"),
  _id: z.string(),              // the code itself: crypto.randomBytes(24).base64url
  clientId: z.string(),
  redirectUri: z.string(),      // stored to re-check at token time (mix-up defense)
  user: zObjectId,              // the consenting user
  scopes: z.array(z.string()),  // granted scopes
  expiresAt: z.date(),          // now + 10 min; existing TTL index reaps it
})
```

**New `oauthclients` collection** (`packages/models/oauthclient.ts`), one doc per registered
client, admin-managed (no self-service registration in phase 1):

```ts
{
  _id: "nodebb-forum",           // client_id
  name: "Boardgamers forum",
  secretHash: "<sha256 of the client secret>",   // raw secret shown once at creation
  redirectUris: ["https://forum.boardgamers.space/auth/boardgamers/callback"],
  scopes: ["openid", "profile", "email"],
  trusted: true,                 // skip the (future) consent screen
  createdAt, createdBy
}
```

Per the AGENTS.md personal-data rules: neither collection holds personal data beyond what
`oauthflows` already holds (single-use, minutes-lived), so the preview sanitize script needs no
change — but `infra/pr-preview/seed/dump-and-ship.sh`'s `EXCLUDED` list should get `oauthclients`
added if we ever let it carry real secrets into dumps (client secrets are per-env anyway; a
preview registers its own forum client).

### 4.4 Token model — how it maps to existing sessions

Two distinct credential families, deliberately **not** interchangeable:

| Credential            | Audience                | Minted by                                                     | Verified by                                                  |
| --------------------- | ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Session refresh code  | API + web app           | `sendAuthInfo` (120 d, sliding, hashed at rest)              | `lookupRefreshToken` cookie middleware                        |
| Access JWT `["all"]`  | API + game-server       | `createAccessToken(..., ["all"], …)` (1 h)                   | `app.ts` bearer middleware (requires scope `"all"`)          |
| **Forum access JWT**  | `/api/oauth/userinfo`   | `createAccessToken(..., ["forum"], …)` (1 h) — new call site | userinfo endpoint only                                        |
| **Forum refresh code**| `POST /oauth/token`     | new — stored hashed in `jwtRefreshTokens`? No: separate field | token endpoint only (phase 2)                                |

Key points:

- **Reuse `createAccessToken` as-is** with `scopes: ["forum"]`. The existing bearer middleware in
  `app.ts` only authenticates tokens containing scope `"all"`, so a leaked forum token **cannot**
  act as an API session — scope isolation falls out of code we already have. The userinfo endpoint
  does the inverse check (requires `["forum"]`), so a stolen main-site access token cannot be
  replayed against userinfo either.
- The forum-issued **refresh token** (phase 2) should be a random code stored hashed
  (`hashRefreshCode` pattern) with `clientId` + `user` + `scopes`, either as a new `kind` on the
  refresh-token collection or a small `oauthtokens` collection — decided at implementation time.
  NodeBB's plugin ignores refresh tokens, so phase 1 can omit the grant entirely and keep access
  tokens one-shot (they're used for exactly one userinfo call during login).
- **Logout**: NodeBB keeps its own session cookie; logging out of the site no longer touches the
  forum (and vice versa). Acceptable and standard (same as Google-login sites); if we later want
  global logout, OIDC back-channel logout is the upgrade path — out of scope.

### 4.5 NodeBB configuration

Install/enable `nodebb-plugin-sso-oauth2-multiple`, then in ACP → Plugins → SSO OAuth2, add
strategy:

| Key          | Value                                                                 |
| ------------ | --------------------------------------------------------------------- |
| `name`       | `boardgamers`                                                          |
| `authUrl`    | `https://boardgamers.space/api/oauth/authorize`                        |
| `tokenUrl`   | `https://boardgamers.space/api/oauth/token`                            |
| `userRoute`  | `https://boardgamers.space/api/oauth/userinfo`                         |
| `id`         | `nodebb-forum`                                                         |
| `secret`     | `<generated at client registration>`                                   |
| `scope`      | `openid profile email` (the plugin default)                            |
| `trustEmailVerified` | **on** — links existing forum accounts by verified email         |
| `syncPicture`| optional, if we expose an avatar URL                                  |

The plugin's callback is `https://forum.boardgamers.space/auth/boardgamers/callback` — this exact
string goes into the client's `redirectUris`.

Local-account login on the forum can then be disabled (or kept for forum admins during rollout).

### 4.6 Migration from the JWT cookie

1. Deploy the API endpoints + register the `nodebb-forum` client.
2. Configure the NodeBB plugin alongside the existing JWT-cookie SSO (both can coexist — the
   cookie keeps working for already-logged-in forum sessions).
3. `trustEmailVerified` links each user to their existing NodeBB account on first OAuth login by
   verified email; the `{boardgamers}Id:uid` mapping takes over from there.
4. After a bake period (e.g. 2 weeks / one release cycle), remove `forumsso.ts`, its app.ts
   middleware, the `token` cookie, and NodeBB's JWT-reader config. This permanently closes the
   #152/#153 cookie-variant surface — no cookie is shared across subdomains at all anymore.

### 4.7 Security considerations

- **Redirect URI**: exact-string match against the registered list. No wildcards, no suffix
  matching. (An open redirector here leaks codes.)
- **Codes**: 192-bit random, **single-use** via `findOneAndDelete` (replay → second redemption
  fails), 10-minute expiry, bound to `clientId` + `redirectUri` at redemption (mix-up defense).
- **Client secret**: 256-bit random, stored sha256-hashed (same posture as #164 session codes),
  timing-safe compare; shown once at registration. The client is confidential (NodeBB server-side),
  so secret auth is sufficient.
- **PKCE**: not required for this confidential server-to-server client — and the NodeBB plugin
  can't do PKCE anyway (passport-oauth2 constructed without `pkce: true`). Accept + require PKCE
  at `/oauth/authorize` anyway (`code_challenge`/`code_challenge_method=S256` optional-but-honored)
  so future public clients (mobile) get it for free; phase 1 may simply ignore absent challenges.
- **Scope isolation**: forum tokens carry `["forum"]`, never `"all"`; userinfo rejects anything but
  `["forum"]`. A forum-token leak grants read-only identity claims, nothing else.
- **Token TTLs**: access 1 h (existing `accessTokenDuration`); forum refresh (phase 2) 30 days,
  rotating, revocable per-client.
- **State**: NodeBB's passport stack handles `state` itself; we pass it through opaquely.
- **Rate limiting**: token + userinfo endpoints get the same throttling posture as login routes;
  failures must not distinguish "bad client" from "bad code" beyond what OAuth's error contract
  requires (`invalid_grant` / `invalid_client`).
- **Personal data**: userinfo exposes email — but only to a registered first-party client over
  server-to-server TLS, which already receives it today via the JWT cookie. No new data leaves the
  trust boundary.

## 5. CIMD — why it does not apply here (#76)

CIMD (Client ID Metadata Documents) is an **OAuth client** convention: the *client* publishes a
metadata document at a URL and uses that URL as its `client_id`, so the *provider* can fetch the
client's registration instead of requiring a pre-registered app. We already use it in exactly that
direction — the API is a CIMD **client** of Hugging Face (`/.well-known/oauth-cimd` names our
HF callback), which is what lets every PR preview do HF login with zero registration.

For the forum integration the API is on the other side of the table — it is the **provider**, and
NodeBB is the client. CIMD would only enter the picture if NodeBB (the client) wanted to avoid
static registration with us — but (a) the NodeBB plugin requires a configured `id` + `secret`
anyway, and (b) we *want* static registration: one first-party client, admin-managed, exact
redirect URIs. If the provider later opens to third-party clients, supporting CIMD **as a
provider** (fetching a URL-valued `client_id`'s metadata document at authorize time) is a possible
future enhancement — worth a sentence in the provider README, not part of this design.

## 6. Phased implementation plan

| Phase | Scope                                                                                              | Deliverable                                                        |
| ----- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1     | `oauth-code` variant in `oauthFlowSchema`; `oauthclients` collection + admin seeding script; `/api/oauth/authorize` + `/api/oauth/token` (code grant only) + `/api/oauth/userinfo`; login-redirect plumbing for signed-out users; specs mirroring `forumsso.spec.ts` style. | Provider live behind the real forum's staging config.               |
| 2     | NodeBB: install `nodebb-plugin-sso-oauth2-multiple`, configure the `boardgamers` strategy, enable `trustEmailVerified`, verify linking on a preview/staging forum. | Forum logins flow through OAuth; JWT cookie still present as fallback. |
| 3     | Bake, then remove `forumsso.ts` + middleware + `token` cookie (#153 closed), disable local forum passwords. Add `refresh_token` grant if/when a client needs it. | #76 + #153 closed; cookie-sharing code deleted.                     |

Optional at any point: `/.well-known/openid-configuration` for ACP autofill; consent screen for
`trusted: false` clients; avatar/`picture` claim; OIDC back-channel logout.

## Appendix: NodeBB plugin research notes

- `nodebb-plugin-sso-oauth2` (julianlam) is superseded/unpublished; the maintained successor is
  **`nodebb-plugin-sso-oauth2-multiple`** (NodeBB org, v2.x, NodeBB ^4.14; v1.5.2 covers ^3.3/^4.x).
- Strategies stored under `oauth2-multiple:strategies:{name}`; routes `/auth/{name}` and
  `/auth/{name}/callback`.
- ACP `domain` field only *prefills* endpoints from
  `https://{domain}/.well-known/openid-configuration`; runtime is manual endpoints, no discovery,
  no JWKS, no ID-token validation.
- Strategy built on `passport-oauth2` with `{authorizationURL, tokenURL, clientID, clientSecret,
  callbackURL, passReqToCallback}` only — **no PKCE, no state option**; userinfo fetched with a
  `Bearer` header.
- Claim mapping is hardcoded: id = `idKey || id || sub`; username = `nickname ||
  preferred_username || name`; fullname = `name` or `given_name [middle_name] family_name`; plus
  `email`, `email_verified`, `picture`, `roles`. Flat keys only. id + displayName + email must all
  be truthy or login fails (`insufficient-scope`).
- Login resolution: `{name}Id:uid` lookup → email linking iff `trustEmailVerified` &&
  `email_verified` → auto-create user. Group associations from `roles`; `syncFullname`/`syncPicture`
  on each login if enabled.
