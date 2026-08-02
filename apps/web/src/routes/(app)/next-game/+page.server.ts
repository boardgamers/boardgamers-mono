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

	// This route has no [gameId] param, so there's no "current" game to advance from —
	// always jump to the first active game.
	throw redirect(302, `/game/${games[0]}`);
};
