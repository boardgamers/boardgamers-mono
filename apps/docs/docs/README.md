---
title: BGS Docs
---

<div class="hero">
  <img src="/logo.svg" alt="BGS logo">
  <p class="tagline">Docs for the boardgamers ecosystem</p>
  <p>How the <a href="https://boardgamers.space">boardgamers.space</a> platform works, and how to add your own board game to it.</p>
  <a class="action-button" href="/guide">Get started →</a>
</div>

<div class="features">
  <div class="feature">
    <h2>Add your game</h2>
    <p>Write a game engine (any TypeScript/JavaScript — one small API surface) and a viewer, and the platform runs
    them: matchmaking, clocks, Elo, replays, mobile &amp; desktop — no restart needed to publish or update a game.</p>
    <p><a href="/guide">Read the guide →</a></p>
  </div>
  <div class="feature">
    <h2>Play</h2>
    <p>Just here to play? The platform hosts asynchronous and live games of Gaia Project, Power Grid, Container,
    6nimmt! and more.</p>
    <p><a href="https://boardgamers.space">Go to boardgamers.space →</a></p>
  </div>
  <div class="feature">
    <h2>Open source</h2>
    <p>The platform and every game on it are open source — read real engines and viewers for inspiration, and
    contribute your own.</p>
    <p><a href="https://codeberg.org/boardgamers/boardgamers">Platform source →</a> · <a href="https://github.com/boardgamers">Game repos →</a></p>
  </div>
</div>

## Adding a game, in four steps

1. **[Architecture](/guide/architecture)** — the moving parts your game runs in: web app, API, game-server, viewer iframe.
2. **[Engine API](/guide/engine-api) & [Viewer API](/guide/viewer-api)** — the two contracts your code implements.
3. **[Tic Tac Toe tutorial](/guide/tictactoe)** — a complete minimal engine + viewer, end to end.
4. **[Adding a game](/guide/adding-a-game)** — how a finished game gets registered and hosted on the platform.

Reference pages: [game options, preferences & settings](/guide/game-options) · [clocks & timing](/guide/timing) ·
[bot players](/guide/bots).

Every page is also available as raw markdown — append `.md` to its URL, or send `Accept: text/markdown`. See
[/llms.txt](/llms.txt) for the machine-readable listing.
