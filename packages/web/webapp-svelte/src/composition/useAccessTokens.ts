import { writable } from "svelte/store";
import { defineStore } from "./defineStore";
import type { Token } from "./useRefreshToken";

export const useAccessTokens = defineStore(() => {
  return writable<Record<string, Token>>({});
});
