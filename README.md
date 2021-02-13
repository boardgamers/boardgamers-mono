# Boardgamers

[![Open in Gitpod](https://gitpod.io/button/open-in-gitpod.svg)](https://gitpod.io/#https://github.com/boardgamers/boardgamers-mono)

Mono-repo for the whole architecture of boardgamers.space. The great advantage of a mono-repo is
to share `site-lib` without having to publish it to NPM.

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

The instructions to run the [webapp](./webapp-vue/README.md) and the [admin](./admin-app/README.md) are available in their README.

### Backend

You can follow the instructions in [api-node](./api-node/README.md) and [game-server](./game-server/README.md), or you can just run the following command:

```
pnpm back
```

This will take care of launching a mongodb instance as well.

This is only for development. The mongodb database is exposed to the world!

## Contributing

We welcome contributions from everybody! Don't hesitate to ask a question.

VS Code is the recommended editor. Its workspace feature is great to open multiple windows, one with all the back, and another with the all the front.
Install the prettier & gitmoji extensions!
