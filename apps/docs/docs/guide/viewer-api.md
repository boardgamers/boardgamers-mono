# Viewer API

The viewer is integrated in an `iframe` on the site.

To host the viewer — a CDN/npm URL or an uploaded pre-built bundle — see [Adding a game](./adding-a-game.md).

It needs to export a object with a `launch` function in the global namespace, which returns an `EventEmitter` used
to communicate with our application.

```ts
window.viewer = {
	// Place the viewer inside the element designated by the selector
	launch(selector) {
		const emitter = new EventEmitter();

		// ....

		return emitter;
	},
};
```

This is a two-way communication. The emitter can emit events to be consumed by our applications, and can receive events to process.

**Payloads must be plain JSON-serializable values** — both ways. The app relays every event between the iframe
and itself with `window.postMessage`, whose structured-clone algorithm throws on anything it can't clone (class
instances, functions, `Map`/`Set`, and reactive proxies). In particular, don't emit a Svelte 5 `$state` proxy
directly — it fails with `Proxy object could not be cloned`. Snapshot reactive state first:
`$state.snapshot(value)` or `JSON.parse(JSON.stringify(value))`.

The application can also load additional javascript and css files if needed.

[[toc]]

## Downlink

This is the events the application passes to the viewer. You can receive them this way:

```ts
emitter.on("event", (arg) => {
	// Handle downlink event
});
```

### state

```ts
emitter.on("state", (state: GameData) => {
	// ...
});
```

Receive game data as [processed](./engine-api.md#tosave) by the backend.

This replaces the current game state with a new one, you should completely overwrite the previous game state.

### state:updated

```ts
emitter.on("state:updated", () => {
	// ...
});
```

Notification that new state is available.

You can request the full state by emitting [fetchState](#fetchstate) or request the new log elements by emitting [fetchLog](#fetchlog).

### gamelog

```ts
emitter.on("gamelog", (logData: { start: number; end?: number; data: any }) => {
	//...
});
```

Receive log data.

`data` is the return value of the backend's [logSlice](./engine-api.md#logslice).

### preferences

```ts
emitter.on("preferences", (preferences: { [key: string]: any }) => {
	//...
});
```

Get the user's specific UI preferences for this game.

For example, for Gaia Project, there are two UI preferences: whether to use flat buildings, and whether to keep the original color for the planets.

#### devMode

On top of the game's own preferences, the platform injects a `devMode: true` key when the user has developer
settings enabled on their device. When developer settings are off, the key is entirely absent — check
`preferences.devMode === true`.

### player

```ts
emitter.on("player", (playerInfo: { index: number }) => {
	// ...
});
```

Receive the player id of the currently connected player.

This event is not triggered when the user is just a spectator.

### avatars

```ts
emitter.on("avatars", (avatars: string[]) => {
	// ...
});
```

Receive the avatars of each player, in order.

### replay:start

```ts
emitter.on("replay:start", () => {
	// ...
});
```

Start replay mode. Only for compatible viewers.

When entering replay mode, you should emit the [replay:info](#replay-info) event with the necessary info.

### replay:to

```ts
emitter.on("replay:to", (logIndex: number) => {
	// ...
});
```

Replay up to that point in the log.

### replay:end

```ts
emitter.on("replay:end", () => {
	//...
});
```

Leave replay mode

### theme

```ts
window.addEventListener("message", (event) => {
	if (event.data.type === "theme") {
		// event.data.dark is a boolean
	}
});
```

Receive the site's current color theme: `{ type: "theme", dark: boolean }`.

Unlike the events above, this one is **not** re-emitted on the emitter — it is a raw `postMessage` from the site,
handled directly by the iframe page. It is sent when the game is ready and every time the theme changes afterwards,
including when the OS theme flips while the user's setting is "system".

The viewer must apply the theme live, **without reloading the iframe** — never swap the iframe `src` to change the
theme, a `src` change reloads it and loses the game state.

See [Dark mode](#dark-mode).

## Uplink

This is all the info that your viewer gives to the app.

You can send them this way:

```ts
emitter.emit("event", data);
```

### ready

```ts
emitter.emit("ready");
```

The DOM is ready, and the game can be shown to the player.

### move

```ts
emitter.emit('move', move: any);
```

Send a move to the backend.

`move` is passed as is to the backend's [move](./engine-api.md#move) exported method.

### player:clicked

```ts
emitter.emit("player:clicked", { index: number });
```

Signals that a player's name was clicked, so that the application can go to the player's profile.

This even is completely optional.

### fetchState

```ts
emitter.emit("fetchState");
```

Requests the current game state passed to us, in full.

The application will fetch the current game state, and pass it to the viewer with a [state](#state) event.

### fetchLog

```ts
emitter.emit('fetchLog', options: {start: number, end?: number});
```

Requests the log between `start` and `end` included.

The application will fetch the data and will pass it to the viewer with a [gamelog](#gamelog) event.

### addLog

```ts
emitter.emit('addLog', log: string[]);
```

Transmits new log elements to the application, to be displayed in the sidebar.

### replaceLog

```ts
emitter.emit('replaceLog', log: string[]);
```

Erases current log and transmits new log elements to the application, to be displayed in the sidebar.

### replay:info

```ts
emitter.emit('replay:info', data: {start: number, current: number, end: number})
```

Emitted when the replay starts and everytime we move in the replay.

Used for the replay controls in the sidebar.

### update:preference

When you want to edit preferences within the game itself and not BGS' sidebar

```ts
emitter.emit('update:preference', data: {name: string, value: string | boolean | null})
```

## Dark mode

The site supports a light/dark theme, switchable by the user or following the OS ("system"). Viewers served through
the API's wrapper page get dark mode support out of the box:

- The wrapper reads the `?dark=1` URL parameter for the initial paint and sets a `dark` class on `<html>` (no flash
  of light theme).
- It injects a dark stylesheet (`darkStylesheet`) that re-themes the page chrome — background, default text,
  Bootstrap-ish tables, modals and forms. It only targets classless elements and only uses inherited properties,
  so your viewer's own styling always wins (e.g. bare SVG text is filled with the light `currentColor`, but an
  explicit `fill` — attribute, inline style or CSS class — is left alone).
- It listens for the [theme](#theme) message and toggles the `dark` class on `<html>` when the site theme changes.

To support dark mode in your viewer: read the initial state from `?dark=1` (or the `<html class="dark">` the wrapper
already set) for the first paint, then listen for the [theme](#theme) message for live changes. Style your components
under a `.dark` root class so they follow the toggle, and scope any overrides so they take precedence over the
generic wrapper stylesheet.
