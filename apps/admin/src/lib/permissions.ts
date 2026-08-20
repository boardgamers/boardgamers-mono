// Import from the pure submodule, not the @bgs/models barrel: the barrel
// re-exports schemas whose helpers value-import mongodb (Node-only), which
// breaks the browser bundle.
import { ADMIN_PERMISSIONS, type AdminPermission } from "@bgs/models/admin";

export type { AdminPermission };
export { ADMIN_PERMISSIONS };

export interface AdminMe {
	fullAdmin: boolean;
	permissions: string[];
	games: string[];
}

export const PERMISSION_LABELS: Record<AdminPermission, string> = {
	users: "Users",
	games: "Games (all)",
	gameinfo: "Boardgames (all)",
	pages: "Pages",
	changelog: "Changelog",
	feedback: "Feedback",
	tokens: "Admin tokens",
	serverinfo: "Server info",
	loki: "Logs (Loki)",
	newsletter: "Newsletter",
};

// Shown next to the label in the permissions UI where a grant needs a caveat.
export const PERMISSION_NOTES: Partial<Record<AdminPermission, string>> = {
	users: "can grant authority & log in as anyone — full-admin-equivalent",
	newsletter: "reserved for the upcoming newsletter-send feature",
};

export const EMPTY_ME: AdminMe = { fullAdmin: false, permissions: [], games: [] };

export function can(me: AdminMe | null | undefined, permission: AdminPermission): boolean {
	return !!me && (me.fullAdmin || me.permissions.includes(permission));
}

export function canManageGame(me: AdminMe | null | undefined, game: string): boolean {
	return (
		!!me &&
		(me.fullAdmin || me.permissions.includes("gameinfo") || me.permissions.includes("games") || me.games.includes(game))
	);
}
