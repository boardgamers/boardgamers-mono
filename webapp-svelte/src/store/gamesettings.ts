import { skipOnce } from "@/utils";
import type { GamePreferences } from "@lib/gamepreferences";
import { writable } from "svelte/store";
import { user } from "./user";

export const gameSettings = writable<Record<string, GamePreferences>>({});

// Reset gamesettings each time user changes
user.subscribe(skipOnce(() => gameSettings.set({})));
