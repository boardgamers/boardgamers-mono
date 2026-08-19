# Adding a game to Boardgamers

Once you have an [engine](./engine-api.md) and a [viewer](./viewer-api.md) (see the [tictactoe tutorial](./tictactoe.md) to build them), an admin registers the game on the platform.

## 1. Register the game

In the admin panel, **Boardgames → + New game**: set the game id + version, label, player counts, and any game options/preferences/settings — see [Game options, preferences & settings](./game-options.md) for the field shapes. Save.

## 2. Viewer

Either:

- point **URL** at the bundled viewer on a CDN (e.g. `//cdn.jsdelivr.net/npm/<game>-viewer@<version>/dist/viewer.umd.js`) plus any dependency scripts/stylesheets, or
- **Upload bundle…**: pick the pre-built viewer `.js` (plus optional extra `.js`/`.css`) — the files are stored on S3 and the URL/dependencies are filled in for you. Save afterwards.

The viewer bundle must be self-contained (already bundled by the game's own build).

## 3. Engine

Either:

- fill in **Package name** + **Package version** (an npm package the game-server installs from the registry), or
- **Upload .tgz…**: pick a pre-built [`npm pack`](https://docs.npmjs.com/cli/commands/npm-pack) tarball (with `dist/` included) — it's stored on S3, and the game-server installs it from the hosted URL instead of the registry. Its runtime `dependencies` are still resolved from npm at install time.

The tarball must contain the built engine — the platform does **not** build game source.

## 4. Play

Open the game page, create a game, and play. Bumping the engine version (or re-uploading a bundle) makes new games use the new code; ongoing games are unaffected.

Registering a game is an admin action — to get your game added to the site, reach out via the **Contact** (or **Forum**) link in the site footer.
