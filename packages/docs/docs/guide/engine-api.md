# Game engine API

Your game engine should be a NPM module and export a number of methods.

Most of the methods return `GameData`, the game state. You can alter the `GameData`
passed in the argument and return, or return a whole new object.

[[toc]]

## Required methods

### init

```ts
init (players: number, expansions: string[], options: any, seed: string, creator?: number): Promise<GameData>
```

Creates the initial game data. The function can be asynchronous - if you need to make an API call to an external
tool like a map generator, for example.

After initialization, the players are 0-indexed: a 4 player games will have players `0`, `1`, `2` and `3`.

`creator` is the index of the player that created the game. It can be `undefined` if the creator of the game is not a player.

#### players

The number of players

#### expansions

The list of expansions activated

#### options

An object containing the options chosen for the game

#### seed

The random seed for the game. Games with the same seed should always produce the same random results (map generation, card shuffling, dice throws...).

### move

```ts
move (data: GameData, move: any, player: number): GameData
```

Execute a move by `player`.

Throw an error if the move is invalid.

Note that if you implement [toSave](#tosave) to not save the result, you can send the result to the UI without storing the modified game state in the database. It is useful when you want to allow the user to play around and only confirm at the very end.

### ended

```ts
ended (data: GameData): boolean
```

Returns whether or not the game is ended.

### scores

```ts
scores (data: GameData): number[]
```

Give the score of each player. The scores are displayed in the sidebar next to player games. They are also used to determine
the player ranking at the end for elo calculation, unless [ranking](#ranking) is implemented.

### dropPlayer

```ts
dropPlayer(data: GameData, player: number): Promise<GameData>
```

Drop a player out.

You should either change the player to an AI or completely remove them from the game. If it is
the current player, the turn should automatically go to the next, non dropped-player.

### currentPlayer

```ts
currentPlayer(data: GameData): number | number[] | undefined
```

Get the current player(s). Some games like 6nimmt can have multiple players that can play at the same time.

When the game is ended, the `currentPlayer` can be `undefined`.

### logLength

```ts
logLength(data: GameData): number
```

Returns the length of the log of the game.

It is used to send log slices to the viewer, especially when executing a move, when we want to send only the new log items to the viewer.

### logSlice

```ts
logSlice (data: GameData, options: {player?: number; start: number; end?: number}): any
```

Returns a log slice to be sent [player](#options-player)'s viewer from [start](#options-start) to [end](#options-end) included.

The return value can have any structure. We recommend something like `{log: items[], availableMoves?: moves[]}` to show the log and the available moves
at the final state.

#### options.player

The player to whom to send the log.

If `undefined`, it is to a spectator. Otherwise it corresponds to the player id of the player.

The secrets should be stripped from the log items, depending on who receives the log info. For example,
in a card game, the spectators or other players should not see a player's card - unless the game is already ended.

#### options.start

The beginning of the log slice.

#### options.end

The end of the log slice. If `undefined`, it corresponds to the very end of the existing log.

## Optional methods

### setPlayerMetaData

```ts
setPlayerMetaData(data: GameData, player: number, metaData: {name: string}): GameData
```

Set metadata on the player, from BGS.

- `name`: Name of the player

Other metadata such as an avatar, clan name, ... could be given in the future.

### setPlayerSettings

```ts
setPlayerSettings(data: GameData, player: number, settings: Record<string, unknown>): GameData
```

Update player settings - such as autocharge in Gaia Project.

Only update settings for the given keys. Other settings are left unchanged.

### playerSettings

```ts
playerSettings(data: GameData, player: number): Record<string, unknown>
```

Get player settings.

### rankings

```ts
rankings (data: GameData): number[]
```

Rankings for the players.

Only necessary if [scores](#scores) does not give enough information to rank the players. For example, if the player with the smallest score is the winner, or if there are tie-breaking conditions not reflected in the score.

The first player should be ranked `1`, the second player ranked `2`, ...

If there are ties, just give the same ranking.

### round

```ts
round (data: GameData): number | undefined
```

The current round in the game.

It is shown in the game listings, and used for statistic purposes.

### cancelled

```ts
cancelled (data: GameData): boolean
```

Returns true if the game is cancelled. For example if a player drops out too early in the game, during faction selection.

Note that this is probably going to be deprecated. It can complicate things for tournaments, ...

### factions

```ts
factions (data: GameData): Array<string | undefined>
```

Return the faction of each player, if applicable.

Used for thumbnails in game lists and sidebar - images can be defined for each faction.

Also used for statistics.

### stripSecret

```ts
stripSecret (data: GameData, player?: number): any;
```

Middleware to process data to be sent to a player's viewer, strip secrets if needed.

In case of a spectator, `player` is undefined.

### toSave

```ts
toSave(data: GameData): any | undefined
```

Middleware to process data to be stored in the database.

Return `undefined` to NOT store the data. It can happen for example
when a player executes a move without confirming it, a dry run so to speak.

### messages

```ts
messages(data: GameData): {messages: string[], data: GameData}
```

Important messages / game events to show in the game's chat.

`data` should be modified so that a subsequent call does not show the same messages.

### replay

```ts
replay (data: GameData, options?: { to?: number }): GameData
```

Replays a game.

It can be called after the database is manually edited, or the game engine is updated.

`to` is optional and means replaying to that move, e.g. `replay(data, {to: 1})` will only redo the first move, and
the rest of the moves will not be played.

### stats

```ts
stats (data: GameData): Record<string, Many<Record<string, number | string>>>
```

Gets stats on a game, to be used to write to CSV. The `Many` type is `type Many<T> = T | T[]`.

For example, here is what it could return for _one_ game:

```ts
{
  basic: {
    point: 120,
    turns: 500
  },
  detailed: [{
    player: 0,
    boosters: 5,
    turns: 120
  }, {
    player: 1,
    boosters: 9,
    turns: 100
  }]
}
```

Here two CSVs would be generated, `basic.csv` and `detailed.csv`.
