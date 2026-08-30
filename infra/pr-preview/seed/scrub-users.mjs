#!/usr/bin/env node
// Scrub users.bson for the PR-preview seed: reads raw BSON docs from stdin, keeps
// only whitelisted fields, writes BSON docs to stdout. Field paths per
// packages/models/user.ts — a whitelist so any new sensitive field added to the
// schema is dropped by default, not leaked by omission.
// mongodb resolves through the repo's pnpm store — pnpm doesn't hoist it to the
// root node_modules, so the store path is passed in and imported dynamically.
const { BSON } = await import(process.env.MONGODB_STORE);

// `account.social` and `account.socialMeta` are intentionally NOT whitelisted: provider
// account ids and public profile handles/URLs/avatar URLs identify the person, so
// previews drop them. (Copied social avatars are fine: they live in the images
// collection as regular uploads, with no link back to the provider.)
const KEEP_ACCOUNT = new Set(["username", "karma", "termsAndConditions", "avatar", "bio", "country"]);
const KEEP_SECURITY = new Set(["slug", "confirmed", "lastActive", "lastOnline", "lastSeen"]);
const KEEP_SETTINGS = new Set(["game", "home"]);
const KEEP_TOP = new Set(["_id", "createdAt", "updatedAt", "authority", "adminGrants", "meta", "__v"]);

// Every preview account logs in with the literal password "password" — previews are
// throwaway envs on sanitized data, and being able to log in as any user is the whole
// point of a preview. bcrypt hash of "password" (cost 8, matching the app's hashing),
// precomputed once so the scrub stays a pure byte transform.
const PREVIEW_PASSWORD_BCRYPT = "$2a$08$7.hw9OIKHKg.BXxREFb03us8aYbss.rubuXkYxDsVLrRDzaAWhjRe";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const buf = Buffer.concat(chunks);

const out = [];
let offset = 0;
while (offset < buf.length) {
	const size = buf.readInt32LE(offset);
	const doc = BSON.deserialize(buf.subarray(offset, offset + size));
	offset += size;

	const clean = {};
	for (const k of KEEP_TOP) if (doc[k] !== undefined) clean[k] = doc[k];
	if (doc.account) {
		clean.account = Object.fromEntries(Object.entries(doc.account).filter(([k]) => KEEP_ACCOUNT.has(k)));
		clean.account.email = `${doc.account.username ?? "user"}@preview.invalid`;
		clean.account.password = PREVIEW_PASSWORD_BCRYPT;
	}
	if (doc.security) {
		clean.security = Object.fromEntries(Object.entries(doc.security).filter(([k]) => KEEP_SECURITY.has(k)));
	}
	if (doc.settings) {
		clean.settings = Object.fromEntries(Object.entries(doc.settings).filter(([k]) => KEEP_SETTINGS.has(k)));
	}
	out.push(BSON.serialize(clean));
}
process.stdout.write(Buffer.concat(out));
