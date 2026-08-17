import { colls } from "../../config/db.ts";
import type { Migration } from "./index.ts";

// Hoists the `public` flag out of `meta` to a top-level field on every
// `gameInfos` version doc (it stays version-scoped — a game can have a public
// v1 and a beta v2). Only docs still carrying `meta.public` are touched, so a
// re-run is a no-op. A doc missing `meta.public` entirely (shouldn't happen —
// the flag was required) defaults to private, the safe side for an access flag.
//
// Deploy-window tolerant: the pre-hoist code only ever writes `meta.public`
// (never top-level `public`), so a version doc created between the code deploy
// and this migration still matches the filter and is hoisted here.

export const migration: Migration = {
	async up() {
		const { modifiedCount } = await colls.gameInfos.updateMany({ "meta.public": { $exists: true } }, [
			{ $set: { public: { $ifNull: ["$meta.public", false] } } },
			{ $unset: "meta.public" },
		]);

		console.log(`hoist-public-flag: moved meta.public to top-level public on ${modifiedCount} version doc(s)`);
	},
};
