import { browser } from "$app/env";
import { writable } from "svelte/store";

export const developerSettings = writable<boolean>(
  browser && JSON.parse(localStorage.getItem("developerSettings") ?? "false")
);

if (browser) {
  developerSettings.subscribe((newVal) => {
    if (newVal) {
      localStorage.setItem("developerSettings", JSON.stringify(newVal));
    } else {
      localStorage.removeItem("developerSettings");
    }
  });
}
