import { z } from "zod";

// Global admin permissions. `authority === "admin"` on the user doc implies all
// of them; scoped admins carry a subset in `adminGrants`. `gameinfo:<gameId>`
// grants (per-boardgame admin) are NOT part of this enum — they are validated
// by gameAdminGrantSchema and only ever appear in `adminGrants`.
export const ADMIN_PERMISSIONS = [
	// FULL-ADMIN-EQUIVALENT: a "users" admin can promote anyone (incl. themselves)
	// to full admin via POST /admin/users/:id/authority, and can become any user
	// via POST /admin/login-as. Only assign to trusted operators — this is a
	// pre-existing property of login-as, not a privilege this grant adds.
	"users",
	"games",
	"gameinfo",
	"pages",
	"changelog",
	"feedback",
	"tokens",
	"serverinfo",
	"loki",
	// Gates the newsletter composer/sender routes (/api/admin/newsletter/*):
	// test-send to self, enqueueing a blast, and watching delivery progress.
	"newsletter",
] as const;

export const adminPermissionSchema = z.enum(ADMIN_PERMISSIONS);
export type AdminPermission = z.infer<typeof adminPermissionSchema>;

// Any single grant entry: a global permission or a per-boardgame `gameinfo:<id>`.
export const adminGrantSchema = z.union([adminPermissionSchema, z.string().regex(/^gameinfo:[a-z0-9-]+$/)]);
export type AdminGrant = z.infer<typeof adminGrantSchema>;

export const gameAdminGrantSchema = z.string().regex(/^gameinfo:[a-z0-9-]+$/);

export const gameAdminGrant = (game: string): AdminGrant => `gameinfo:${game}`;

export function isGameAdminGrant(grant: string): boolean {
	return grant.startsWith("gameinfo:");
}

/**
 * The game a CMS page belongs to, derived from its name: `<slug>:<topic>`
 * (e.g. `powergrid:maps`) belongs to game `<slug>`. Returns null for pages
 * with no `<slug>:` prefix — those are site-wide pages under the blanket
 * "pages" permission. Note the prefix is NOT validated against the games
 * collection here: a `foo:bar` page where `foo` is no game simply belongs to
 * no one's scope, so only blanket "pages" admins can manage it.
 */
export function pageGameSlug(pageName: string): string | null {
	const colon = pageName.indexOf(":");
	if (colon <= 0) {
		return null;
	}
	return pageName.slice(0, colon);
}

/**
 * Whether a user holding these grants may manage the given boardgame (its
 * gameinfo/versions/private-beta and its games). Full gameinfo/games admins
 * qualify, as do per-boardgame `gameinfo:<game>` grantees.
 */
export function grantsIncludeGame(grants: readonly string[], game: string): boolean {
	return grants.includes("gameinfo") || grants.includes("games") || grants.includes(gameAdminGrant(game));
}

/**
 * Whether holding `grant` lets a request past a mount requiring `permission`.
 * Equality always does; the global "games" grant also satisfies "gameinfo"
 * (the games admin manages boardgame info too); and a per-boardgame
 * `gameinfo:<game>` grant satisfies the game-scoped mounts (gameinfo/games),
 * "users" (whose router hosts the per-game beta-grant routes) and "pages"
 * (whose router hosts the game's CMS pages) — the routers behind those mounts
 * then re-check the grant against the request's target game, so the scoped
 * grant never acts blanket-wide.
 */
export function grantSatisfies(grant: string, permission: AdminPermission): boolean {
	if (grant === permission) {
		return true;
	}
	if (grant === "games" && permission === "gameinfo") {
		return true;
	}
	if (!isGameAdminGrant(grant)) {
		return false;
	}
	return permission === "gameinfo" || permission === "games" || permission === "users" || permission === "pages";
}

/**
 * Effective permission set for a user document. Full admins (authority ===
 * "admin") hold every global permission plus every per-boardgame grant;
 * everyone else holds exactly their adminGrants (empty for regular users).
 */
export function userPermissions(user: { authority?: string; adminGrants?: string[] } | null | undefined): Set<string> {
	if (user?.authority === "admin") {
		return new Set(ADMIN_PERMISSIONS);
	}
	return new Set(user?.adminGrants ?? []);
}

export function canUser(
	user: { authority?: string; adminGrants?: string[] } | null | undefined,
	permission: AdminPermission,
): boolean {
	if (!user) {
		return false;
	}
	return userPermissions(user).has(permission);
}

export function canUserManageGame(
	user: { authority?: string; adminGrants?: string[] } | null | undefined,
	game: string,
): boolean {
	if (!user) {
		return false;
	}
	if (user.authority === "admin") {
		return true;
	}
	return grantsIncludeGame(user.adminGrants ?? [], game);
}

/** True when the user holds at least one admin capability (full or scoped). */
export function hasAnyAdminAccess(user: { authority?: string; adminGrants?: string[] } | null | undefined): boolean {
	if (!user) {
		return false;
	}
	return user.authority === "admin" || (user.adminGrants?.length ?? 0) > 0;
}

/**
 * Roles exposed in the OAuth2 `roles` claim: "admin" for full admins (the
 * legacy value first-party tooling maps on), otherwise the raw grants.
 */
export function userRoles(user: { authority?: string; adminGrants?: string[] }): string[] {
	if (user.authority === "admin") {
		return ["admin"];
	}
	return [...(user.adminGrants ?? [])];
}
