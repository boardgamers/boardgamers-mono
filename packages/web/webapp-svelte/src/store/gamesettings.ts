import { browser } from "$app/env";
import type { GamePreferences } from "@bgs/types";
import { get as $, writable } from "svelte/store";
import { user } from "./useUserser";

export const gameSettings = writable<Record<string, GamePreferences>>({});

// Reset gamesettings each time user changes
let $userId = $(user)?._id;
user.subscribe((user) => {
  if ($userId === user?._id) {
    return;
  }
  $userId = user?._id;
  gameSettings.set({});
});

export type DevGameSettings = {
  viewerUrl: string;
};

export const devGameSettings = writable<Record<string, DevGameSettings>>(
  browser ? JSON.parse(localStorage.getItem("devGameSettings") ?? "{}") : {}
);

if (browser) {
  devGameSettings.subscribe((val) => localStorage.setItem("devGameSettings", JSON.stringify(val)));
}
