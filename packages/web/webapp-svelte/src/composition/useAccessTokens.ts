import { writable, Writable } from "svelte/store";
import { useCached } from "./useCached";
import type { Token } from "./useRefreshToken";

export function useAccessTokens(): Writable<Record<string, Token>> {
  const { cached, set } = useCached<"accessTokens", Writable<Record<string, Token>>>("accessTokens");

  if (cached) {
    return cached;
  }

  return set(writable({}));
}
