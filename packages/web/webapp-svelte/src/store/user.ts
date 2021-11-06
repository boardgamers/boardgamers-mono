import { browser } from "$app/env";
import { skipOnce } from "@/utils";
import type { IUser } from "@bgs/types";
import { writable } from "svelte/store";

export const user = writable<IUser | null>(null);

export type Token = { code: string; expiresAt: number };

export const refreshToken = writable<Token | null>(
  browser && localStorage.getItem("refreshToken") ? JSON.parse(localStorage.getItem("refreshToken")!) : null
);

export const developerSettings = writable<boolean>(
  browser && localStorage.getItem("developerSettings") ? JSON.parse(localStorage.getItem("developerSettings")!) : false
);

if (browser) {
  developerSettings.subscribe((newVal) => {
    if (newVal) {
      localStorage.setItem("developerSettings", JSON.stringify(newVal));
    } else {
      localStorage.removeItem("developerSettings");
    }
  });
}

let $refreshToken: Token | null;
if (browser) {
  refreshToken.subscribe((newVal) => {
    $refreshToken = newVal;

    if (newVal) {
      localStorage.setItem("refreshToken", JSON.stringify(newVal));

      setTimeout(() => {
        if ($refreshToken && $refreshToken.expiresAt < Date.now()) {
          refreshToken.set(null);
        }
      }, Date.now() - newVal.expiresAt + 10);
    } else {
      localStorage.removeItem("refreshToken");
    }
  });
}

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
