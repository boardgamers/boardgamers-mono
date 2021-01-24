# Boardgamers - Webapp

To run the project in development, just do:

```
# with hot reloading, websockets may be broken
yarn serve
```

or

```
# Needs nginx setup
yarn build-dev
```

## Deploy

`yarn build`, test it works on the `testdev` subdomain, then `yarn move-front`.

## Env variables

You can add variables to the `.env` file and they can be accessed in `process.env` in the webapp's code. Like `VUE_APP_inviteOnly`.
