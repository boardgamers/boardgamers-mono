import type { GamePreferences } from "@lib/gamepreferences";
import { get as $, writable } from "svelte/store";
import { user } from "./user";

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
