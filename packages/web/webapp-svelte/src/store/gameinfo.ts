import type { GameInfo } from "@shared/types/gameinfo";
import { writable } from "svelte/store";
import type { SetOptional } from "type-fest";

export const boardgames = writable<Record<string, SetOptional<GameInfo, "viewer">>>({});
