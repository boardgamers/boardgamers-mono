# Migration plan: canonical origin `www.boardgamers.space` → apex `boardgamers.space`

**Issue:** #153 · **Status:** plan (no code changes in this PR) · **Type:** ops-heavy migration, staged, reversible

## TL;DR

Move the canonical site from `www.boardgamers.space` to the **apex** `boardgamers.space`, aligning the OIDC
issuer, the CIMD `client_id` / `redirect_uri`s, and the session-cookie scoping. The big win is cookie isolation:
once the site lives on the apex, the session cookie can become **host-only** (no `Domain` attribute), so it is no
longer sent to `forum.` / `admin.` / `resources.` / `grafana.` — none of which need it anymore.

> **Important nuance discovered while writing this plan (verify in the live vhost before cutover):** the OIDC
> issuer is configured as `https://boardgamers.space`, but **today that host 301-redirects everything — including
> `/.well-known/openid-configuration` — to `www`** (verified: `curl https://boardgamers.space/.well-known/openid-configuration`
> → `301 → https://www.boardgamers.space/.well-known/openid-configuration`). So in practice discovery resolves to
> the www-served doc. This plan makes apex serve the doc directly and flips the redirect the other way.

---

## 1. Inventory of every www ↔ apex dependency

Legend: **CHG** = must change for cutover · **OK** = already apex / host-relative, no change · **OPS** = lives outside the repo (live vhost, provider console, DNS).

### Provider (api) config & code

| Location                                              | Current                                                                                   | Verdict                                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `apps/api/app/config/env.ts:32`                       | `site: process.env.site \|\| \`www.${domain}\``→`www.boardgamers.space`                   | **CHG** — default must become the apex (`${domain}`). Drives social callbacks + emails.                         |
| `apps/api/app/config/env.ts:36`                       | `webAppUrl` prod default `https://${domain}` (apex)                                       | OK — already apex.                                                                                              |
| `apps/api/app/config/env.ts:40`                       | `oauth2.issuer` prod default `https://${domain}` (apex)                                   | OK — already apex. Keep it apex through the whole migration.                                                    |
| `apps/api/app/config/env.ts:47`                       | `trustedOauthClients` default lists `forum.` + `grafana.` CIMD URLs                       | OK — subdomains, unchanged by the move.                                                                         |
| `apps/api/app/config/passport.ts:314`                 | social `callbackURL = https://${env.site}/api/account/auth/<p>/callback`                  | **CHG** — follows `env.site`; the registered redirect at Google/Discord/Facebook consoles must match (**OPS**). |
| `apps/api/app/models/user.ts:233,249,329,330`         | emails build links as `http://${env.site}/…`                                              | **CHG** — inherits `env.site` fix; also upgrade `http://` → `https://` while here.                              |
| `apps/api/app/models/session.ts:129,135`              | cookie `Domain=env.domain` (`boardgamers.space`)                                          | **CHG** — see §3 (go host-only).                                                                                |
| `apps/api/app/app.ts:54-56`                           | `isSameSiteOrigin` treats all `*.env.domain` as same-site                                 | OK — apex is in-domain; unchanged.                                                                              |
| `apps/api/app/routes/oauth2/index.ts:349,429,448-469` | `iss` claim, userinfo `picture`, discovery doc all derive from `env.oauth2.issuer` (apex) | OK — already apex; becomes _true_ once apex serves the endpoints.                                               |
| `apps/api/app/routes/oauth2/index.ts:96,171,200`      | authorize bounces to `env.webAppUrl` (apex) for login/consent                             | OK — already apex.                                                                                              |
| `apps/api/app/services/cimd.ts`                       | CIMD fetch/validate (SSRF-pinned); §5 no-redirect                                         | OK — generic; relevant to §2 ordering.                                                                          |

### Web app (SvelteKit)

