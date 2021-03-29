import { handleError, handleInfo } from "@/utils";
import Vue from "vue";
import Router, { Location, Route } from "vue-router";
import { makeAxios } from "./plugins/axios";
import store from "./store";
import Account from "./views/Account.vue";
import Boardgame from "./views/Boardgame.vue";
import BoardgameLayout from "./views/BoardgameLayout.vue";
import Games from "./views/Games.vue";
import GameSelection from "./views/GameSelection.vue";
import Home from "./views/Home.vue";
import Login from "./views/Login.vue";
import NewGame from "./views/NewGame.vue";
import NotFoundComponent from "./views/NotFound.vue";
import Page from "./views/Page.vue";
import Rankings from "./views/Rankings.vue";
import Signup from "./views/Signup.vue";
import User from "./views/User.vue";

Vue.use(Router);

function loadView(view) {
  return () => import(/* webpackChunkName: "view-[request]" */ `@/views/${view}.vue`);
}

const router = new Router({
  mode: "history",
  routes: [
    {
      path: "/",
      component: Home,
    },
    {
      path: "/privacy-policy",
      component: loadView("PrivacyPolicy"),
    },
    {
      path: "/signup",
      name: "signup",
      component: Signup,
      meta: { loggedOut: true },
    },
    {
      path: "/login",
      component: Login,
      meta: { loggedOut: true },
      beforeEnter(to, from, next) {
        if (to.query.refreshToken) {
          const refreshToken = JSON.parse(to.query.refreshToken as string);
          console.log("log in via query refresh token");
          store.commit("updateRefreshToken", refreshToken);
          next("/");
        } else {
          next();
        }
      },
    },
    {
      path: "/account",
      component: Account,
      meta: { loggedIn: true },
    },
    {
      path: "/boardgames/",
      component: GameSelection,
      props: () => ({ title: "Games on the platform" }),
    },
    {
      path: "/new-game/",
      component: GameSelection,
      props: () => ({ newGame: true, title: "Choose which game to play" }),
    },
    {
      path: "/games",
      component: Games,
    },
    {
      path: "/confirm",
      beforeEnter(to, from, next) {
        makeAxios()
          .post("/account/confirm", { key: to.query.key, email: to.query.email })
          .then(
            (response) => {
              store.dispatch("updateAuth", response.data);
              handleInfo("Your account has been confirmed");
              next("/account");
            },
            (err) => {
              handleError(err);
              next("/");
            }
          );
      },
    },
    {
      path: "/next-game",
      beforeEnter(to, from, next) {
        if (store.state.activeGames.length > 0) {
          const activeGames = store.state.activeGames;
          const currentIdx = activeGames.indexOf(from.params.gameId);
          const gameId = activeGames[(currentIdx + 1) % activeGames.length];

          next("/game/" + gameId);
        } else {
          next({ name: "user", params: { username: store.state.user.account.username }, hash: "#active" });
        }
      },
      meta: { loggedIn: true },
    },
    {
      path: "/refresh-games",
      beforeEnter(to, from, next) {
        store.dispatch("logoClick");
        next(from);
      },
    },
    {
      path: "/reset",
      component: loadView("ResetPassword"),
      meta: { loggedOut: true },
    },
    {
      path: "/forgotten-password",
      component: loadView("ForgottenPassword"),
      meta: { loggedOut: true },
    },
    {
      path: "/game/:gameId",
      component: loadView("Game"),
      name: "game",
      meta: { noFooter: true, sidebar: true },
    },
    {
      path: "/user/:username",
      component: User,
      name: "user",
      props: true,
    },
    {
      path: "/boardgame/:boardgameId",
      component: BoardgameLayout,
      props: true,
      name: "boardgame-abstract",

      children: [
        {
          path: "",
          name: "boardgame",
          component: Boardgame,
          props: true,
        },
        {
          path: "rankings",
          name: "bg-rankings",
          component: Rankings,
          props: true,
        },
        {
          path: "games",
          name: "bg-games",
          component: Games,
          props: true,
        },
        {
          path: "/new-game/:boardgameId",
          component: NewGame,
          meta: { loggedIn: true },
          props: true,
          name: "bg-newgame",
        },
      ],
    },
    {
      path: "/page/:page",
      component: Page,
      props: true,
    },
    {
      path: "/page/:component1/:component2",
      component: Page,
      props: (route) => ({ page: `${route.params.component1}:${route.params.component2}` }),
    },
    {
      path: "/auth/:provider/callback",
      beforeEnter(to, from, next) {
        makeAxios()
          .get(`/account/auth/${to.params.provider}/callback`, { params: to.query })
          .then(
            (response) => {
              if (response.data.createSocialAccount) {
                next({ name: "signup", query: response.data });
              } else {
                store.dispatch("updateAuth", response.data);
                next("/account");
              }
            },
            (err) => {
              handleError(err);
              next("/");
            }
          );
      },
    },
    {
      path: "*",
      component: NotFoundComponent,
    },
  ],
});

export default router;

let routing = false;

router.beforeEach(async (to, from, next) => {
  if (!store.state.userLoaded && !to.query.refreshToken) {
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

function guard(to: Route, next: (location?: string | Location) => void): void {
  if (to.meta.loggedOut && store.state.user) {
    console.log("trying to access " + to.path + " while logged in");
    next((to.query.redirect as string) || "/account");
  } else if (to.meta.loggedIn && !store.state.user) {
    next({ path: "/login", query: { redirect: to.fullPath } });
  } else {
    next();
  }
}

store.subscribe((mutation, state) => {
  if (routing) {
    return;
  }
  /* Check if the user is still allowed to be on current page */
  if (mutation.type === "updateUser") {
    guard(router.currentRoute, (location) => (location ? router.push(location) : null));
  }
});
