# Boardgamers

Mono-repo for the whole architecture of boardgamers.space. The great advantage of a mono-repo is
to share `site-lib` without having to publish it to NPM.

<!-- With `pijul` as the versioning system, you can clone / update only select folders. This is perfect
if you only want to run the game server, etc. -->

## Requirements

<!--
### pijul

We use `pijul` as our versioning system. It's really cool for monorepos! It's experimental though, so it's easier to install on linux or WSL.

-->

### MongoDB

The site needs a mongodb backend running. It can be local or remote. By default it uses a local mongodb database running on port 27017 with no authentication, but it can be configured with a `.env` in the correct projects.

MongoDB needs to at least be **4.2.0**

### pnpm

We use `pnpm` as our package manager!

### Node.js

A recent version of node, 14+ ideally, is required

### Nginx configuration

**Note:** nginx may not be necessary anymore in development, if you don't care about websockets / chat.

In the project's directory:

```bash
sudo cp api-node/app/config/nginx /etc/nginx/sites-available/gaia-project
sudo ln -s /etc/nginx/sites-available/boardgamers /etc/nginx/sites-enabled/boardgamers
# Give proper path for public files
sudo sed -i -e 's:root .*;:root '`pwd`'/front/dist;:' /etc/nginx/sites-available/boardgamers
sudo rm /etc/nginx/sites-enabled/default
sudo service nginx restart
```

You may have a 403 forbidden error regarding js and css files if the folder is under your home folder, then you need to either give more permissions to your home folder or move the project elsewhere. You can give nginx permissions like this: `sudo usermod -G <your-user-name> -a 'www-data'`

## Contributing

We welcome contributions from everybody! Don't hesitate to ask a question.

VS Code is the recommended editor. Its workspace feature is great to open multiple window, one with all the back, another with the front...
