# Bot players

BGS has two different "AI" mechanisms that are easy to confuse:

- **Platform bot slots** — seats filled by bots at game creation, auto-played by the game-server through the
  engine's [`moveAI`](./engine-api.md#moveai). This page is mostly about those.
- **Engine-side replacement** — when a human drops (or is dropped) mid-game, the engine's
  [`dropPlayer`](./engine-api.md#dropplayer) usually turns them into an AI inside the game state. The platform
  doesn't drive that player; the engine just keeps the game coherent.

## Bot slots

A game supports bot slots when its engine exports `moveAI`. The game-server **auto-detects** this when an engine
version is installed — it probes the entry point for a `moveAI` export and records the result as `meta.bots` on
the game info. The creation UI then offers bot seats for that game (no bot seats for engines without `moveAI`).
Because bots are only for testing, the bot-seat picker is a **developer-only control**: it's hidden unless the
user has developer settings enabled on their device (the web app ANDs `meta.bots` with its developer-settings
flag before showing it).

A bot slot is a player entry flagged `isBot: true`, with a placeholder id and a generated name ("Rob (bot 1)",
"Ada (bot 2)", …). There is no user account behind it, so bots:

- get no turn-notification emails and no karma;
- are excluded from Elo — **a game with any bot player is unrated**;
- auto-consent to cancel votes (a game can only cancel once a human voted, quit or dropped).

At least one seat must be human: the creator can't fill every seat with bots without joining the game themselves.

## How bot moves are driven

After every move (and at game start), the game-server checks whether a bot is among the current players. If so, a
detached driver loop runs — it never blocks the request that triggered it:

1. wait ~1.5 seconds, so a human watching sees turns happen one at a time (and live updates arrive in order);
2. re-read the game under the game lock and find the first current player flagged `isBot`;
3. call `moveAI(gameData, botIndex)` — in the engine worker thread, like regular moves;
4. run the result through the normal after-move flow (log, scores, clocks, notifications);
5. repeat until no bot is current anymore (a bot move can leave the same or another bot to play).

One driver runs per game at a time, capped at 50 bot moves per run. If the engine has no `moveAI`, throws, or
returns unusable data, the driver stops and leaves the game as-is — the bot is simply stuck and can be dropped
like any player whose time ran out; the game is never wedged.

Bots don't get a free pass on the clock: a bot seat has a `remainingTime` like everyone else, but the inactivity
sweep skips bots (a bot whose clock expired is a bug, not inactivity — it's left for an admin).

## Engine requirements

To host bot players, your engine must:

- **Export `moveAI(data, player)` from the entry point** — the module the game-server loads (the `entryPoint` of
  the engine package). That's what the probe checks and what the driver calls.
- **Play exactly one move** per call and return the new game data (a promise is fine). The driver loops, so a
  single move per call is all that's needed — and important, because the normal after-move flow (logs, clocks,
  notifications) runs between calls.
- **Return saveable data.** The result goes through [`toSave`](./engine-api.md#tosave) like any move; if `toSave`
  declines to store it, the driver gives up (the game stays put, bot stuck). A bot move must therefore always
  complete a full turn — a partial, non-saveable result is an error, not a dry run.
- Keep it simple: reusing the auto-play logic from `dropPlayer` is a good starting point, and a random legal move
  is fine. Bots are deliberately **dumb** — they exist for testing the UI solo and filling seats, not for a
  challenge. See [issue #251](https://github.com/boardgamers/boardgamers-mono/issues/251) for real AI opponents.

## Dropped players vs bot slots

When a human quits or is dropped on timeout, `dropPlayer(data, player)` is called on the engine and the player is
flagged `dropped` on the platform side. What happens to their in-game persona is entirely up to your engine —
most games convert them to an internal AI so the remaining players can finish. That AI is **not** a platform bot:
the seat still belongs to the (dropped) user, no `moveAI` calls are scheduled for it, and its "moves" happen
inside the engine as part of other players' `move` calls.

Design `dropPlayer` to be safe at any point of the game — it runs exactly when someone vanished mid-turn. See
[clocks & timing](./timing.md) for when drops happen.
