import { accessToken, accountLoaded, refreshToken, user } from "@/store";
import type { IUser } from "@lib/user";
import { get, post } from "./rest";

export async function login(email: string, password: string) {
  const data: {
    user: IUser;
    accessToken: { code: string; expiresAt: number };
    refreshToken: { code: string; expiresAt: number };
  } = await post("/account/login", { email, password });

  user.set(data.user);
  refreshToken.set(data.refreshToken);
  accessToken.set(data.accessToken);
}

export async function logout() {
  await post("/account/signout");

  user.set(null);
}

let promise: Promise<void> | undefined;
export async function loadAccountIfNeeded() {
  if (promise) {
    return promise;
  }

  return (promise = get("/account").then(
    (data) => {
      user.set(data);
      accountLoaded.set(true);
    },
    (err) => {
      // do not keep throwing past the first call of this function
      promise = undefined;
      return Promise.reject(err);
    }
  ));
}
