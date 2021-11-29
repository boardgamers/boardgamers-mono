import { browser } from "$app/env";
import { skipOnce } from "@/utils";
import { extractCookie } from "@/utils/extract-cookie";
import type { IUser } from "@bgs/types";
import { writable } from "svelte/store";

export const user = writable<IUser | null>(null);

export type Token = { code: string; expiresAt: number };

export const refreshToken = writable<Token | null>(
  browser
    ? extractCookie("refreshToken", document.cookie)
      ? extractCookie("refreshToken", document.cookie)
      : localStorage.getItem("refreshToken")
      ? JSON.parse(localStorage.getItem("refreshToken")!)
      : null
    : null
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
    // todo : remove when no longer relevant
    if (newVal && typeof newVal.expiresAt === "string") {
      refreshToken.set({ ...newVal, expiresAt: new Date(newVal.expiresAt).getTime() });
      return;
    }

    $refreshToken = newVal;

    if (newVal) {
      localStorage.removeItem("refreshToken"); // todo : remove when no longer relevant
      document.cookie = `refreshToken=${JSON.stringify(newVal)}; MaxAge=${
        (newVal.expiresAt - Date.now()) / 1000
      }; SameSite=Strict`;

      setTimeout(() => {
        if ($refreshToken && $refreshToken.expiresAt < Date.now()) {
          refreshToken.set(null);
        }
      }, Date.now() - newVal.expiresAt + 10);
    } else {
      document.cookie = `refreshToken=null; expires=${new Date(0).toUTCString()}; SameSite=Strict`;
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
