# Api-node

## Running locally

You need mongodb 4.2+ running, and node/pnpm installed.

```
pnpm install
pnpm start
```

## Environment

Most of the configurable environment variables are shown in `app/config/env.ts`. You just need to create a `.env` file at the root of the project with the changed environement variables.

For example:

```bash
#.env file
NODE_ENV=production
automatedEmails=true
sessionSecret=customSessionSecret
domain=my-domain.com
automatedDrops=0
dbUrl=<custom mongodb url>
```