| Location                                                                | Current                                                                                          | Verdict                                                                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `apps/web/src/routes/.well-known/openid-configuration/+server.ts:24-27` | issuer = `oauth2Issuer` \|\| `https://${domain}` (apex)                                          | OK — already apex; just needs apex to actually serve it (§2).                                               |
| `apps/web/src/routes/.well-known/oauth-cimd/+server.ts:20`              | HF client_id = `${url.origin}/.well-known/oauth-cimd` (request origin)                           | OK — host-relative; follows whatever host serves it.                                                        |
| `apps/web/src/routes/+layout.svelte:30,36,38`                           | canonical / `og:url` / `og:image` use `page.url.origin`                                          | OK — host-relative; emit apex once apex serves.                                                             |
| `apps/web/src/routes/robots.txt:26`, `sitemap.xml`                      | use request origin                                                                               | OK.                                                                                                         |
| `apps/web/src/lib/auth.server.ts:66-78`                                 | `forwardSessionCookies` forwards API `Domain` only if it covers the request host, else host-only | **CHG** — once API drops `Domain`, this forwards host-only (correct). No code change needed, but re-verify. |
| `apps/web/src/hooks.server.ts:125-128`                                  | forwards `cookie` to the main API only (never game-server)                                       | OK.                                                                                                         |
| `apps/web/src/components/Game/StartedGame.svelte:34`                    | `host.endsWith("boardgamers.space")` → `/resources` path                                         | OK — apex ends with it.                                                                                     |
| `apps/web/src/components/Layout/Appbar.svelte:91-100`                   | admin link derives `admin.<root>` from current host                                              | OK — host-relative.                                                                                         |
| `apps/web/src/components/OG/OGCard.svelte:220`                          | literal text `boardgamers.space`                                                                 | OK — already apex.                                                                                          |
| `apps/web/README.md:10`, `README.md:36`                                 | dev docs say `VITE_backend=https://www.boardgamers.space`                                        | **CHG** (docs) — point at apex.                                                                             |

### Admin (SPA)

| Location                                        | Current                                         | Verdict                     |
| ----------------------------------------------- | ----------------------------------------------- | --------------------------- |
| `apps/admin/src/lib/utils.ts:26-35` (`webHost`) | `admin.boardgamers.space → //boardgamers.space` | OK — already resolves apex. |

### Forum SSO plugin (`packages/nodebb-plugin-sso-bgs`)

| Location                                     | Current                                                                                                | Verdict                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `static/client-metadata.json:2,4`            | `client_id` = `https://forum.boardgamers.space/client-metadata.json`; `redirect_uris` = forum callback | OK — forum host unchanged by the apex move.                                            |
| `library.js` (`callbackURL`, ~396, 495, 618) | `nconf url + /auth/boardgamers/callback`                                                               | OK — forum origin.                                                                     |
| `README.md:158-160`                          | `authUrl`/`tokenUrl`/`userRoute` = `https://www.boardgamers.space/api/oauth2/*`                        | **CHG** — these are the **live strategy endpoints**; flip to apex in lockstep with §2. |
| `test/harness.cjs:652-655`                   | www OAuth endpoints                                                                                    | **CHG** (tests) — apex.                                                                |

### Grafana / Loki (`infra/loki`)

| Location                                 | Current                                                                                     | Verdict                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `infra/loki/docker-compose.yml:75-77`    | `GF_AUTH_GENERIC_OAUTH_{AUTH,TOKEN,API}_URL` = `https://www.boardgamers.space/api/oauth2/*` | **CHG** — flip to apex; needs `podman-compose up -d --force-recreate grafana` (**OPS**). |
| `infra/loki/docker-compose.yml:66,69`    | `GF_SERVER_ROOT_URL` + `CLIENT_ID` = `grafana.boardgamers.space/...`                        | OK — grafana host unchanged.                                                             |
| `infra/loki/grafana.boardgamers.space:9` | CIMD doc `client_id`/`redirect_uris` = grafana host                                         | OK.                                                                                      |

### Infra / routing

| Location                                          | Current                                                                                                   | Verdict                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Live nginx vhost (on coyo, **not fully in repo**) | apex **301 → www** for **all** paths incl. `/.well-known/*`                                               | **OPS/CHG** — must flip to www 301 → apex, and make apex serve the app.      |
| `apps/api/app/config/nginx:32`                    | `server_name www.boardgamers.space` (legacy/illustrative)                                                 | **CHG** (doc hygiene) — reflect apex.                                        |
| `infra/README.md:73`                              | "`boardgamers.space` / `www.boardgamers.space` → SvelteKit SSR"                                           | OK — both already route to SSR; only the redirect direction changes.         |
| `infra/pr-preview/*`                              | `pr-<n>.boardgamers.space`, `domain=pr-<n>.boardgamers.space`, host-only cookie via `proxy_cookie_domain` | OK — previews are independent of the apex/www canonical question; unchanged. |
| `.github/workflows/pr-preview.yml`                | builds `https://pr-<n>.boardgamers.space` URLs                                                            | OK.                                                                          |

### Docs / misc

