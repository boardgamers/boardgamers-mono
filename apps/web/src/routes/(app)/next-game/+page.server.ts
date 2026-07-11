import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { get, setApiContext } from "@/lib/api";
import { redirectLoggedIn } from "@/utils/redirect";

export const load: PageServerLoad = async ({ locals, url, fetch }) => {
  setApiContext({ fetch, ip: locals.ip });
  // Fetch account + active games server-side
  if (!locals.refreshToken) {
    throw redirect(302, redirectLoggedIn(url));
  }

  let user;
  try {
    user = await get<import("@bgs/models").UserFront>("/account");
  } catch {
    throw redirect(302, redirectLoggedIn(url));
  }

  if (!user) {
    throw redirect(302, redirectLoggedIn(url));
  }

  const games = await get<string[]>("/account/active-games").catch(() => []);

  if (games.length === 0) {
    throw redirect(302, `/user/${user.account.username}#active`);
  }

  // Note: input.params.gameId was always undefined in the old code (no [gameId] param on this route).
  // This means currentIdx is always -1, so we always advance to the next game (index 0).
  const currentIdx = games.indexOf(undefined as any);
  const gameId = games[(currentIdx + 1) % games.length];

  throw redirect(302, `/game/${gameId}`);
};
