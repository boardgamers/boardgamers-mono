import removeMarkdown from "remove-markdown";
import { m } from "@/lib/i18n/messages";

export const siteName = "Boardgamers";

// Localized (#306): resolved per call so SSR renders the request's language and
// a client-side language switch updates the fallback description too.
export function defaultDescription(): string {
	return m.seo_defaultDescription();
}

// Rendered at request time by /share.webp/* (route-driven; card text comes from the db,
// never the query string, so share images can't be abused to host arbitrary text).
export const defaultOgImage = { path: "/share.webp", width: 1200, height: 630 };

export function absoluteUrl(origin: string, pathOrUrl: string): string {
	return pathOrUrl.startsWith("http") ? pathOrUrl : `${origin}${pathOrUrl}`;
}

export function stripMarkdown(markdown: string): string {
	return removeMarkdown(markdown).replace(/\s+/g, " ").trim();
}

// First sentence of a (possibly markdown) text, for OG card sub-text.
export function firstSentence(text: string, max = 140): string {
	const clean = stripMarkdown(text);
	if (!clean) {
		return "";
	}
	const match = clean.match(/^(.+?[.!?])(?:\s|$)/);
	return truncate(match?.[1] ?? clean, max);
}

export function truncate(text: string, max: number): string {
	return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

export type ShareImageTarget =
	| { kind: "home" }
	| { kind: "boardgame"; id: string }
	| { kind: "game"; id: string }
	| { kind: "user"; id: string };

/**
 * Route-based OG share-image URL. The card content is derived server-side from the
 * entity in the db (see /thumbnail/* and /share.webp/*), so callers only name the entity —
 * they can't inject arbitrary text into a branded thumbnail.
 */
export function shareImageUrl(target: ShareImageTarget): string {
	switch (target.kind) {
		case "home":
			return defaultOgImage.path;
		case "boardgame":
			return `${defaultOgImage.path}/boardgame/${encodeURIComponent(target.id)}`;
		case "game":
			return `${defaultOgImage.path}/game/${encodeURIComponent(target.id)}`;
		case "user":
			return `${defaultOgImage.path}/user/${encodeURIComponent(target.id)}`;
	}
}

// ---------------------------------------------------------------------------
// Single source of truth for the page's <head> SEO/OG meta.
//
// <svelte:head> does NOT dedupe: when both the root layout's default and a page's own
// head emitted og:title/og:image/…, scrapers (Discord, …) built two embeds. And SSR
// can't fix it reactively — it's a single depth-first pass with memoized deriveds, and
// the layout's <svelte:head> runs BEFORE the page's component init, so a layout reading
// a store/context can never see a value a child sets during render.
//
// The only model that is correct on the server (and race-free) is to drive the single
// <svelte:head> in the root layout from `page.data.seo`. SvelteKit merges each page's
// load() return value into `page.data` BEFORE render, so the page's values are present
// when the layout's head serializes — no shared mutable module state, no cross-request
// bleed (each request's data is its own object), and it stays correct even if
// options.async is enabled later.
//
// A page sets its head by returning `seo: {...}` from its load(). Pages with no load
// keep the defaults below.
// ---------------------------------------------------------------------------

export interface SeoData {
	title?: string;
	description?: string;
	/** Absolute or root-relative share-image URL. */
	image?: string;
	imageWidth?: number;
	imageHeight?: number;
	type?: "website" | "article" | "profile";
	noindex?: boolean;
}

export interface ResolvedSeo {
	title: string;
	description: string;
	image?: string;
	imageWidth?: number;
	imageHeight?: number;
	type: "website" | "article" | "profile";
	noindex: boolean;
}

function resolve(data: SeoData | undefined | null): ResolvedSeo {
	const d = data ?? {};
	const noindex = d.noindex ?? false;
	return {
		title: d.title ?? siteName,
		description: d.description ?? defaultDescription(),
		// noindex only gates the robots meta — og:image is orthogonal: a noindex page (e.g.
		// a game page) must still unfurl its share image when linked in Discord & co.
		image: d.image ?? defaultOgImage.path,
		imageWidth: d.image ? d.imageWidth : defaultOgImage.width,
		imageHeight: d.image ? d.imageHeight : defaultOgImage.height,
		type: d.type ?? "website",
		noindex,
	};
}

// Reactive client-side override for pages whose head must track live state (a game's
// status/round, e.g. StartedGame). The game layout points this at a $derived; it is
// `undefined` during SSR (SSR head comes from page.data.seo) and after leaving the page.
export const seoOverride: { current: SeoData | undefined } = $state({ current: undefined });

/**
 * The head's single source of truth: the page's `page.data.seo` (set by load(), merged
 * by SvelteKit before render → SSR-safe and race-free), with `seoOverride` winning on
 * the client for live-updating pages. Called by the root layout's <svelte:head>.
 */
export function resolveSeo(dataSeo: SeoData | undefined | null): ResolvedSeo {
	return resolve(seoOverride.current ?? dataSeo);
}