| Location                                                               | Verdict                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------- |
| `apps/docs/README.md`, `apps/docs/docs/README.md`                      | OK — already apex.                                      |
| `Footer.svelte:9,12` (forum link, `contact@`)                          | OK — subdomain/mailto.                                  |
| `apps/api/.env.example:38` (`#oauth2Issuer=https://boardgamers.space`) | OK.                                                     |
| `apps/api/scripts/lib/fetch-gameinfos.ts:9` (`SEED_SOURCE=www…/api`)   | **CHG** (dev-only default) — apex; harmless either way. |
| csrf/session specs referencing `www.boardgamers.space`                 | **CHG** (tests) — update expectations to apex.          |

---

## 2. OIDC issuer alignment

### Today

- `env.oauth2.issuer = https://boardgamers.space` (apex) → the discovery doc's `issuer`,
  `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`, and every id_token `iss` claim are **apex**.
- But the site (and `/api/oauth2/*`) is **served on `www`**, and apex 301s everything to www — so the apex URLs
  in the doc only work by following the redirect.

### What breaks if issuer and the actually-served endpoints diverge

1. **Discovery** (OIDC Discovery §4): a relying party fetches `{issuer}/.well-known/openid-configuration` and
   requires `issuer` in the doc to **string-equal** the issuer it started from. Our own CIMD client
   (`cimd.ts`) **does not follow redirects** (§5). Any conforming RP hitting `https://boardgamers.space/.well-known/…`
   and getting a 301 fails or — worse — silently accepts the www doc. Today it "works" only because NodeBB's and
   Grafana's plugins are configured with explicit www `authUrl`/`tokenUrl` and never do discovery.
2. **`iss` claim validation**: id_tokens carry `iss=https://boardgamers.space`. A strict RP validates `iss`
   against its configured issuer. NodeBB/Grafana validate the **access token** at `userinfo`, not `iss`, so they
   don't trip on it — but any future conforming OIDC RP would.
3. **CIMD validation**: the forum/Grafana `client_id` URLs are on `forum.`/`grafana.` (unaffected). What _is_
   affected is the **`iss`/endpoint base** those clients are pointed at — it must be apex after cutover, and the
   doc served at apex must be self-consistent.

### Cutover rule for §2

**The issuer value never changes** (`https://boardgamers.space` before, during, after). What changes is **which
host actually serves** `/.well-known/openid-configuration` and `/api/oauth2/*`. So the sequence is: make apex
serve them (Step B) _before_ flipping the redirect (Step C) and _before_ repointing forum/Grafana (Step D). That
way there is no window where the issuer's doc doesn't resolve at the issuer.

---

## 3. Cookie handling

### (a) Decision: host-only session cookie on apex

Move to **host-only** (drop the `Domain` attribute) on the apex host.

- `session.ts:129` today: `domain: local ? undefined : env.domain`. After the move the request host **is**
  `env.domain` (apex), so a host-only cookie (`domain: undefined` whenever `ctx.hostname === env.domain`) is
  correct and maximally tight.
- `clearRefreshCookie` (135) and the Domain-clear half of `clearAllRefreshCookieVariants` must mirror this.
- **Why not keep `Domain=boardgamers.space`?** On apex that attribute is _redundant_ for the apex host but
  **additionally broadcasts** the cookie to every subdomain. Host-only avoids that.

### (b) Clear-both-variants logic at cutover (avoid the shadow lockout)

`WORKAROUNDS.md` documents the lockout: a **host-only** cookie sorts first in the `Cookie` header and **shadows**
a `Domain=` cookie, so the browser keeps presenting the stale one and the user can't log in
(`clearAllRefreshCookieVariants` in `session.ts:144` exists for exactly this).

At cutover the risky residue is any cookie scoped to the **old www host** (host-only or `Domain=www.boardgamers.space`)
or a stale apex cookie. Because `Domain=boardgamers.space` cookies are sent to **both** www and apex, a user
carrying one will keep sending the old cookie to apex after the flip.

**Required clearing logic** — on the apex host, whenever the session middleware sees a refresh code that's no
longer valid, clear **all** variants that could exist on apex:

```
clear(SESSION_COOKIE, { domain: "boardgamers.space" })   // Domain=apex cookie (today's prod cookie)
clear(SESSION_COOKIE, {})                                // host-only apex cookie (new scheme + any legacy)
```

