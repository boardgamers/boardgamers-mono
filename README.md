# Boardgamers

Mono-repo for the whole architecture of boardgamers.space.

<!-- With `pijul` as the versioning system, you can clone / update only select folders. This is perfect
if you only want to run the game server, etc. -->

## Requirements

<!--
### pijul

We use `pijul` as our versioning system. It's really cool for monorepos! It's experimental though, so it's easier to install on linux or WSL.

-->

### pnpm

We use `pnpm` as our package manager!

### Node.js

A recent version of node, 14+ ideally, is required

## Running

### Frontend

There is a [webapp](./apps/web/README.md) and an [admin](./apps/admin/README.md).

```bash
pnpm --filter web dev
pnpm --filter admin dev
```

You can directly run the frontend against the website! No need to run the backend. To do so, just create `.env` in the apps/web folder with `VITE_backend=https://boardgamers.space`.

### Backend

You can follow the instructions in [api-node](./apps/api/README.md) and [game-server](./apps/game-server/README.md), or you can just run the following command:

```bash
# start mongodb backend
docker compose up -d

pnpm --filter api dev
# launch in another terminal
pnpm --filter game-server dev
```

### Everything at once

From the repo root, this runs the api, game-server and webapp in parallel:

```bash
docker compose up -d # mongodb
pnpm dev
```

Add `pnpm dev:admin` for the admin panel.

### Multiple isolated instances

To run several copies of the stack side-by-side (e.g. one per agent or per PR),
give each its own worktree and loopback IP.

See the "Running instances" section of [AGENTS.md](./AGENTS.md) for details.
