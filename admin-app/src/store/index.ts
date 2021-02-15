import { User } from "@/types";
import Vue from "vue";
import Vuex from "vuex";

Vue.use(Vuex);

export default new Vuex.Store({
  state: {
    user: null as null | User,
    userLoaded: false as boolean,
    jwt: {
      accessToken: null as { code: string; expiresAt: number } | null,
      gamesAccessToken: null as { code: string; expiresAt: number } | null,
      refreshToken: (localStorage.getItem("refreshToken")
        ? JSON.parse(localStorage.getItem("refreshToken")!)
        : null) as { code: string; expiresAt: number } | null,
    },
    games: [],
    pages: [],
  },
  mutations: {
    updateUser: (state, data: User | null) => {
      if (data) {
        state.user = data;
      } else {
        state.user = null;
        state.jwt.accessToken = null;
        state.jwt.refreshToken = null;
        state.jwt.gamesAccessToken = null;
        localStorage.removeItem("refreshToken");
      }
      state.userLoaded = true;
    },
    updateRefreshToken(state, data) {
      localStorage.setItem("refreshToken", JSON.stringify(data));
      state.jwt.refreshToken = data;
    },
    updateAccessToken(state, data) {
      state.jwt.accessToken = data;
    },
    updateGamesAccessToken(state, data) {
      state.jwt.gamesAccessToken = data;
    },
    games(state, games) {
      state.games = games;
    },
    pages(state, pages) {
      state.pages = pages;
    },
    // Just there to be able to listen with subscribe()
    error(state, message) {},
    // Just there to be able to listen with subscribe()
    info(state, message) {},
    // Just there to be able to listen with subscribe()
    success(state, message) {},
  },
  actions: {
    updateAuth(
      state,
      {
        user,
        accessToken,
        refreshToken,
      }: {
        user: User;
        accessToken: { code: string; expiresAt: number };
        refreshToken: { code: string; expiresAt: number };
      }
    ) {
      if (user?.authority === "admin") {
        state.commit("updateUser", user);
        state.commit("updateAccessToken", accessToken);
        state.commit("updateRefreshToken", refreshToken);
      } else {
        state.commit("updateUser", null);
      }
    },
  },
  modules: {},
});
