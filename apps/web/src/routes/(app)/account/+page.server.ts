import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { redirectLoggedIn } from "@/utils/redirect";

export const load: PageServerLoad = async ({ parent, url }) => {
  const { user } = await parent();

  if (!user) {
    throw redirect(302, redirectLoggedIn(url));
  }

  return {};
};
