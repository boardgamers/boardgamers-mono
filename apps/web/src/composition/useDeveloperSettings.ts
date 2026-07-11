import { browser } from "$app/environment";
import { writable } from "svelte/store";

export type DevGameSettings = {
  viewerUrl: string;
};

export const developerSettings = writable<boolean>(
  browser && JSON.parse(localStorage.getItem("developerSettings") ?? "false")
);

export const devGameSettings = writable<Record<string, DevGameSettings>>(
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

export function useDeveloperSettings() {
  return { developerSettings, devGameSettings };
}
