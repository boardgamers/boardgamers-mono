import type { UserFront } from "@bgs/models";
import { handleError } from "@/utils";
import { account } from "./stores.svelte";
import { setAuthData, clearTokens, type AuthData } from "./auth.svelte";
import { post } from "./api";

export { account };

export async function loadAccount() {
  try {
    const user = await post<UserFront | null>("/account").catch((err) => {
      if (err.status !== 401 && err.status !== 404) handleError(err);
      return null;
    });
    if (user) {
      account.set(user);
    }
  } catch {
    // ignore
  }
}

export function login(email: string, password: string) {
  return post<AuthData>("/account/login", { email, password }).then((data) => {
    setAuthData(data);
    account.set(data.user);
  });
}

export async function logout() {
  await post("/account/signout");
  account.set(null);
  clearTokens();
}

export { setAuthData, type AuthData } from "./auth.svelte";
