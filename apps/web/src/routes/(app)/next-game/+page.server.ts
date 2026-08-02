import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { get } from "@/lib/api";
import { redirectLoggedIn } from "@/utils/redirect";
import type { UserFront } from "@bgs/models";

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.refreshToken) {
		throw redirect(302, redirectLoggedIn(url));
	}

	let user: UserFront | null;
	try {
		user = await get<UserFront | null>("/account");
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

	// This route has no [gameId] param, so there's no "current" game to advance from —
	// always jump to the first active game.
	throw redirect(302, `/game/${games[0]}`);
};
