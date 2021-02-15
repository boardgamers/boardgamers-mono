import { GameInfo, User } from "@/types";
import { GamePreferences } from "@lib/gamepreferences";
import Vue from "vue";
import Vuex from "vuex";

Vue.use(Vuex);

const store = new Vuex.Store({
  state: {
    updateAvailable: false as boolean,
    user: null as User | null,
    userLoaded: false as boolean,
    activeGames: [] as string[],
    gameDesc: {} as { [key: string]: GameInfo },
    gameSettings: {} as { [key: string]: GamePreferences },
    playerStatus: [] as Array<{ _id: string; status: "online" | "offline" | "away" }>,
    chatOpen: 0 as number,
    jwt: {
      accessToken: null as { code: string; expiresAt: number } | null,
      gamesAccessToken: null as { code: string; expiresAt: number } | null,
      refreshToken: (localStorage.getItem("refreshToken")
        ? JSON.parse(localStorage.getItem("refreshToken"))
        : null) as { code: string; expiresAt: number } | null,
    },
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
        state.gameSettings = {};
        localStorage.removeItem("refreshToken");
        state.activeGames = [];
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
    updateAvailable: (state) => {
      state.updateAvailable = true;
    },
    // For mutation watcher
    error: (state, error: string) => {},
    info: (state, info: string) => {},
    activeGames: (state, games: string[]) => (state.activeGames = games),
    removeActiveGame: (state, gameId: string) => {
      if (!state.activeGames.includes(gameId)) {
        return;
      }
      state.activeGames = state.activeGames.filter((game) => game !== gameId);
    },
    addActiveGame: (state, gameId: string) => {
      if (state.activeGames.includes(gameId)) {
        return;
      }
      state.activeGames = [...state.activeGames, gameId];
    },
    gameDesc(state, data: GameInfo & { latest?: boolean }) {
      const key = `${data._id.game}/${data._id.version}`;
      state.gameDesc = { ...state.gameDesc, [key]: { viewer: state.gameDesc[key]?.viewer, ...data } };

      if (data.latest) {
        state.gameDesc = { ...state.gameDesc, [`${data._id.game}/latest`]: data };
      }
    },
    gameSettings(state, data: GamePreferences) {
      state.gameSettings = { ...state.gameSettings, [data.game]: data };
    },
    playerStatus(state, playerStatus) {
      state.playerStatus = playerStatus;
    },
    openChat(state) {
      state.chatOpen += 1;
    },
    closeChat(state) {
      state.chatOpen -= 1;
    },
  },
  actions: {
    logoClick() {},
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
      state.commit("updateUser", user);
      state.commit("updateAccessToken", accessToken);
      state.commit("updateRefreshToken", refreshToken);
    },
  },
  getters: {
    admin: (state) => !!state.user && state.user.authority === "admin",
  },
});

export default store;
