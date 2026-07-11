import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { post } from "@/lib/api";
import { setAuthData, type AuthData } from "@/lib/auth.svelte";

export const ssr = false;

export const load: PageLoad = async ({ url }) => {
  await post<AuthData>("/account/confirm", {
    key: url.searchParams.get("key"),
    email: url.searchParams.get("email"),
  }).then(setAuthData);

  throw redirect(302, "/account");
};
