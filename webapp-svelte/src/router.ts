import { get } from "svelte/store";
import { loadAccountIfNeeded } from "./api";
import { createRouter, navigate, route, RouteConfig } from "./modules/router";
import Account from "./pages/Account.svelte";
import BoardgameLayout from "./pages/BoardgameLayout.svelte";
import Game from "./pages/Game.svelte";
import Games from "./pages/Games.svelte";
import GameSelection from "./pages/GameSelection.svelte";
import Home from "./pages/Home.svelte";
import NotFound from "./pages/NotFound.svelte";
import Page from "./pages/Page.svelte";
import User from "./pages/User.svelte";
import { logoClicks, user } from "./store";
import { handleError } from "./utils";

const routes: RouteConfig[] = [
  {
    path: "/",
    component: Home,
    layout: BoardgameLayout,
  },
  {
    path: "/user/:username",
    component: User,
    name: "user",
  },
  {
    path: "/login",
    name: "login",
    component: NotFound,
    meta: {
      loggedOut: true,
    },
  },
  {
    path: "/account",
    name: "account",
    component: Account,
    meta: {
      loggedIn: true,
    },
  },
  {
    path: "/game/:gameId",
    component: Game,
    name: "game",
    meta: {
      sidebar: true,
    },
  },
  {
    path: "/games",
    component: Games,
    name: "games",
    layout: BoardgameLayout,
  },
  {
    path: "/new-game",
    component: GameSelection,
    props: () => ({ newGame: true, title: "Choose which game to play" }),
  },
  {
    path: "/page/:page",
    component: Page,
  },
  {
    path: "/page/:part1/:part2",
    component: Page,
    props: (route) => ({
      page: `${route.params.part1}:${route.params.part2}`,
    }),
  },
  {
    path: "/refresh-games",
    guard(_route) {
      logoClicks.update((val) => val + 1);
      // stay at current url
      return window.location.pathname + window.location.search + window.location.hash;
    },
  },
  {
    path: "/boardgame/:boardgameId",
    name: "boardgame",
    component: NotFound,
  },
  {
    path: "*",
    component: NotFound,
  },
];

let routing = false;

createRouter({
  routes,
  globalGuard: async (to) => {
    routing = true;
    await loadAccountIfNeeded().catch(handleError);
    routing = false;

    const $user = get(user);
    if (to.meta.loggedOut && $user) {
      console.log("trying to access " + to.path + " while logged in");
      return to.query.redirect || "/account";
    } else if (to.meta.loggedIn && !$user) {
      return { name: "login", query: { redirect: to.fullPath } };
    }

    // continue to `to`
  },
});

user.subscribe((user) => {
  if (routing) {
    return;
  }

  const $route = get(route);

  if ($route?.meta.loggedIn && !user) {
    navigate({ name: "login", query: { redirect: $route.path } });
  } else if ($route?.meta.loggedOut && user) {
    navigate($route.query.redirect || "/account");
  }
});
