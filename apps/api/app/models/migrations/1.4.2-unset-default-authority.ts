import { colls } from "../../config/db.ts";
import type { Migration } from "./index.ts";

// makeDefaultUser used to write `authority: "user"` for every regular account. The
// field now stays ABSENT for regular users (only real roles like "admin" are stored)
// — the OAuth2 `authority` claim is emitted verbatim when present, so a stored "user"
// would leak a meaningless claim to role-scope clients. This $unsets the placeholder,
// matching the new shape. Idempotent, and only touches "user" — never admin/moderator.
export const migration: Migration = {
	async up() {
		await colls.users.updateMany({ authority: "user" }, { $unset: { authority: "" } });
	},
};
