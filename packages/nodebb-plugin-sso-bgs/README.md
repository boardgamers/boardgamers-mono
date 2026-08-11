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
   passport-oauth2's session store), wired **before** the stock plugin's own
   (priority 4 vs default 10), so the PKCE strategy handles `/auth/boardgamers` while
   the stock plugin still renders the login button and admin page;
2. replaces the token exchange so **no `client_secret` key is sent at all**;
3. delegates profile parsing and login/account-linking to the stock plugin
   (`getUserProfile` → `parseUserReturn` → `OAuth.login`);
4. serves the Client ID Metadata Document (`static/client-metadata.json`) at
   **`/client-metadata.json`** — the exact URL used as `client_id`, so the plugin is
   self-contained (no nginx change needed).

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
| `scope`              | `openid profile email`                                   |
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

## Notes / limitations

- Users **without an email** on their BGS account (email-less social signups, #211)
  cannot log in via OAuth: userinfo omits `email`/`email_verified` for them and the
  strategy requires id + displayName + email. They must add an email to their BGS
  account first.
- PKCE/state use the forum's session store (`req.session`), which NodeBB always
  provides — no extra middleware needed.
