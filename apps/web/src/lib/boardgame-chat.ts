/**
 * FAB visibility for the per-boardgame chat room (#91): mirror of the api's room
 * validator (apps/api services/chatroom.ts), evaluated on what the client knows.
 *
 * `versions` is every entry of THIS boardgame the current user got from
 * /boardgame/info — public versions plus their own beta-grant version. The room
 * is accessible when:
 *
 * - ANY listed version is public — for a beta grantee the picked-latest version can be
 *   their private grant while older public versions exist; the room is public all the
 *   same (same "any version public" collapse as heroGames, #427), or
 * - the user is logged in and can see a version at all: a non-public entry in their
 *   list means a beta grant (or admin-granted access), and the api opens a fully-private
 *   boardgame's room to exactly those users.
 *
 * Logged-out on a fully-private boardgame never reaches this check (the page 404s),
 * but return false defensively — the api would 404 the room.
 */
export function chatRoomAccessible(versions: ReadonlyArray<{ public?: boolean }>, loggedIn: boolean): boolean {
	return versions.some((version) => version.public) || (loggedIn && versions.length > 0);
}
