# Game options, preferences & settings

A game declares three kinds of configurable fields on its game info (the admin panel's game form — see
[Adding a game](./adding-a-game.md)). They share the same field shape, but serve different purposes:

| Kind          | Who sets it        | When                     | Who consumes it                                                          |
| ------------- | ------------------ | ------------------------ | ------------------------------------------------------------------------ |
| `options`     | The game's creator | At game creation         | The engine, via [`init`](./engine-api.md#init)                           |
| `preferences` | Each user          | Any time (account-level) | The viewer, via the [`preferences`](./viewer-api.md#preferences) event   |
| `settings`    | Each player        | During an active game    | The engine, via [`setPlayerSettings`](./engine-api.md#setplayersettings) |

All three are version-scoped: they live on the game info of a specific game version, so a new engine version can
expose a different set.

## Field shape

Every entry — option, preference or setting — is an object with:

```json
{
	"name": "variableMap",
	"label": "Variable map",
	"type": "select",
	"default": "standard",
	"items": [
		{ "name": "standard", "label": "Standard map" },
		{ "name": "random", "label": "Random map" }
	]
}
```

- `name` — the key the value is stored and passed under (what your engine/viewer reads).
- `label` — what the UI shows next to the input.
- `type` — one of `"checkbox"`, `"select"`, `"hidden"`, `"category"` (see below).
- `default` — optional default value: a boolean for checkboxes, an item `name` for selects.
- `items` — for `"select"` only: the list of choices, each with a `name` (the value) and a `label` (display).
- `category` — preferences only: the `name` of a `"category"` entry this preference is grouped under.

### Types

- **`checkbox`** — a boolean flag. Values are `true`/`false`; the UI pre-checks it when `default` is `true`.

  ```json
  { "name": "noAuction", "label": "Skip the auction phase", "type": "checkbox", "default": false }
  ```

- **`select`** — one choice out of `items`. When `default` is missing or not a valid item name, the **first item**
  is the effective default — order `items` accordingly.

  ```json
  {
  	"name": "map",
  	"label": "Map",
  	"type": "select",
  	"default": "classic",
  	"items": [
  		{ "name": "classic", "label": "Classic" },
  		{ "name": "lakes", "label": "Lakes" }
  	]
  }
  ```

- **`hidden`** — never rendered in the UI; the value is passed through as a JSON-stringified blob
  (`{ stringified: true, value: string }`). For advanced/machine-set preference values, not for regular options.
- **`category`** — a collapsible group heading in the preferences UI. Not a value itself: other preferences point
  at it with their `category` field.

  ```json
  { "name": "display", "label": "Display", "type": "category" },
  { "name": "flatBuildings", "label": "Flat buildings", "type": "checkbox", "category": "display" }
  ```

## Options (game creation)

The creation form renders one input per entry of `options` and sends the chosen values with the game. The server
validates them (checkboxes must be boolean, selects must be one of their item names) and stores them on the game
as `game.options`. When the game starts, the engine receives them as the third argument of
[`init(players, expansions, options, seed, creator)`](./engine-api.md#init):

```ts
// admin panel: options = [{ name: "map", type: "select", items: [...] }, { name: "noAuction", type: "checkbox" }]
// creator picked map "lakes" and ticked "noAuction" → at game start:
init(4, [], { map: "lakes", noAuction: true }, "game-seed", 0);
```

Only fields the creator changed from their implicit defaults may be present — **always read options defensively**
(`options.map ?? "classic"`), never assume a key exists.

**Player counts are not an option**: the allowed player counts are the `players` array on the game itself
(e.g. `[2, 3, 4, 5]`), set in the admin panel's main game form. The creator picks one of them at creation; the
engine gets it as `init`'s first argument.

## Preferences (per-user viewer settings)

Preferences are UI concerns: each user sets them once per game (sidebar on the game page / account page), and the
viewer receives them through the [`preferences`](./viewer-api.md#preferences) event every time it launches and
whenever they change. The engine never sees them.

```json
[
	{ "name": "flatBuildings", "label": "Flat buildings", "type": "checkbox", "default": false },
	{ "name": "planetColors", "label": "Original planet colors", "type": "checkbox", "default": true }
]
```

The platform fills in `default` values for users who never saved preferences, so the viewer can rely on declared
checkbox/select keys being present.

On top of the game's own preferences, the platform injects `devMode: true` when the user has developer settings
enabled (see [viewer-api](./viewer-api.md#devmode)), and an `alternateUI` checkbox is added automatically when the
game info defines an alternate viewer.

## Settings (per-player, in-game)

Settings are engine concerns a player can toggle while the game is running — e.g. Gaia Project's autocharge. The
game UI renders inputs from the `settings` list; on change, the game-server validates the values against the
declared types and calls the engine's [`setPlayerSettings(data, player, settings)`](./engine-api.md#setplayersettings)
with only the changed keys. The engine should expose the current values through
[`playerSettings(data, player)`](./engine-api.md#playersettings).

A setting can carry a `faction` field (`"faction": "terrans"`) to only apply to players of that faction.

```json
[
	{ "name": "autocharge", "label": "Auto-charge power", "type": "checkbox", "default": true },
	{
		"name": "autoLeech",
		"label": "Auto-leech",
		"type": "select",
		"items": [
			{ "name": "always", "label": "Always" },
			{ "name": "ask", "label": "Ask" },
			{ "name": "never", "label": "Never" }
		]
	}
]
```

Settings change game behavior, so they belong to the engine's state handling — don't confuse them with
preferences, which are pure presentation and live entirely in the viewer.
