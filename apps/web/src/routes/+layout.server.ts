import type { LayoutServerLoad } from "./$types";
import { setApiContext, get, post } from "@/lib/api";
import { setRefreshToken } from "@/lib/auth.svelte";
import type { IUser } from "@bgs/models";

export const load: LayoutServerLoad = async ({ locals, fetch, cookies }) => {
  // Set the API context for server-side fetches (IP forwarding, etc.)
  setApiContext({ fetch, ip: locals.ip });

  // Seed the refresh token from the cookie
  if (locals.refreshToken) {
    setRefreshToken(locals.refreshToken);
  }

  let user: IUser | null = null;
  let activeGames: string[] = [];

  if (locals.refreshToken) {
    try {
      user = await get<IUser | null>("/account").catch(() => null);
      if (user) {
        activeGames = await get<string[]>("/account/active-games").catch(() => []);
      }
    } catch {
      // Token invalid/expired — leave user as null
    }
  }

  return {
    user,
    activeGames,
    sidebarOpen: locals.sidebarOpen,
  };
};
