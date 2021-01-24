import Vue from "vue";
import VueRouter, { RouteConfig, Route, Location } from "vue-router";
import Home from "../views/Home.vue";
import Game from "../views/Game.vue";
import Login from "../views/Login.vue";
import NewGame from "../views/NewGame.vue";
import NewPage from "../views/NewPage.vue";
import Page from "../views/Page.vue";
import User from "../views/User.vue";
import Users from "../views/Users.vue";
import store from "../store";
import { makeAxios } from "@/plugins/axios";
import { handleError } from "@/utils";

Vue.use(VueRouter);

function loadView(view: string) {
  return () => import(/* webpackChunkName: "view-[request]" */ `@/views/${view}.vue`);
}

const routes: Array<RouteConfig> = [
  {
    path: "/",
    name: "home",
    component: Home,
    meta: { loggedIn: true },
  },
  {
    path: "/login",
    name: "login",
    component: Login,
    meta: { loggedOut: true },
  },
  {
    path: "/game/new",
    name: "newGame",
    component: NewGame,
    meta: { loggedIn: true },
  },
  {
    path: "/game/:game/:version",
    name: "game",
    component: Game,
    meta: { loggedIn: true },
    props: true,
  },
  {
    path: "/page/new",
    name: "newPage",
    component: NewPage,
    meta: { loggedIn: true },
  },
  {
    path: "/page/:name/:lang",
    name: "page",
    component: Page,
    meta: { loggedIn: true },
    props: true,
  },
  {
    path: "/users",
    name: "users",
    component: Users,
    meta: { loggedIn: true },
  },
  {
    path: "/users/:username",
    name: "user",
    component: User,
    meta: { loggedIn: true },
    props: true,
  },
];

const router = new VueRouter({
  mode: "history",
  base: process.env.BASE_URL,
  routes,
});

export default router;

let routing = false;

function guard(to: Route, next: (location?: string | Location) => void): void {
  if (to.meta.loggedOut && store.state.user) {
    console.log("page requires logged out but logged in");
    next((to.query.redirect as string) || "/");
  } else if (to.meta.loggedIn && !store.state.user) {
    next({ path: "/login", query: { redirect: to.fullPath } });
  } else {
    next();
  }
}

router.beforeEach(async (to, from, next) => {
  if (!store.state.userLoaded) {
    routing = true;
    await makeAxios()
      .get("/account")
      .then(
        (response) => store.commit("updateUser", response.data),
        (err) => handleError(err)
      );
    routing = false;
  }

  guard(to, next);
});

store.subscribe((mutation, state) => {
  if (routing) {
    return;
  }
  /* Check if the user is still allowed to be on current page */
  if (mutation.type === "updateUser") {
    guard(router.currentRoute, (location) => (location ? router.push(location) : null));
  }
});
