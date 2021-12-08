import { browser } from "$app/env";
import { handleError, skipOnce } from "@/utils";
import type { IUser } from "@bgs/types";
import { writable } from "svelte/store";
import { defineStore } from "./defineStore";
import { useAccessTokens } from "./useAccessTokens";
import { useRefreshToken } from "./useRefreshToken";
import { useRest } from "./useRest";

export const useAccount = defineStore(() => {
  const { get } = useRest();

  const p = get<IUser | null>("/account").then((val) => account.set(val), handleError);

  const account = writable<IUser | null>(null);

  const refreshToken = useRefreshToken();
  const accessTokens = useAccessTokens();

  if (browser) {
    account.subscribe(
      skipOnce((newVal) => {
        if (!newVal) {
          refreshToken.set(null);
          accessTokens.set({});
        }
      })
    );
  }

  return {
    waitForAccount: p,
    account,
  };
});
