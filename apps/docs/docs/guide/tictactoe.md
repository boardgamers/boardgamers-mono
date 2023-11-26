# Tic Tac Toe example

This is a simple Tic Tac Toe example in Typescript, wrapped with the APIs to be integrated in our platform.

## Engine

We need to define the game state. Since this is a very basic example, we'll avoid everything optional.

Here is our gamestate:

```ts
type Player = 0 | 1;
type Coord = {
  x: 0 | 1 | 2;
  y: 0 | 1 | 2;
};

type Board = [
  [Player | null, Player | null, Player | null],
  [Player | null, Player | null, Player | null],
  [Player | null, Player | null, Player | null],
];

type GameState = {
  winner?: Player;
  board: Board;
  // all moves played
  moves: Array<{
    player: Player;
    coord: Coord;
  }>;
};
```

Then we go through the required exported methods defined in the [engine API](./engine-api.md).

### init

We create an empty board.

```ts
export function init(): GameState {
  return {
    board: [
      [null, null, null],
      [null, null, null],
      [null, null, null],
    ],
    moves: [],
  };
}
```

### move

We handle a move from a player.

We don't have to check that it's the current player - it's already done by the game server.

The function could be as simple as this:

```ts
export function move(state: GameState, move: Coord, player: Player) {
  state.board[coord.x][coord.y] = player;
  state.moves.push({ player, coord: move });

  return state;
}
```

But we'll also add a check to see if the winner is decided here.

```ts
function winner(board: Board): Player | undefined {
  // Check rows
  for (const row of board) {
    if (row[0] !== null && row[1] === row[0] && row[2] === row[0]) {
      return row[0];
    }
  }

  // Check columns
  for (let i = 0; i < 3; i++) {
    if (board[0][i] !== null && board[1][i] === board[0][i] && board[2][i] === board[0][i]) {
      return board[0][i];
    }
  }

  // Check diagonals
  if (board[0][0] !== null && board[0][0] === board[1][1] && board[0][0] === board[2][2]) {
    return board[0][0];
  }

  if (board[2][0] !== null && board[2][0] === board[1][1] && board[2][0] === board[0][2]) {
    return board[2][0];
  }
}
```

Then we add that info in the `move` function:

```ts
export function move(state: GameState, move: Coord, player: Player) {
  state.board[coord.x][coord.y] = player;
  state.moves.push({ player, coord: move });
  // Either it stays undefined or is set to the winner
  state.winner = winner(state.board);

  return state;
}
```

### ended

The game can be ended two ways:

- One of the players won
- The board is full

```ts
export function ended(state: GameState) {
  if (state.winner !== undefined) {
    return true;
  }

  // The board is full
  return state.moves.length === 9;
}
```

### scores

Tic Tac Toe doesn't really have score or victory points. We'll just give 100 points to the winner. If there is no winner, the score is 0 for for everybody.

```ts
export function scores(state: GameState) {
  return [state.winner === 0 ? 100 : 0, state.winner === 1 ? 100 : 0];
}
```

### dropPlayer

When a player drops, the other player automatically wins.

```ts
function opponent(player: Player): Player {
  return player === 0 ? 1 : 0;
}

export function dropPlayer(state: GameState, player: Player) {
  state.winner = opponent(player);
  return state;
}
```

### currentPlayer

The first player is `0`. Then the turns alternate.

