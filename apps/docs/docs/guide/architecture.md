# Architecture

Here is the architecture of the BGS platform. It is just here to provide a look at the environment your game will be running in.

![Architecture](/guide/architecture.png)

Your game engine will be loaded through NPM, and a CDN will be used to load the UI of your game - inside a sandboxed iframe - to be served to the players.

We believe in separation - for the engine to be independent from the UI. That doesn't mean that they can't be in one module, but the engine should be usable and be interactable with regardless of an UI being present or not.

## The pieces your game runs in

Four services make up the platform:

- **web** — the SvelteKit frontend players use: lobby, game pages, account settings. It embeds your viewer in a
  sandboxed `<iframe>` on the game page and talks to it over `postMessage` (the
  [viewer API](./viewer-api.md) events).
- **api** — a Koa + MongoDB REST API. It owns accounts, game creation and listings, the lobby, notifications,
  Elo/karma, and serves the wrapper page your viewer's bundle is loaded into (from a CDN/npm URL or an
  S3-uploaded bundle — see [Adding a game](./adding-a-game.md)).
- **game-server** — the engine runner. It loads your engine package and calls its methods to start games, apply
  moves, slice logs, auto-play [bot](./bots.md) turns and process drops. It also owns the game
  [clocks](./timing.md).
- **MongoDB** — the shared store: game state (`game.data`, whatever your engine returns from `init`/`move`, kept
  as JSON), game infos, users, notifications.

## How engines are loaded and run

Engines are ordinary npm packages. The game-server installs each registered game version into an isolated
`games/` folder — either from the npm registry (`name@version`) or from an `npm pack` tarball an admin uploaded
(stored on S3, installed by URL). Each engine version gets its own install path, so publishing a new version
**hot-loads** it: new games run the new code with no restart, while ongoing games keep their original version
forever.

Engines are third-party code, so calls into them are contained:

- `move` (and `moveAI`) run in a dedicated **`worker_thread` with a hard 10-second timeout**. A wedged engine —
  even a synchronous infinite loop — is terminated from outside and can't take the game-server down with it.
  **Keep `move` and available-moves computation fast**: moves normally take milliseconds, and a call that hits
  the timeout fails the player's move with an error.
- Your `GameData` must stay **JSON-safe** (plain objects, arrays, strings, numbers, booleans, null — no
  `Map`/`Set`/class instances/EventEmitters/BSON types). The worker thread runs every engine result through a
  `JSON.parse(JSON.stringify(...))` round-trip before handing it back (some engines return live class instances
  that structured clone would reject), and the game-server persists game data as JSON after every move — so
  anything that doesn't survive JSON serialization is lost in both places.

## How the viewer is served

The viewer is a pre-built JS bundle — the platform does not build game source. It's either fetched from a CDN
(e.g. jsDelivr serving your npm package) or uploaded by an admin and served from S3. The api wraps it in a small
page (handling script/style dependencies and [dark mode](./viewer-api.md#dark-mode)) that the web app iframes
with a restrictive `sandbox` attribute. All viewer ↔ platform communication goes through the
[viewer API](./viewer-api.md) event bridge — the viewer never talks to the api or game-server directly.

## How a move flows

1. The viewer emits `move`; the web app forwards it to the game-server.
2. The game-server loads the game's engine version, calls `move(data, move, player)` in the worker thread, then
   `toSave`, `logSlice`, `scores`, `currentPlayer`… If `toSave` returns a state, it is stored in the database;
   if it returns nothing (a partial/tentative move), nothing is persisted and the result only goes back to the
   acting player's viewer.
3. Clocks are updated — the `timePerMove` increment is granted only when the state was saved — notifications
   (and [bot](./bots.md) auto-play) are scheduled, and the api pushes the update to every connected client over
   websocket.
4. Each viewer receives `state:updated`, fetches the new state/log, and re-renders.
