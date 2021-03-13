import type { IGame } from "@lib/game";
import { writable } from "svelte/store";

export const activeGames = writable<IGame[]>([]);