We reuse the `opponent` function defined in [dropPlayer](#dropplayer).

```ts
export function currentPlayer(state: GameState): Player {
  if (state.moves.length === 0) {
    return 0;
  }

  return opponent(state.moves[state.moves.length - 1]);
}
```

### logLength

Our log is simple, it's just the moves played.

However, we want to tell the viewer when a player wins.

So our log will actually be:

- an event "start"
- the list of moves
- an event "end", with the winner

As such the log length is the number of moves + 1 if there is no winner, and the number of moves + 2 if there is.

```ts
export function logLength(state: GameState): number {
  return 1 + moves.length + (state.winner !== undefined ? 1 : 0);
}
```

### logSlice

And here we actually generate the log. The logic is described in [logLength](#loglength).

```ts
type LogItem =
  | {
      kind: "event";
      event: "start";
    }
  | {
      kind: "event";
      event: "end";
      winner?: Player;
    }
  | {
      kind: "move";
      move: Coord;
      player: Player;
    };

export function logSlice(state: GameState, options: { start: number; end?: number }): LogItem[] {
  // Add the starting event
  const log = [{ kind: "event", event: "start" }];

  // Add the log items for the moves
  log.push(...state.moves.map((move) => ({ kind: "move", move: move.coord, player: move.player })));

  // Add the end event, with the winner, if the winner is decided
  if (state.winner !== undefined || state.moves.length === 9) {
    log.push({ kind: "event", event: "end", winner: state.winner });
  }

  // Return the requested log items
  return log.slice(options.start, options.end);
}
```

## Viewer

We're mainly used to Vue, but boardgames can use any UI system.

We're going to demonstrate implementing the viewer with Vue, because it's much more readable than jQuery.

Let's also assume that we exported the engine module in a `tictactoe-engine` module.

First, we create the game itself. We'll worry about the API later.

Here's the board:

```vue
<template>
  <div>
    <!--rows -->
    <div class="row" v-for="i in 3" :key=i>
      <!-- columns -->
      <div :class="['cell', {player1: cellPlayer(i-1, j-1) === 0, player2: cellPlayer(i-1, j-1) === 1}]" v-for="j in 3" :key=j>
      </div>
    </div>
  <div>
</template>

<script lang="ts">
...
</script>

<style lang="scss">
.cell {
  margin: 20px;
  width: 100px;
  height: 100px;

  border: 1px solid black;

  &.player1 {
    background-color: red;
  }
  &.player2 {
    background-color: blue;
  }
}
.row {
  display: flex;
}
</style>
```

It's a really simple 3x3 board, with player 1's cells being red, and player2's cell being blue.

Now we need to flesh out the interactions. First add a way to receive the state from the outisde:

```vue
... Template ...

<script lang="ts">
import type { GameState, Player } from "tictactoe-engine";
import { Vue, Component, Watch, Prop } from "vue-property-decorator";

@Component
export default class App extends Vue {
  // State received from the outside
  @Prop()
  state!: GameSate;

  /**
   * Which player is in cell i/j, needed in the template code
   */
  cellPlayer(i: number, j: number): Player {
    return this.state.board[i][j];
  }
}
</script>

... Style ...
```

Pretty simple, right?

Now we need to add code to give our App the necessary info:

- The player of the viewer
- Updated state when the opponent makes a move

It's time to look at the BGS API and do a wrapper. In a separate file:

```ts
import Vue from "vue";
import App from "./App.vue";
import { init } from "tictactoe-engine";
import type { GameState, Player } from "tictactoe-engine";
import { EventEmitter } from "events";

function launch(selector: string) {
  const props: { state: GameState; player?: Player } = { state: init() };

  // Create the vue app and mount it where we are told
  const vue = new Vue({
    render: (h) => h(App, { props }, []),
  }).$mount(selector);

  // Our App component
  const app = vue.$children[0];

  // Now we just need to modify `props` to reflect the changes on the App component
  // First create what we will use to communicate with BGS

  const emitter = new EventEmitter();

  // Handle BGS API stuff
  // ...

  return emitter;
}

window.viewer = { launch };
```

This is what the wrapper will look like in general.

What we want to do:

- Get new state when it's there
- Get current player
- Forward moves to BGS

So now we can complete the code:

```ts
//...

function launch(...) {
  // ...

  // When we know new state is available
  emitter.on("state:updated", () => {
    // Tell the backend we want the new state
    emitter.emit("fetchState");
  });

  // When we receive new state
  emitter.on("state", state => {
    props.state = state;
    // wait for the DOM to render, and emit the ready event
    vue.$nextTick().then(() => emitter.emit("ready"));
  });

  // When we receive log slices, when executing a move
  emitter.on("gamelog", (logData) => {
    // Ignore the log data and tell the backend we want the new state
    emitter.emit("fetchState");
  });

  // Which player are we
  emitter.on("player", (player: {index: number}) => {
    // Props are passed to the vue component
    props.player = player.index;
  });

  // Finally, transmit moves to BGS
  app.on("move", move => emitter.emit("move", move));

  return emitter;
}

//...
```

And with that... all that's left is finishing our `App` component.

We need to add the `player` info, as well as transmit moves.

```vue {10}
<template>
  <div>
    <!--rows -->
    <div class="row" v-for="i in 3" :key=i>
      <!-- columns -->
      <div
        v-for="j in 3"
        class="cell"
        :class="{player1: player(i-1, j-1) === 0, player2: player(i-1, j-1) === 1}"
        :role="clickable(i-1, j-1) ? 'button' : undefined"
        :key=j
        @click="move(i-1, j-1)">
      </div>
    </div>
  <div>
</template>

<script lang="ts">
import { currentPlayer, ended } from "tictactoe-engine";
// ...


@Component
export default class App extends Vue {
  // ...

  @Prop()
  player?: Player;

  clickable(i: number, j: number) {
    // First check it's our turn
    if (this.player === undefined) {
      return false;
    }

    if (ended(this.state)) {
      return false;
    }

    if (currentPlayer(this.state) !== this.player) {
      return false;
    }

    // Then check cell is empty
    if (this.cellPlayer(i, j) !== undefined) {
      return false;
    }

    // We can click!
    return true;
  }

  move(i: number, j: number) {
    if (!this.clickable(i, j)) {
      return false;
    }

    // Emit a move in a format that our engine understands
    this.$emit("move", {x: i, y: j});
  }
}

// ...
</script>

<style lang="scss">
// ...

.clickable {
  cursor: pointer;
}
</style>
```

### Testing

You probably want to be able to test the game before adding it to BGS.

In that case - you can simulate a backend very easily. In a separate file, `local.ts`.

There are three files in the viewer so far:

- `App.vue`
- `wrapper.ts`
- And now, `local.ts`

Here's the content:

```ts
import "./wrapper.ts";
import { init, move as engineMove, currentPlayer } from "tictactoe-engine";

const emitter = window.viewer.launch("#app");

let state = init();
let player = 0;

// Initial state / player
emitter.emit("state", state);
emitter.emit("player", { index: player });

emitter.on("move", (move) => {
  state = engineMove(state, move, player);
  player = currentPlayer(state);

  // Give updated player (we want to be able to play both sides)
  // and give updated player / state
  emitter.emit("state", state);
  emitter.emit("player", { index: player });
});
```

And that should be it.

## Conclusion

That's it for Tic Tac Toe. The game is ready to be added on the platform!

We only implemented the very basics, and we can go more in depth. But should you want to add any boardgame, we'll offer our full support and help you add the other stuff, like replay mode or log in the sidebar.
