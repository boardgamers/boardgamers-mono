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
