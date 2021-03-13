import type { GameInfo } from "@lib/gameinfo";
import { writable } from "svelte/store";

export const boardgames = writable<Record<string, Omit<GameInfo, "viewer"> & { viewer?: GameInfo["viewer"] }>>({});
