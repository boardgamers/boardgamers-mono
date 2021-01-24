import Vue from "vue";
import store from "../store";
import { makeAxios } from "../plugins/axios";
import { handleError } from "@/utils";
import { sortBy, uniqBy } from "lodash";

class GameInfoService {
  key(game: string, version: number | "latest") {
    return `${game}/${version}`;
  }

  info(game: string, version: number | "latest") {
    return store.state.gameDesc[this.key(game, version)];
  }

  async loadGameInfo(game: string, version: number | "latest") {
    if (this.#loading.has(this.key(game, version)) || this.info(game, version)?.viewer) {
      console.log("skip loading game info for", game, version);
      return;
    }
    try {
      this.#loading.add(this.key(game, version));

      const data = await makeAxios()
        .get(`/boardgame/${game}/info/${version}`)
        .then((r) => r.data);
      store.commit("gameDesc", { ...data, latest: version === "latest" });
    } catch (err) {
      handleError(err);
    } finally {
      this.#loading.delete(this.key(game, version));
    }
  }

  async loadAll() {
    if (this.#loadingAll || (this.infos.length > 0 && Date.now() - this.#lastUpdate.getTime() < 3600 * 1000)) {
      return;
    }
    try {
      this.#loadingAll = true;

      const games = await makeAxios()
        .get("/boardgame/info")
        .then((r) => r.data);
      const latestGames = new Set(uniqBy(sortBy(games, "_id.version").reverse(), "_id.game"));

      for (const game of games) {
        store.commit("gameDesc", { ...game, latest: latestGames.has(game) });
      }

      this.#lastUpdate = new Date();
    } catch (err) {
      handleError(err);
    } finally {
      this.#loadingAll = false;
    }
  }

  get infos() {
    return Object.values(store.state.gameDesc);
  }

  get latest() {
    return Object.keys(store.state.gameDesc)
      .filter((key) => key.endsWith("/latest"))
      .map((key) => store.state.gameDesc[key]);
  }

  #loading: Set<string> = new Set();
  #loadingAll = false;
  #lastUpdate = new Date(0);
}

export default GameInfoService;

Object.defineProperty(Vue.prototype, "$gameInfo", {
  value: new GameInfoService(),
});
