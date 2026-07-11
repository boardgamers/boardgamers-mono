import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { get as $ } from "svelte/store";
import { account, loadAccount } from "@/lib/account.svelte";
import { setRefreshToken } from "@/lib/auth.svelte";
import { redirectLoggedOut } from "@/utils/redirect";

export const ssr = false; // for refresh token query param

export const load: PageLoad = async ({ url }) => {
  const refreshTokenParam = url.searchParams.get("refreshToken");
  if (refreshTokenParam) {
    setRefreshToken(JSON.parse(refreshTokenParam));

    await loadAccount(true);
  }

  if ($(account)) {
    throw redirect(302, redirectLoggedOut(url));
  }

  return {};
};
