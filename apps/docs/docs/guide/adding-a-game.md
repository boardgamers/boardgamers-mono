# Adding a game to Boardgamers

Once you have an [engine](./engine-api.md) and a [viewer](./viewer-api.md) (see the [tictactoe tutorial](./tictactoe.md) to build them), an admin registers the game on the platform.

## 1. Register the game

In the admin panel, **Boardgames → + New game**: set the game id + version, label, player counts, and any game options/preferences/settings — see [Game options, preferences & settings](./game-options.md) for the field shapes. Save.

## 2. Viewer

Either:

- point **URL** at the bundled viewer on a CDN (e.g. `//cdn.jsdelivr.net/npm/<game>-viewer@<version>/dist/viewer.umd.js`) plus any dependency scripts/stylesheets, or
- **Upload bundle…**: pick the pre-built viewer `.js` (plus optional extra `.js`/`.css`/`.map`) — the files are stored on S3 and the URL/dependencies are filled in for you. Save afterwards.

The viewer bundle must be self-contained (already bundled by the game's own build).

**Sourcemaps.** An optional `.map` is hosted purely for browser devtools — nothing references it server-side. By default each uploaded file is content-hashed into its **own** S3 directory, so a relative `//# sourceMappingURL=viewer.js.map` in the JS won't resolve (the map sits in a different hash directory). To make devtools find the map, upload the `.js` and `.map` with a shared `?bundle=<id>` query param (`POST /api/admin/gameinfo/:game/:version/viewer/file?filename=…&bundle=<id>`) — files with the same bundle id share a directory, so a relative `sourceMappingURL` resolves. Use a fresh bundle id per build. (The admin **Upload bundle…** picker does this automatically for the files you select together.)

## 3. Engine

Either:

- fill in **Package name** + **Package version** (an npm package the game-server installs from the registry), or
- **Upload .tgz…**: pick a pre-built [`npm pack`](https://docs.npmjs.com/cli/commands/npm-pack) tarball (with `dist/` included) — it's stored on S3, and the game-server installs it from the hosted URL instead of the registry. Its runtime `dependencies` are still resolved from npm at install time.

The tarball must contain the built engine — the platform does **not** build game source.

## 4. Play

Open the game page, create a game, and play. Bumping the engine version (or re-uploading a bundle) makes new games use the new code; ongoing games follow the engine package of the game version they were created on — see [hot-swapping](#hot-swapping-ongoing-games) below.

Registering a game is an admin action — to get your game added to the site, reach out via [Contact](mailto:contact@boardgamers.space) (or the [Forum](https://forum.boardgamers.space)) — the links in the site footer.

## Publishing from the command line (admin tokens)

Everything the panel flow above does can be scripted against the admin API — handy for CI or release scripts. You need an **admin token**: a platform admin creates one in the admin panel (**Admin Tokens** page, or `POST /api/admin/tokens` with `{ name, ttlDays? }` from their session) and hands you the raw value, shown once at creation. Raw tokens carry a `bgs_admin_` prefix, only authenticate under `/api/admin/*`, expire (default 30 days, max 90), can be revoked, and stop working if the owner loses admin rights. For these endpoints the owner needs the `gameinfo` grant (or a per-game `gameinfo:<game>` grant).

Send the token as a bearer header. On production the admin API is reachable at `https://admin.boardgamers.space/api`:

```bash
export BGS_ADMIN_TOKEN=…   # bgs_admin_…, from a platform admin
API=https://admin.boardgamers.space/api
AUTH="Authorization: Bearer $BGS_ADMIN_TOKEN"
```

### List versions / fetch a version

```bash
curl "$API/admin/gameinfo/tictactoe/versions" -H "$AUTH"
# → [{ "version": 2, "archived": false }, { "version": 1, "archived": false }]

curl "$API/admin/gameinfo/tictactoe/1" -H "$AUTH"
# → the full version doc (engine, viewer, options, …)
```

### Upload an engine

The command-line equivalent of **Upload .tgz…**: `POST` the raw [`npm pack`](https://docs.npmjs.com/cli/commands/npm-pack) tarball (max 50 MB). The server reads the package name/version from `package/package.json` inside the tarball, hosts the file on S3, and immediately sets `engine.package = { name, version, url }` on the version doc — no follow-up save needed. The version doc must already exist (404 otherwise — register the game first).

```bash
npm pack   # → tictactoe-engine-1.2.3.tgz
curl -X POST "$API/admin/gameinfo/tictactoe/1/engine" \
	-H "$AUTH" -H "Content-Type: application/octet-stream" \
	--data-binary @tictactoe-engine-1.2.3.tgz
```

### Upload viewer files

The command-line equivalent of **Upload bundle…**: one `POST` per file (`.js`, `.css` or `.map`, max 25 MB each). Each call returns the hosted URL but **persists nothing by itself** — you then save the URLs into the version doc (next step). Add `&alternate=1` to target the alternate viewer, and a shared `&bundle=<id>` on the `.js` + `.map` uploads so a relative `sourceMappingURL` resolves (see [step 2](#2-viewer)).

```bash
JS_URL=$(curl -X POST "$API/admin/gameinfo/tictactoe/1/viewer/file?filename=viewer.umd.js" \
	-H "$AUTH" -H "Content-Type: application/octet-stream" \
	--data-binary @dist/viewer.umd.js | jq -r .url)

CSS_URL=$(curl -X POST "$API/admin/gameinfo/tictactoe/1/viewer/file?filename=viewer.css" \
	-H "$AUTH" -H "Content-Type: application/octet-stream" \
	--data-binary @dist/viewer.css | jq -r .url)
```

### Save the version doc

`PUT` (or `POST`) `/:game/:version` upserts the version doc. The body is loose: fetch the current doc, update the fields you care about, and send it back — game-level metadata fields (label, description, players, …) are split off into the game's metadata doc server-side, and server-managed fields (`meta.archived`, `meta.bots`, timestamps) are protected, so round-tripping the GET response is safe.

```bash
curl "$API/admin/gameinfo/tictactoe/1" -H "$AUTH" |
	jq --arg js "$JS_URL" --arg css "$CSS_URL" \
		'.viewer.url = $js | .viewer.dependencies.stylesheets = [$css]' |
	curl -X PUT "$API/admin/gameinfo/tictactoe/1" \
		-H "$AUTH" -H "Content-Type: application/json" --data-binary @-
```

### Hot-swapping ongoing games

Ongoing games are pinned to the game **version integer**, but resolve the **engine package** through that version's doc. The game-server checks for engine changes about once a minute, installs any new package under a fresh path, and refreshes its in-memory engine cache — so re-uploading the engine tarball (or bumping `engine.package.version` via a `PUT`) upgrades ongoing games on that version within ~60 seconds. Creating a **new version integer** instead only affects newly created games: ongoing games stay on the old version's code forever.
