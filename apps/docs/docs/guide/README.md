# Introduction

BGS is a platform able to dynamically load and update boardgame implementations. For that each boardgame must expose two relatively simple APIs, one for the UI and one for the game engine.

As long as you implement those two APIs, you can code your engine and viewer however you like, with any language or framework that builds to JavaScript.

The games on BGS are completely **open source**, and you can look at their code for inspiration.

## The guide

- [Architecture](./architecture.md) — the platform pieces your game runs in.
- [Game engine API](./engine-api.md) — the methods your engine module exports.
- [Viewer API](./viewer-api.md) — the event bridge between your viewer and the site.
- [Tic Tac Toe example](./tictactoe.md) — a complete minimal engine + viewer, end to end.
- [Adding a game](./adding-a-game.md) — getting your game registered and hosted on the platform.

Reference:

- [Game options, preferences & settings](./game-options.md) — declaring configurable fields for your game.
- [Game clocks & timing](./timing.md) — how the platform times games, and what it means for your engine.
- [Bot players](./bots.md) — bot seats and the `moveAI` contract.
