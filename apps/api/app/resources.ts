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
import { logRequest, matchedRoute } from "@bgs/utils/log";
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
	dark: z.string().optional(),
});

// Generic dark theme for engine viewers. Viewers are external packages whose own colors
// (board fills, faction log rows…) are untouched; this only re-themes the page chrome
// (background, default text, Bootstrap-ish tables/modals/forms) and only applies to
// classless elements so viewer-specific styling wins. Toggled live via postMessage.
const darkStylesheet = `
html.dark body {
  background: #030712;
  color: #f3f4f6;
  scrollbar-color: #4b5563 #1f2937;
}
html.dark a:not([class]) { color: #93c5fd; }
html.dark h1:not([class]), html.dark h2:not([class]), html.dark h3:not([class]),
html.dark h4:not([class]), html.dark h5:not([class]), html.dark h6:not([class]) { color: inherit; }
html.dark table:not([class]), html.dark .table { color: inherit; }
html.dark table:not([class]) td, html.dark table:not([class]) th,
html.dark .table td, html.dark .table th, html.dark .table thead th { border-color: #374151; }
/* Viewers that color log rows inline use white for neutral rows — re-theme those, but
   leave faction/player-colored rows alone. */
html.dark table tr[style*="background-color: white"],
html.dark table tr[style*="background-color: rgb(255, 255, 255)"] { background-color: #1f2937 !important; }
html.dark table tr[style*="background-color: white"] td,
html.dark table tr[style*="background-color: rgb(255, 255, 255)"] td { color: #f3f4f6; }
html.dark .table-striped tbody tr:nth-of-type(odd) { background-color: rgba(255, 255, 255, 0.04); }
html.dark .table-hover tbody tr:hover { background-color: rgba(255, 255, 255, 0.08); }
html.dark .modal-content, html.dark .dropdown-menu, html.dark .popover, html.dark .popover-body {
  background-color: #111827;
  color: #f3f4f6;
  border-color: #374151;
}
html.dark .modal-header, html.dark .modal-footer { border-color: #374151; }
html.dark .dropdown-item { color: #f3f4f6; }
html.dark .dropdown-item:hover, html.dark .dropdown-item:focus { background-color: #1f2937; color: #ffffff; }
html.dark .dropdown-divider { border-color: #374151; }
html.dark .popover-header { background-color: #1f2937; color: inherit; border-color: #374151; }
html.dark .close { color: #f3f4f6; text-shadow: none; }
html.dark .form-control, html.dark .custom-select, html.dark .form-select,
html.dark input:not([class]), html.dark select:not([class]), html.dark textarea:not([class]) {
  background-color: #1f2937;
  color: #f3f4f6;
  border-color: #4b5563;
}
/* SVG labels rendered alongside HTML (player names under turn-order / current-player
   circles) default to the SVG initial fill (black). Explicit fills (e.g. white text on
   faction-colored circles) are left alone. */
html.dark svg:not([style]) text:not([fill]):not([style*="fill"]) { fill: #f3f4f6; }`;

router.get("/iframe", (ctx) => {
	const { src } = iframeQuerySchema.parse(ctx.query);
	ctx.body = src;
});

router.get("/game/:game_name/:game_version/iframe", async (ctx) => {
	const { alternate, customViewerUrl, dark } = gameIframeQuerySchema.parse(ctx.query);
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

	const darkModeAssets = `
      <style>${darkStylesheet}</style>
      <${"script"} type='text/javascript'>
        window.addEventListener('message', event => {
          if (event.data.type === 'theme') {
            document.documentElement.classList.toggle('dark', !!event.data.dark);
          }
        });
      </${"script"}>`;

	const template =
		viewer.topLevelVariable === "clash"
			? `
    <head>
      <meta charset="UTF-8">
      ${stylesheets}
      ${darkModeAssets}
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
      ${darkModeAssets}
    </head>
    <body>
      <div id='app'>
      </div>
    </body>`;

	ctx.body = `
      ${dark === "1" ? `<html class='dark'>` : ``}
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
	app.use(async (ctx, next) => {
		const start = Date.now();
		try {
			await next();
		} finally {
			logRequest("resources", {
				method: ctx.request.method,
				path: ctx.request.path,
				route: matchedRoute(ctx),
				status: ctx.status,
				durationMs: Date.now() - start,
				ip: ctx.ip,
			});
		}
	});
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
