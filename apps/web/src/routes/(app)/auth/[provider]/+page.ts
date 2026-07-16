import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { get, setApiContext } from "@/lib/api";
import { setAuthData, type AuthData } from "@/lib/auth.svelte";

export const ssr = false;

export const load: PageLoad = async ({ params, url, fetch }) => {
  setApiContext((prev) => ({ ...prev, fetch }));
  const response = await get<{ createSocialAccount: boolean } & AuthData>(
    `/account/auth/${params.provider}/callback`,
    url.searchParams
  );

  if (response.createSocialAccount) {
    throw redirect(302, "/signup?" + new URLSearchParams(response as any).toString());
  }

  setAuthData(response);
  throw redirect(302, "/account");
};
