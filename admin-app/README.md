# Admin interface for BGS

## Setup

- install `node`
- install `yarn`

Note: this repository uses `yarn` instead of `pnpm` because of a badly configured dependency, `@toast-ui/vue-editor`.

## Running

```
yarn install
yarn serve
```

This will run against a local backend. You can run against a remote backend by creating a `.env` file with:

```bash
backend=remote
```
