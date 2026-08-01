import type { PageServerLoad } from "./$types";

// Read the per-boardgame "remember my last setup" cookie server-side so the new-game
// form can render the saved options during SSR (avoiding a defaults→saved flash on hydration).
export const load: PageServerLoad = async ({ params, request }) => {
	const cookieHeader = request.headers.get("cookie") ?? "";
	const name = `new-game-setup:${params.boardgameId}`;
	const raw = cookieHeader
		.split(";")
		.map((x) => x.trim())
		.find((x) => x.startsWith(`${name}=`))
		?.slice(name.length + 1);

	let lastSetup: Record<string, unknown> | null = null;
	if (raw) {
		try {
			lastSetup = JSON.parse(decodeURIComponent(raw));
		} catch {
			lastSetup = null;
		}
	}

	return { lastSetup };
};
