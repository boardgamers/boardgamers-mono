import type { Context } from "koa";
import Router from "koa-router";
import { colls } from "../../config/db.ts";
import { negotiateContentLanguage } from "../../services/language.ts";

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
	// (lang cookie, else Accept-Language), with English as the fallback when the
	// page has no row in that language.
	const lang = negotiateContentLanguage(ctx);
	let page = await colls.pages.findOne({ _id: { name: ctx.params.page, lang } });

	if (!page && lang !== "en") {
		page = await colls.pages.findOne({ _id: { name: ctx.params.page, lang: "en" } });
	}

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
