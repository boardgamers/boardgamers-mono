import { browser } from "$app/env";
import { handleError, skipOnce } from "@/utils";
import type { IUser } from "@bgs/types";
import { writable } from "svelte/store";
import { defineStore } from "./defineStore";
import { useAccessTokens } from "./useAccessTokens";
import { useRefreshToken } from "./useRefreshToken";
import { useRest } from "./useRest";

export type AuthData = {
  user: IUser;
  accessToken: { code: string; expiresAt: number };
  refreshToken: { code: string; expiresAt: number };
};

export const useAccount = defineStore(() => {
  const { get, setAccessToken, post } = useRest();

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

  function setAuthData(data: AuthData) {
    account.set(data.user);
    refreshToken.set(data.refreshToken);
    setAccessToken(data.accessToken);
  }

  function login(email: string, password: string) {
    return post<AuthData>("/account/login", { email, password }).then(setAuthData);
  }

  async function logout() {
    await post("/account/signout");

    account.set(null);
  }

  return {
    waitForAccount: p,
    account,
    setAuthData,
    login,
    logout,
  };
});
