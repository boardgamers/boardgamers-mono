# Api-node

## Running locally

You need mongodb 4.2+ running, and node/pnpm installed.

```
pnpm install
pnpm start
```

## 🌱 Seeding data

To get started easier, you can inject some data with:

```
pnpm seed
```

This will create three users, with emails `admin@test.com`, `user@test.com` and `user2@test.com`, and password `password`.

Seeding is non-destructive: collections that already contain data are left untouched (the `settings` collection only gains any missing docs, e.g. the announcement). To wipe each seeded collection and reinsert the fixtures, pass `--drop`:

```
pnpm seed --drop
```

## 🔧 Environment

Most of the configurable environment variables are shown in `app/config/env.ts`. You just need to create a `.env` file at the root of the project with the changed environement variables.

For example:

```bash
#.env file
NODE_ENV=production
automatedEmails=true
cron=1
sessionSecret=customSessionSecret
domain=my-domain.com
dbUrl=<custom mongodb url>
```

## ✅ Testing

To run all tests

```
npm run test
```

To run specific tests

```
npm run test-only **/gameinfo.spec.ts
```
