# Game clocks & timing

Timing on BGS is **platform-side**: the game-server tracks each player's clock and enforces deadlines, while the
engine never sees the clock. This page describes the model — what creators configure, how clocks move, and what it
means for engine authors.

## What the creator configures

At game creation, the host picks two values, stored on the game as `options.timing`:

- **`timePerGame`** (seconds) — each player's total clock for the whole game. Everyone starts with
  `remainingTime = timePerGame`.
- **`timePerMove`** (seconds) — an increment/refund added back after each of your moves.

Two optional modifiers:

- **`timer: { start, end }`** — a daily play window, in UTC seconds-of-day (e.g. `{ start: 28800, end: 61200 }` =
  8:00–17:00 UTC). Clocks only tick inside the window: elapsed time and deadlines are computed skipping the paused
  hours. Default is the full day (`{ start: 0, end: 86399 }`). The window must span at least 3 hours.
- **`scheduledStart`** — the game starts by itself at that date (at most 10 days out) once full, instead of
  immediately.

Shorter `timePerGame`/`timePerMove` values make a "live" game; the usual settings make asynchronous games that
play out over days.

## How clocks move

The game-server maintains, per current player, a `timerStart` timestamp and a `deadline` (computed from the
player's `remainingTime`, skipping the paused hours when a `timer` window is set).

When a player stops being the current player (they moved, or the turn passed), the game-server:

1. subtracts the elapsed time since `timerStart` from their `remainingTime`;
2. adds `timePerMove` back (not for dropped players);
3. clamps the result between `timePerMove` and `timePerGame` — you can never bank more than your initial clock,
   and never drop below one move's worth.

When `timePerMove` is short (15 minutes or less — live games), the refund is instead applied **eagerly** right
after the move is saved, so the displayed clock refreshes immediately even if the player stays the current player.

Games can have several current players at once (e.g. 6nimmt!, where everyone picks a card simultaneously) — each
current player has their own `timerStart`/`deadline`, and each clock only runs while that player is current.

## Timeouts, drops, and inactivity

The platform does not auto-drop a player the instant their deadline passes. Instead:

- **Another player drops them.** Once a current player's deadline has passed, any other player in the game can
  drop them (`POST /game/:id/drop/:userId`). The game-server then calls the engine's
  [`dropPlayer`](./engine-api.md#dropplayer), flags the player `dropped`, and the dropped player loses karma.
- **Inactivity sweep.** If a deadline stays expired for 24 hours, a warning is posted in the game chat; if nothing
  moves for 10 days past the deadline, the game is **cancelled for inactivity** (penalty-free — no Elo/karma
  effect, as with a player-agreed cancel). A warning can only repeat after a move resets it.

So the deadline is social enforcement plus a safety net — not a hard engine event.

## What this means for engine authors

- **The engine never sees the clock.** `init`, `move`, `currentPlayer`… none receive timing information. Don't
  track time in your game state.
- **`dropPlayer` must be robust.** It is called exactly when a player ran out of time (or quit): possibly early in
  the game, possibly mid-decision, possibly when they are the current player. Either turn them into an AI or
  remove them cleanly, and if they were current, pass the turn to the next non-dropped player. See
  [bot players](./bots.md) for how dropped players relate to bots.
- **Keep `move` and available-moves computation fast.** Engine calls run with a hard timeout — see
  [Architecture](./architecture.md).
