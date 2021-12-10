import { browser } from "$app/env";
import { writable } from "svelte/store";
import { defineStore } from "./defineStore";

export type DevGameSettings = {
  viewerUrl: string;
};

export const useDeveloperSettings = defineStore(() => {
  const developerSettings = writable<boolean>(
    browser && JSON.parse(localStorage.getItem("developerSettings") ?? "false")
  );

  const devGameSettings = writable<Record<string, DevGameSettings>>(
    browser ? JSON.parse(localStorage.getItem("devGameSettings") ?? "{}") : {}
  );

  if (browser) {
    devGameSettings.subscribe((val) => localStorage.setItem("devGameSettings", JSON.stringify(val)));

    developerSettings.subscribe((newVal) => {
      if (newVal) {
        localStorage.setItem("developerSettings", JSON.stringify(newVal));
      } else {
        localStorage.removeItem("developerSettings");
      }
    });
  }

  return { developerSettings, devGameSettings };
});
