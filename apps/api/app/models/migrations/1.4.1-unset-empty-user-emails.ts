import { colls } from "../../config/db.ts";
import type { Migration } from "./index.ts";

// Social signup used to store `account.email: ""` when the OAuth provider returned
// no email. The unique sparse index on account.email only skips docs where the field
// is ABSENT — "" is indexed — so the second no-email social signup collided with the
// first (E11000, a prod 500). Signup now omits the field; this cleans up the rows
// already carrying "" so they stop sitting in the unique index.
export const migration: Migration = {
	async up() {
		await colls.users.updateMany({ "account.email": "" }, { $unset: { "account.email": "" } });
	},
};
