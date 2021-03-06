# Boardgamers - Game Server

Game server for boardgamers.

Dynamically load games based on db in subfolders, using the `yarn` command to install them.

To see the configuration variables, check [env.ts](app/config/env.ts).

This program shares a database with the api, both should be run at the same time.

## Running locally

You need mongodb 4.2+ running, and node/pnpm installed.

```
pnpm install
pnpm start
```

## DB Access

The game server needs to have a user with a role that has:

- Read / write access to the `games` collection (`["find", "update"]`)
- Write access to the `chatmessages` collection, for major milestones in games (`["insert"]`)
- Read / Write access to the `gamenotifications` collection (`["insert", "find", "remove"]`)
- Read / Write access to the `locks` collection (`["insert", "find", "remove", "update"]`)
- Read access to the `gameinfos` collection, to load the game engines (`["find"]`)
- Write access to the `apierrors` colletion (`["insert"]`)

Due to mongoose (they should use `{authorizedCollections: true, nameOnly: true}`), this is also needed

- List collection access to the database

For exemaple, in db shell:

```
db.createRole({role: "game-server", privileges: [
  {resource: {db: "gaia-project", collection: "apierrors"}, actions: ["insert"]},
  {resource: {db: "gaia-project", collection: "chatmessages"}, actions: ["insert"]},
  {resource: {db: "gaia-project", collection: "gameinfos"}, actions: ["find"]},
  {resource: {db: "gaia-project", collection: "gamenotifications"}, actions: ["insert", "find", "remove", "update"]},
  {resource: {db: "gaia-project", collection: "games"}, actions: ["find", "update"]},
  {resource: {db: "gaia-project", collection: "locks"}, actions: ["insert", "find", "remove", "update"]},
  {resource: {db: "gaia-project", collection: ""}, actions: ["listCollections"]}
], roles: []});

// or

db.updateRole("game-server", {privileges: [
  {resource: {db: "gaia-project", collection: "apierrors"}, actions: ["insert"]},
  {resource: {db: "gaia-project", collection: "chatmessages"}, actions: ["insert"]},
  {resource: {db: "gaia-project", collection: "gameinfos"}, actions: ["find"]},
  {resource: {db: "gaia-project", collection: "gamenotifications"}, actions: ["insert", "find", "remove", "update"]},
  {resource: {db: "gaia-project", collection: "games"}, actions: ["find", "update"]},
  {resource: {db: "gaia-project", collection: "locks"}, actions: ["insert", "find", "remove", "update"]},
  {resource: {db: "gaia-project", collection: ""}, actions: ["listCollections"]}
], roles: []});

// and

db.createUser({
  user: "<name>",
  pwd: passwordPrompt(),      // Or  "<cleartext password>"
  roles: [
    "game-server"
  ]
});
```

## Authentication

The client needs to give a JWT token, with the following fields:

```
{
  userId: string,
  username: string,
  scopes: ["gameplay", ...]
}
```

The JWT token should be in the `Authorization` header: `Bearer <encoded JWT token>`
