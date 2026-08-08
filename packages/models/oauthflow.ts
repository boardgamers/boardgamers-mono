import { z } from "zod";
import type { IndexDescription } from "mongodb";

/**
 * Server-side state for an in-flight social OAuth flow (PKCE handshake or pending
 * social signup). Single-use, short-lived. Stored in Mongo so the flow survives
 * process restarts and works across PM2 workers (the predecessor was a per-process
 * in-memory Map — see apps/api WORKAROUNDS.md).
 *
 * Verifiers and pending signups are NOT personal data — they are single-use and
 * expire within minutes (TTL index below).
 */
export const oauthFlowSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("oauth-state"),
		/** Random handle, also sent as the OAuth `state` param (indexed, single-use). */
		_id: z.string(),
		codeVerifier: z.string(),
		expiresAt: z.date(),
	}),
	z.object({
		kind: z.literal("pending-signup"),
		/** One-time ticket in the /signup?ticket=… redirect. */
		_id: z.string(),
		provider: z.string(),
		socialId: z.string(),
		socialMeta: z.object({ username: z.string(), url: z.string() }).optional(),
		expiresAt: z.date(),
	}),
]);

export type OAuthFlowDoc = z.output<typeof oauthFlowSchema>;

export const OAUTH_FLOWS_COLLECTION = "oauthflows";

export const oauthFlowIndexes: IndexDescription[] = [
	// auto-expire all flow state shortly after its own deadline
	{ key: { expiresAt: 1 }, expireAfterSeconds: 600 },
];
