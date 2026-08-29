import type { Context } from "koa";
import Router from "koa-router";
import { colls } from "../../config/db.ts";
import { contentLanguageCandidates, negotiateContentLanguage } from "../../services/language.ts";

const router = new Router<Application.DefaultState, Context>();

// Listing for the web sitemap: which content pages exist, without their (markdown) body.
router.get("/", async (ctx) => {
	ctx.body = await colls.pages
		.find({ "_id.lang": "en" })
		.project({ title: 1, updatedAt: 1 })
		.sort({ "_id.name": 1 })
		.toArray();
});

// Lightweight existence check (#429): one call answers "which of these page names
// exist" for every probe a page needs (the game sidebar checks <game>:rules /
// :settings / :preferences). Registered before /:page so `_exists` isn't read as a
// page name. Name-only, any language — the link target (/page/<name>) is itself
// language-negotiated at render time, so existence doesn't need the negotiation
// aggregation. Projection {_id: 1}: no markdown body over the wire.
router.get("/_exists", async (ctx) => {
	const names = (typeof ctx.query.names === "string" ? ctx.query.names : "")
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean)
		// Cap the probe list — a huge $in only ever comes from abuse, not the sidebar.
		.slice(0, 50);

	if (names.length === 0) {
		ctx.body = { exists: [] };
		return;
	}

	const rows = await colls.pages.find({ "_id.name": { $in: names } }, { projection: { _id: 1 } }).toArray();
	const found = new Set(rows.map((row) => row._id.name));
	// Preserve the request's order, de-duplicated.
	ctx.body = { exists: names.filter((name, i) => found.has(name) && names.indexOf(name) === i) };
});

router.get("/:page", async (ctx) => {
	// Language negotiation (#306): the visitor's preferred content language
	// (lang cookie, else Accept-Language), then a candidate chain — regional
	// variants both ways ("pt" ↔ "pt-BR"), English last.
	const candidates = contentLanguageCandidates(negotiateContentLanguage(ctx));
	// An exact {name, lang} key match would rely on scan order to prefer the
	// best candidate; matching on the exploded fields + aggregating keeps the
	// preference order explicit.
	const [page] = await colls.pages
		.aggregate(
			[
				{ $match: { "_id.name": ctx.params.page, "_id.lang": { $in: candidates } } },
				{ $addFields: { rank: { $indexOfArray: [candidates, "$_id.lang"] } } },
				{ $sort: { rank: 1 } },
				{ $limit: 1 },
				{ $project: { rank: 0 } },
			],
			{ allowDiskUse: false },
		)
		.toArray();

	if (page) {
		ctx.body = page;
	} // else 404
});

router.get("/:page/:lang", async (ctx) => {
	const page = await colls.pages.findOne({ _id: { name: ctx.params.page, lang: ctx.params.lang } });

	if (page) {
		ctx.body = page;
	} // else 404
});

export default router;
