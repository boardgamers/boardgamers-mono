# Api-node

## Testing locally

You will need to create a `.env` file in the project folder, in which you specify a custom domain like localhost. You can use
another domain, but you need to add it to /etc/hosts as a local domain.

You **may** also need to setup nginx / remove the /etc/nginx/sites-enabled/default!

## Environment

Most of the configurable environment variables are shown in `app/config/env.ts`. You just need to create a `.env` file at the root of the project with the changed environement variables.

For example:

```bash
#.env file
NODE_ENV=production
inviteOnly=true
automatedEmails=true
sessionSecret=customSessionSecret
domain=my-domain.com
automatedDrops=0
```
