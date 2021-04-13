import { skipOnce } from "@/utils";
import type { IUser } from "@lib/user";
import { writable } from "svelte/store";

export const user = writable<IUser | null>(null);

export type Token = { code: string; expiresAt: number };

export const refreshToken = writable<Token | null>(
  localStorage.getItem("refreshToken") ? JSON.parse(localStorage.getItem("refreshToken")!) : null
);

refreshToken.subscribe((newVal) =>
  newVal ? localStorage.setItem("refreshToken", JSON.stringify(newVal)) : localStorage.removeItem("refreshToken")
);

/**
 * Access tokens by scope
 */
export const accessTokens = writable<Record<string, Token>>({});
export const accountLoaded = writable(false);

user.subscribe(
  skipOnce((newVal) => {
    if (!newVal) {
      refreshToken.set(null);
      accessTokens.set({});
    }
  })
);
