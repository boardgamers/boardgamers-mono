import { user } from "@/store";
import type { IUser } from "@lib/user";
import { post } from "./rest";

export async function login(email: string, password: string) {
  const data: {
    user: IUser;
    accessToken: { code: string; expiresAt: number };
    refreshToken: { code: string; expiresAt: number };
  } = await post("/account/login", { email, password });

  user.set(data.user);
}

export async function logout() {
  await post("/account/signout");

  user.set(null);
}
