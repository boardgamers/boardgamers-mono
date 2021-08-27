import { accountLoaded, refreshToken, user } from "@/store";
import type { IUser } from "@lib/user";
import { get, post, setAccessToken } from "./rest";

export async function login(email: string, password: string) {
  return auth("/account/login", { email, password });
}

export async function logout() {
  await post("/account/signout");

  user.set(null);
}

export async function register(params: {
  email: string;
  username: string;
  password: string;
  newsletter: boolean;
  termsAndConditions: boolean;
}) {
  return auth("/account/signup", params);
}

export async function registerSocial(params: { jwt: string; username: string; termsAndConditions: boolean }) {
  return auth("/account/signup/social", params);
}

export async function resetPassword(params: { email: string; resetKey: string; password: string }) {
  return auth("/account/reset", params);
}

export async function confirmAccount(params: { key: string; email: string }) {
  return auth("/account/confirm", params);
}

async function auth(url: string, params: Record<string, unknown>) {
  const data: {
    user: IUser;
    accessToken: { code: string; expiresAt: number };
    refreshToken: { code: string; expiresAt: number };
  } = await post(url, params);

  setAuthTokens(data);
}

type AuthTokens = {
  user: IUser;
  accessToken: { code: string; expiresAt: number };
  refreshToken: { code: string; expiresAt: number };
};

export function setAuthTokens(data: AuthTokens) {
  user.set(data.user);
  refreshToken.set(data.refreshToken);
  setAccessToken(data.accessToken);
}

export async function loadAccount() {
  user.set(await get("/account"));
  accountLoaded.set(true);
}

let promise: Promise<void> | undefined;
export async function loadAccountIfNeeded() {
  if (promise) {
    return promise;
  }

  return (promise = loadAccount().catch((err) => {
    // do not keep throwing past the first call of this function
    promise = undefined;
    return Promise.reject(err);
  }));
}
