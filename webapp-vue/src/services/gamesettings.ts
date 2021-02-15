import { handleError } from "@/utils";
import { GamePreferences } from "@lib/gamepreferences";
import { AxiosError } from "axios";
import Vue from "vue";
import { makeAxios } from "../plugins/axios";
import store from "../store";

class GameSettingsService {
  settings(game: string) {
    return store.state.gameSettings[game];
  }

  augment(info: GamePreferences) {
    // @ts-ignore
    info.access = info.access ?? {
      ownership: false,
    };

    info.preferences = info.preferences ?? {};

    return info;
  }

  async loadSettings(game: string) {
    if (this.#loading.has(game) || this.settings(game)) {
      return;
    }
    try {
      this.#loading.add(game);

      const data = store.state.user
        ? await makeAxios()
            .get(`account/games/${game}/settings`)
            .then((r) => r.data)
        : { game };
      store.commit("gameSettings", this.augment(data));
    } catch (err) {
      handleError(err);
    } finally {
      this.#loading.delete(game);
    }
  }

  async loadAll() {
    if (this.#loadingAll || (this.allSettings.length > 0 && Date.now() - this.#lastUpdate.getTime() < 3600 * 1000)) {
      return;
    }
    try {
      this.#loadingAll = true;

      const games = await makeAxios()
        .get("/account/games/settings")
        .then((r) => r.data);

      for (const game of games) {
        store.commit("gameSettings", this.augment(game));
      }

      this.#lastUpdate = new Date();
    } catch (err) {
      if ((err as AxiosError).isAxiosError && (err as AxiosError).response?.status === 401) {
        return;
      }
      handleError(err);
    } finally {
      this.#loadingAll = false;
    }
  }

  get allSettings() {
    return Object.values(store.state.gameSettings);
  }

  #loading: Set<string> = new Set();
  #loadingAll = false;
  #lastUpdate = new Date(0);
}

export default GameSettingsService;

Object.defineProperty(Vue.prototype, "$gameSettings", {
  value: new GameSettingsService(),
});
