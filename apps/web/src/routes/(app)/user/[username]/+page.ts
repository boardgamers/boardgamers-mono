import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { get } from "@/lib/api";
import { loadGames } from "@/lib/games.svelte";
import type { IUser } from "@bgs/models";

export const load: PageLoad = async ({ params }) => {
  const user = await get<IUser>(`/user/infoByName/${encodeURIComponent(params.username)}`);

  if (!user) {
    throw error(404, "User not found");
  }

  await Promise.all([
    loadGames({ userId: user._id, gameStatus: "active", count: 5, store: true }),
    loadGames({ userId: user._id, gameStatus: "open", count: 5, store: true }),
    loadGames({ userId: user._id, gameStatus: "ended", count: 5, store: true }),
  ]);

  return { user };
};
