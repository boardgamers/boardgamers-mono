import type { IGame } from "@lib/game";
import { writable } from "svelte/store";

export const activeGames = writable<IGame[]>([]);
export const currentGameId = writable<string | null>(null);
export const lastGameUpdate = writable<Date>(new Date(0));
export const playerStatus = writable<Array<{ _id: string; status: "online" | "offline" | "away" }>>([]);
