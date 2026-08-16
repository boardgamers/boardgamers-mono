import { z } from "zod";
import type { Jsonify } from "type-fest";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";

export const apiErrorSchema = z.object({
	_id: zObjectId().optional(),
	error: z.object({
		name: z.string(),
		message: z.string(),
		stack: z.array(z.string()),
	}),
	request: z.object({
		url: z.string(),
		method: z.string(),
		body: z.string(),
		status: z.number().optional(),
		id: z.string().optional(),
		// Request-context extras for diagnostics (e.g. secure-cookie-over-insecure):
		// how the request reached the api, behind which proxy headers.
		path: z.string().optional(),
		protocol: z.string().optional(),
		hostname: z.string().optional(),
		secure: z.boolean().optional(),
		ip: z.string().optional(),
		ips: z.array(z.string()).optional(),
		headers: z
			.object({
				"x-forwarded-proto": z.string().optional(),
				"x-forwarded-host": z.string().optional(),
				host: z.string().optional(),
				"user-agent": z.string().optional(),
				referer: z.string().optional(),
				origin: z.string().optional(),
			})
			.optional(),
	}),
	meta: z
		.object({
			source: z.string().optional(),
			userAgent: z.string().optional(),
			// Game the errored request was about (gameplay moves, /api/game/:id/… routes)
			gameId: z.string().optional(),
			release: z.string().optional(),
			// Koa app.proxy at diagnostic time (drives how ctx.ip / ctx.secure are derived)
			proxy: z.boolean().optional(),
		})
		.loose(),
	user: zObjectId().optional(),
	createdAt: zDate().optional(),
	updatedAt: zDate().optional(),
});

export type ApiErrorDoc = z.output<typeof apiErrorSchema>;
export type ApiErrorFront = Jsonify<ApiErrorDoc>;

export const API_ERRORS_COLLECTION = "apierrors";

// 100k entries ≈ 100 MB. Raising an existing capped collection's size/max
// recreates it (see ensureCappedCollection) — capped collections can't be
// resized in place, and the error history is disposable by design.
export const apiErrorsCollectionOptions = { size: 100 * 1000 * 1000, max: 100000 };

export const apiErrorIndexes: IndexDescription[] = [
	// api + game-server: admin error listing per user
	{ key: { user: 1, createdAt: -1 } },
];
