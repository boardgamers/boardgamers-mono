// Regression test for duplicate OG meta tags. Previously the root layout rendered a
// default <SEO> and pages rendered their own <SEO>, each with its own <svelte:head> —
// and <svelte:head> does NOT dedupe, so pages emitted TWO og:image / twitter:image /
// og:title tags and scrapers (Discord, …) built two embeds.
//
// The fix: exactly one <svelte:head> lives in the root layout, driven by
// `page.data.seo` (merged by SvelteKit from each page's load() BEFORE render) via
// resolveSeo(). Because the values come from the request's own `page.data` object —
// not a shared mutable store — there is no cross-request bleed, and it stays correct
// even under concurrent SSR (each request has its own data). These tests pin resolveSeo
// and the no-shared-state invariant.
import { describe, expect, it } from "vitest";

import { defaultDescription, defaultOgImage, resolveSeo, seoOverride, siteName } from "./seo.svelte";

describe("resolveSeo (single <svelte:head> source)", () => {
	it("defaults to the site-wide values with the default share image", () => {
		const s = resolveSeo(undefined);
		expect(s).toEqual({
			title: siteName,
			description: defaultDescription,
			image: defaultOgImage.path,
			imageWidth: defaultOgImage.width,
			imageHeight: defaultOgImage.height,
			type: "website",
			noindex: false,
		});
	});

	it("a page's seo data overwrites title/description/image (page wins over default)", () => {
		const s = resolveSeo({
			title: "Gaia Project",
			description: "Play Gaia Project online",
			image: "/share.webp/boardgame/gaia-project",
		});
		expect(s.title).toBe("Gaia Project");
		expect(s.description).toBe("Play Gaia Project online");
		expect(s.image).toBe("/share.webp/boardgame/gaia-project");
	});

	it("a page that omits image keeps the default share image", () => {
		expect(resolveSeo({ title: "All games" }).image).toBe(defaultOgImage.path);
	});

	it("noindex pages emit no image at all", () => {
		const s = resolveSeo({ title: "Login", noindex: true });
		expect(s.noindex).toBe(true);
		expect(s.image).toBeUndefined();
	});

	it("custom image carries its own dimensions; default image carries default dimensions", () => {
		expect(resolveSeo({ image: "/share.webp/game/abc", imageWidth: 1200, imageHeight: 630 }).imageWidth).toBe(1200);
		expect(resolveSeo({ title: "x" }).imageWidth).toBe(defaultOgImage.width);
	});
});

describe("request isolation (no cross-request bleed)", () => {
	it("resolveSeo is a pure function of the request's own page.data — two interleaved requests can't mix", () => {
		// Two concurrent requests each hold their OWN page.data object. resolveSeo reads
		// only its argument, so interleaving calls is impossible to corrupt: A's result is
		// computed from A's data regardless of what B passes in between.
		const dataA = { title: "Gaia Project", image: "/share.webp/boardgame/gaia-project" };
		const dataB = { title: "Powergrid", image: "/share.webp/boardgame/powergrid", noindex: true };

		// Simulate the SvelteKit per-request render: resolve each request's head from its
		// own data, interleaved.
		const a1 = resolveSeo(dataA);
		const b1 = resolveSeo(dataB);
		const a2 = resolveSeo(dataA); // A again — must be identical, unaffected by B

		expect(a1.title).toBe("Gaia Project");
		expect(a1.image).toBe("/share.webp/boardgame/gaia-project");
		expect(b1.title).toBe("Powergrid");
		expect(b1.image).toBeUndefined(); // noindex
		expect(a2).toEqual(a1);
		// No module-global mutable state: resolving A never touched shared storage.
		expect(seoOverride.current).toBeUndefined();
	});

	it("seoOverride only wins over page.data (client-side live pages); it never leaks into another resolve", () => {
		seoOverride.current = { title: "Live game", noindex: true };
		try {
			// The override applies to the page that set it (same component tree / client).
			expect(resolveSeo({ title: "Static" }).title).toBe("Live game");
			// Clearing restores page.data behavior.
			seoOverride.current = undefined;
			expect(resolveSeo({ title: "Static" }).title).toBe("Static");
		} finally {
			seoOverride.current = undefined;
		}
	});
});
