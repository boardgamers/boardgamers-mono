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
pnpm --filter @bgs/web --filter @bgs/admin dev
```

You can directly run the frontend against the website! No need to run the backend. To do so, just create `.env.local` in the apps/web folder with `PUBLIC_SERVER=https://www.boardgamers.space`.

### Backend

You can follow the instructions in [api-node](./apps/api/README.md) and [game-server](./apps/game-server/README.md), or you can just run the following command:

```bash
# start mongodb backend
docker compose up -d


pnpm dev --filter @bgs/api
# launch in another terminal
pnpm dev --filter @bgs/game-server
```

## Contributing

We welcome contributions from everybody! Don't hesitate to ask a question.

VS Code is the recommended editor. Its workspace feature is great to open multiple windows, one with all the back, and another with the all the front.
Install the prettier & [gitmoji](https://github.com/carloscuesta/gitmoji) extensions!