`clearAllRefreshCookieVariants` already does both against `env.domain` + host-only, so it is **already correct**
for the apex cutover — the key is to **keep it wired** in `app.ts` (dead-session path) and **not** reduce it back
to `clearRefreshCookie` until well past the migration (extend the WORKAROUNDS entry's TTL to cover both the
pre-#112 host-only cookies _and_ the migration overlap). Deletion must use the **same `Domain` value** that set
each variant or the browser ignores it — which is why both lines above are needed.

### (c) Stop sending the cookie to subdomains

With host-only apex cookies, `refreshToken` is **no longer sent** to `forum.`/`admin.`/`resources.`/`grafana.`:

- **Forum**: now uses OAuth/OIDC (authorization-code + PKCE) — it does **not** need the site session cookie.
  (The old NodeBB `token` SSO cookie is a separate mechanism; the silent-SSO path in #254 works via `prompt=none`
  against the provider, which _does_ need the user to be logged in on the **site** — that session is on apex and
  stays there. Fine.)
- **Game-server / viewers**: authenticate with minted `gameplay`-scoped **bearer** tokens, never the cookie
  (`hooks.server.ts` already refuses to forward the cookie to the game-server).
- **Admin**: uses bearer tokens in localStorage, not the cookie.

This directly answers issue #153's question 2 and satisfies the defense-in-depth goal: a compromised
viewer/forum/admin subdomain can no longer ambiently receive the session cookie.

---

## 4. Cutover sequence + rollback

Order matters: **the issuer value never changes**, so we move _serving_ to apex first, then flip the redirect,
then repoint clients, then tighten cookies. Each step lists what to verify. **[OPS]** = manual, outside the repo.

### Step 0 — prep **[OPS]**

- Confirm the live nginx vhost layout on coyo (repo `apps/api/app/config/nginx` is legacy). Ensure there's a TLS
  cert covering **apex** (there is — apex already answers 443) and that apex can route `/`, `/api`, `/ws`,
  `/resources`, `/.well-known/*` to the SSR/api exactly as www does today.
- Lower TTLs on `boardgamers.space` / `www` A/AAAA records if the flip is DNS-mediated.
- **Stage the social-OAuth redirect updates** (Google / Discord / Facebook consoles): add the **apex** callback
  `https://boardgamers.space/api/account/auth/<provider>/callback` as an _additional_ authorized redirect URI now
  (consoles allow multiple), keeping the www one until after cutover. **[OPS — provider consoles]**

### Step 1 — code (this repo, behind no flag)

- `env.site` default → apex (`${domain}`); fix the `http://` → `https://` email links that key off it.
- `session.ts`: emit host-only cookie when `ctx.hostname === env.domain`; keep `clearAllRefreshCookieVariants`.
- Update tests + dev docs (`README.md`, `apps/web/README.md`, `fetch-gameinfos.ts`, csrf/session specs).
- Deploy. **Nothing user-visible changes yet** (www still canonical; `env.site` change only affects _new_ social
  callback URLs + emails, which now point at apex — apex still 301s to www, so they keep working).
- **Verify:** CI green; login/logout still work on www; social login still works (www callback still registered).

### Step 2 — make apex serve OIDC **[OPS — nginx]**

- Add an nginx block so `https://boardgamers.space/.well-known/openid-configuration` and
  `https://boardgamers.space/api/*` are served by the app (SSR/api) **without** redirecting, while other apex
  paths may still 301 → www for now.
- **Verify:** `curl https://boardgamers.space/.well-known/openid-configuration` → **200** and
  `issuer == "https://boardgamers.space"`; `authorization_endpoint` etc. are apex. `curl https://boardgamers.space/api/oauth2/.well-known/openid-configuration` → 200.

### Step 3 — flip the redirect www ↔ apex **[OPS — nginx/DNS]**

- Serve the full app on apex; make **www 301 → apex** (path-preserving).
- **Verify:** `curl -I https://www.boardgamers.space/anything` → `301 → https://boardgamers.space/anything`;
  apex serves `/`, `/api`, `/ws`; OG/canonical/sitemap emit apex; login sets a **host-only** cookie on apex.

### Step 4 — repoint OIDC clients to apex **[OPS]**

- **Forum (NodeBB)**: update the SSO strategy `authUrl`/`tokenUrl`/`userRoute` from `www.` → apex. The forum's
  `client_id` / `redirect_uri` (forum host) are unchanged, so this is endpoint-only. Reload NodeBB.
- **Grafana**: set `GF_AUTH_GENERIC_OAUTH_{AUTH,TOKEN,API}_URL` to apex; `podman-compose up -d --force-recreate
--no-deps grafana`.
- **Verify:** forum login (incl. silent `prompt=none`), Grafana "Boardgamers" login → admin gets GrafanaAdmin,
  non-admin denied. **Existing logged-in forum/Grafana sessions keep working** (their tokens were minted by the
  provider and don't depend on the www endpoint after issuance).

### Step 5 — cookie tightening observation

- With apex host-only cookies live, watch for "can't log in" reports (shadow-cookie lockout). The dead-session
  clearing should self-heal, but if a specific browser is stuck, the manual fix is clearing `boardgamers.space`
  cookies.
- **Verify:** `secure-cookie-over-insecure` diagnostic rate unchanged; no spike in login failures.

### Rollback

- **Steps 4–3** (client repoint, redirect flip): revert the nginx change (www canonical again, apex 301 → www)
  and revert the forum/Grafana endpoint edits. Because the issuer value never changed, discovery/`iss` stay
  consistent on rollback.
- **Step 2**: remove the apex-serve block (apex 301s everything again).
- **Step 1**: revert the `env.site` default (or set `site=www.boardgamers.space` in the prod env to override
  without a deploy); social callbacks fall back to the www redirect URI (which we **kept** registered, so social
  login survives a rollback).
- Rollback is safe at every step because issuer/CIMD/client_id values are unchanged throughout — only _serving
  host_ and _redirect direction_ move.

---

## 5. Risks

| Risk                                                                               | Impact                            | Mitigation                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Social OAuth redirect_uri mismatch** (Google/Discord/Facebook registered to www) | social login 400s                 | **[OPS]** register the apex callback **before** the `env.site` flip and keep the www one until after; rollback = re-point `site`. Highest ops-touch risk.                                    |
| **Stale-cookie shadow lockout** on apex (old `Domain=` cookie vs new host-only)    | some users can't log in           | keep `clearAllRefreshCookieVariants` wired (clear both variants); extend WORKAROUNDS TTL; monitor login failures post-flip.                                                                  |
| **`iss` claim on in-flight id_tokens**                                             | none for our clients              | issuer value is unchanged (`https://boardgamers.space`), so minted `iss` stays valid; NodeBB/Grafana validate access tokens, not `iss`.                                                      |
| **Existing refresh tokens / sessions**                                             | logged-out only if cookie lost    | sessions live server-side in `jwtrefreshtokens`; the `Domain=boardgamers.space` cookie is still sent to apex, so users stay logged in. New host-only cookie replaces it on next slide/login. |
| **Discovery doc cached `public, max-age=3600`**                                    | stale doc ≤1h                     | re-point clients after the apex doc is live; the doc content doesn't change (issuer was already apex), so caching is benign.                                                                 |
| **SEO / canonical**                                                                | duplicate-content / ranking churn | canonical/og:url/sitemap are host-relative → emit apex automatically once apex serves; the www→apex 301 passes link equity. No code change, but expect a re-crawl window.                    |
| **Hardcoded www links**                                                            | broken/mismatched links           | emails (`env.site`), READMEs, seed default, tests — all in the inventory above. Footer/OGCard already apex.                                                                                  |
| **pr-preview envs**                                                                | none                              | previews use `pr-<n>` hosts + host-only cookies via `proxy_cookie_domain`; independent of the canonical-host question.                                                                       |
| **Live vhost not fully in repo**                                                   | drift between plan and reality    | **Pre-cutover action:** confirm the real coyo vhost (repo `apps/api/app/config/nginx` is legacy) before Step 2.                                                                              |

---

## Manual ops checklist (nothing here is deployable code)

- [ ] Confirm live nginx vhost on coyo; ensure apex TLS + routing parity with www.
- [ ] Register apex social-OAuth redirect URIs (Google, Discord, Facebook consoles) — keep www ones until after.
- [ ] (Optional) lower DNS TTLs ahead of the flip.
- [ ] Step 2 nginx edit + `nginx -t && systemctl reload nginx`.
- [ ] Step 3 redirect flip + reload.
- [ ] Step 4: NodeBB SSO strategy endpoint edit + reload; Grafana `GF_*` env + `podman-compose up -d --force-recreate grafana`.
- [ ] Post-cutover: remove the www social redirect URIs from provider consoles.
- [ ] Extend the `clearAllRefreshCookieVariants` WORKAROUNDS TTL to cover the migration window.
