# Viewer API

The viewer is integrated in an `iframe` on the site.

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

Receive game data as [processed](./engine-api.md#toSend) by the backend.

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

### player

```ts
emitter.on("player", (playerInfo: { index: number }) => {
  // ...
});
```

Receive the player id of the currently connected player.

This event is not triggered when the user is just a spectator.

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

## Uplink

This is all the info that your viewer gives to the app.

You can send them this way:

```ts
emitter.emit("event", data);
```

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
