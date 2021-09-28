import type { GameInfo } from "@bgs/types";
import { writable } from "svelte/store";
import type { SetOptional } from "type-fest";

export const boardgames = writable<Record<string, SetOptional<GameInfo, "viewer">>>({});
