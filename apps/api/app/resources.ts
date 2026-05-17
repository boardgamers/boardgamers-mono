// `${"script"}` literals are intentional to avoid having raw `</script>` tokens
// in this file's source — historical caution for tooling that might inline the
// HTML strings into an HTML context.
// oxlint-disable typescript/no-unnecessary-template-expression
/* Koa stuff */
import type { ViewerInfo } from "@bgs/models";
import { AssertionError } from "node:assert";
import type { Server } from "node:http";
import createError from "http-errors";
import { z, ZodError } from "zod";
import Koa from "koa";
import compression from "koa-compress";
import morgan from "koa-morgan";
/* Local stuff */
import Router from "koa-router";
/* Configure passport */
import env from "./config/env.ts";
import { colls } from "./config/db.ts";

const router = new Router();

const iframeQuerySchema = z.object({ src: z.string().optional() });
const gameIframeQuerySchema = z.object({
  alternate: z.string().optional(),
  customViewerUrl: z.string().optional(),
});

router.get("/iframe", (ctx) => {
  const { src } = iframeQuerySchema.parse(ctx.query);
  ctx.body = src;
});

router.get("/game/:game_name/:game_version/iframe", async (ctx) => {
  const { alternate, customViewerUrl } = gameIframeQuerySchema.parse(ctx.query);
  const gameInfo = await colls.gameInfos.findOne({
    _id: { game: ctx.params.game_name, version: +ctx.params.game_version },
  });

  if (!gameInfo) {
    console.log("Game info not found");
    ctx.status = 404;
    return;
  }

  const viewer: ViewerInfo =
    gameInfo?.viewer?.alternate?.url && alternate === "1" ? gameInfo?.viewer.alternate : gameInfo.viewer;
  const viewerUrl = customViewerUrl || viewer.url;

  const stylesheets = (viewer.dependencies?.stylesheets ?? [])
    .map((dep) => `<link type='text/css' rel='stylesheet' href='${dep}'></link>`)
    .join("\n");
  const scripts = (viewer.dependencies?.scripts ?? [])
    .map((dep) => `<${"script"} src='${dep}'></${"script"}>`)
    .join("\n");
  const viewerScript = `<${"script"} src='${viewerUrl}' type='text/javascript'></${"script"}>`;

  const template =
    viewer.topLevelVariable === "clash"
      ? `
    <head>
      <meta charset="UTF-8">
      ${stylesheets}
      </head>
    <body>
      <canvas id='glcanvas' style="margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; position: absolute; z-index: 0;"></canvas>
      ${scripts}
      ${viewerScript}
    </body>`
      : `
    <head>
      <meta charset="UTF-8">
      ${scripts}
      ${viewerScript}
      ${stylesheets}
    </head>
    <body>
      <div id='app'>
      </div>
    </body>`;

  ctx.body = `
      ${template}
      <${"script"} type='text/javascript'>
        const gameObj = window.${viewer.topLevelVariable}.launch('#app');
        window.addEventListener('message', event => {
          console.log('received message from controller', event.data.type, JSON.parse(JSON.stringify(event.data)));
          switch (event.data.type) {
            case 'state': {
              console.log('updating state', event.data.state);
              gameObj.emit('state', event.data.state);
              break;
            }
            case 'askReady': {
              console.log('parent asks if ready');
              parent.postMessage({type: 'gameReady'}, '*');
              break;
            }
            case 'state:updated': {
              console.log('receiving state:updated event');
              gameObj.emit('state:updated');
              break;
            }
            case 'gameLog': {
              console.log('receiving log', event.data.data);
              gameObj.emit('gamelog', event.data.data);
              break;
            }
            case 'player':
            case 'avatars':
            case 'preferences': {
              gameObj.emit(event.data.type, event.data[event.data.type]);
              break;
            }
            case 'replay:start':
            case 'replay:end': {
              gameObj.emit(event.data.type);
              break;
            }
            case 'replay:to': {
              gameObj.emit(event.data.type, event.data.to);
              break;
            }
          }
        });
        gameObj.on('move', move => {
          parent.postMessage({type: 'gameMove', move}, '*');
        });
        gameObj.on('ready', () => {
          parent.postMessage({type: 'displayReady'}, '*');
        });
        gameObj.on('fetchState', () => {
          parent.postMessage({type: 'fetchState'}, '*');
        });
        gameObj.on('fetchLog', data => {
          parent.postMessage({type: 'fetchLog', data}, '*');
        });
        gameObj.on('addLog', data => {
          parent.postMessage({type: 'addLog', data}, '*');
        });
        gameObj.on('update:preference', data => {
          parent.postMessage({type: 'updatePreference', data}, '*');
        });
        gameObj.on('replaceLog', data => {
          parent.postMessage({type: 'replaceLog', data}, '*');
        });
        gameObj.on('player:clicked', player => {
          console.log('player clicked', player);
          parent.postMessage({type: 'playerClick', player}, '*');
        });
        gameObj.on('replay:info', data => {
          parent.postMessage({type: 'replay:info', data}, '*');
        });

        // Get height of document
        function getDocHeight() {
          // const body = document.body;
          // const html = document.documentElement;
          // console.log(body.scrollHeight, body.offsetHeight, html.clientHeight, html.scrollHeight, html.offsetHeight);

          return document.body.scrollHeight;
        }

        parent.postMessage({type: 'gameReady'}, '*');

        if (!${viewer.fullScreen}) {
          let lastPostedHeight = 0;
          setInterval(() => {
            if(!document.hidden) {
              const newHeight = getDocHeight();

              if (newHeight !== lastPostedHeight) {
                lastPostedHeight = newHeight;
                parent.postMessage({type: 'gameHeight', height: newHeight}, '*');
              }
            }
          }, 250);
        }
      </${"script"}>
    </html>`;
});

async function listen(port = env.listen.port.resources) {
  const app = new Koa();

  /* Configuration */
  app.keys = [env.sessionSecret];

  /* App stuff */
  if (!env.silent) {
    app.use(morgan("dev"));
  }
  app.proxy = true;
  app.use(compression());

  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      if (!env.silent) {
        console.error(err);
      }
      if (err instanceof createError.HttpError) {
        ctx.status = err.statusCode;
        ctx.body = { message: err.message };
      } else if (err instanceof ZodError) {
        ctx.status = 400;
        ctx.body = { message: z.prettifyError(err) };
      } else if (err instanceof AssertionError) {
        ctx.status = 422;
        ctx.body = { message: err.message };
      } else {
        ctx.status = 500;
        ctx.body = { message: "Internal error" };
      }
    }
  });

  app.use(router.routes());
  app.use(router.allowedMethods());

  let server!: Server;
  const promise = new Promise<void>((resolve, reject) => {
    server = app.listen(port, env.listen.host, () => resolve());
    app.once("error", (err) => reject(err));
  });

  await promise;

  console.log("resources started on port", port);

  return server;
}

export { listen };
