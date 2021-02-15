import axios, { AxiosError } from "axios";
import Vue from "vue";
import store from "../store";

const baseURL = "/api/";

export async function refreshTokenIfNeeded(type: "site" | "gameplay") {
  if (!store.state.jwt.refreshToken) {
    return;
  }

  const isGames = type === "gameplay";
  const token = isGames ? store.state.jwt.gamesAccessToken : store.state.jwt.accessToken;

  if (!token || token.expiresAt < Date.now() + 10 * 60 * 1000) {
    try {
      await axios
        .create({ baseURL })
        .post("/account/refresh", { code: store.state.jwt.refreshToken.code, scopes: isGames ? ["gameplay"] : ["all"] })
        .then(({ data }) => {
          store.commit(isGames ? "updateGamesAccessToken" : "updateAccessToken", data);
        });
    } catch (err) {
      // log out if refresh token is expired
      if ((err as AxiosError)?.response?.status === 404) {
        console.log("axios, removing user");
        store.commit("updateUser", null);
      }
      return;
    }
  }

  return isGames ? store.state.jwt.gamesAccessToken : store.state.jwt.accessToken;
}

export function makeAxios(useInterceptors = true) {
  const instance = axios.create({
    baseURL,
  });

  // Refresh JWT token if needed
  if (useInterceptors) {
    instance.interceptors.request.use(async (config) => {
      const isGames = config.url?.startsWith("/gameplay");

      const token = await refreshTokenIfNeeded(isGames ? "gameplay" : "site");
      if (token) {
        config.headers.Authorization = `Bearer ${token.code}`;
      }

      return config;
    });
  }

  return instance;
}

Object.defineProperty(Vue.prototype, "$axios", {
  value: makeAxios(),
});
