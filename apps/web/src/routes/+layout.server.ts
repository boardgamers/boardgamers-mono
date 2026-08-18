import type { LayoutServerLoad } from "./$types";
import { get } from "@/lib/api";
import type { UserFront } from "@bgs/models";

export const load: LayoutServerLoad = async ({ locals }) => {
	let user: UserFront | null = null;
	let activeGames: string[] = [];

	// Only when the request presents a session cookie — skips the API roundtrip for anon
	// visitors. `get` resolves the request's event.fetch (via getRequestEvent), inheriting
	// the cookie — request-scoped, no shared token state, no cross-request leak.
	if (locals.refreshToken) {
		user = await get<UserFront | null>("/account").catch(() => null);
		if (user) {
			activeGames = await get<string[]>("/account/active-games").catch(() => []);
		}
	}

	return {
		user,
		activeGames,
		sidebarOpen: locals.sidebarOpen,
		// Validated in hooks (tz cookie → IANA zone, "UTC" fallback) — serialized
		// to the client so the layout provides the same zone on both sides (#339).
		timezone: locals.timezone,
		// Cookie presence (validity unknown) — seeds the client's mint gate before the
		// validated `user` is applied (see +layout.ts / api.ts#setClientSessionKnown).
		hasCookie: !!locals.refreshToken,
	};
};
