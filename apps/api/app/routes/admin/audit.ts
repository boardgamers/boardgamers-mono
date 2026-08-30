import createError from "http-errors";
import type { Context, Next } from "koa";
import Router from "koa-router";
import { z } from "zod";
import type { AdminLogDoc } from "@bgs/models";
import { colls } from "../../config/db.ts";

// Audit trail for mutating admin actions (issue #266).
//
// Design: the middleware is the BASELINE — every successful non-GET request
// under /api/admin gets exactly one adminlogs document, written after the
// response. Routes make their event rich by calling auditLog(ctx, action,
// target, meta); a route that doesn't gets an automatic fallback event named
// "<METHOD> <path>". One write path, no dedupe bookkeeping: an explicit call
// simply replaces the fallback's action/target/meta.

export interface AuditTarget {
	kind: string;
	id: string;
	label?: string;
}

// Belt-and-braces: call sites must not pass secrets, but any key that smells
// like one is redacted anyway (recursively) before the event is stored.
const SECRET_KEY = /token|password|secret|hash|credential|confirmkey/i;
const MAX_SCRUB_DEPTH = 5;

export function scrubMeta(meta: Record<string, unknown>, depth = 0): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(meta)) {
		if (SECRET_KEY.test(key)) {
			out[key] = "[redacted]";
		} else if (Array.isArray(value)) {
			out[key] = depth < MAX_SCRUB_DEPTH ? value.map((v) => scrubValue(v, depth + 1)) : "[truncated]";
		} else if (typeof value === "object" && value !== null) {
			out[key] = scrubValue(value, depth + 1);
		} else {
			out[key] = value;
		}
	}
	return out;
}

function scrubValue(value: unknown, depth: number): unknown {
	if (depth > MAX_SCRUB_DEPTH) {
		return "[truncated]";
	}
	if (Array.isArray(value)) {
		return value.map((v) => scrubValue(v, depth + 1));
	}
	if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- plain object checked above
		return scrubMeta(value as Record<string, unknown>, depth);
	}
	return value;
}

/**
 * Stage a rich audit event for the current admin request. The audit middleware
 * persists it once the response succeeds — so a route that throws after
 * calling this logs nothing (the mutation is assumed rolled up in the error).
 */
export function auditLog(ctx: Context, action: string, target?: AuditTarget, meta?: Record<string, unknown>): void {
	ctx.state.audit = { action, target, meta };
}

const UNAUDITED_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Mounted once at the top of the /api/admin router: records every successful
 * mutating request. Failures to write the audit entry are logged but never
 * fail the request — the admin's action already happened.
 */
export async function adminAuditTrail(ctx: Context, next: Next): Promise<void> {
	// Capture the actor BEFORE the handler runs: /login-as reassigns
	// ctx.state.user to the impersonated user.
	const admin = ctx.state.user;

	await next();

	if (UNAUDITED_METHODS.has(ctx.method) || ctx.status >= 400 || !admin) {
		return;
	}

	const explicit = ctx.state.audit;
	const doc: AdminLogDoc = {
		admin: { _id: admin._id, name: admin.account.username },
		action: explicit?.action ?? `${ctx.method} ${ctx.path.replace(/^\/api\/admin/, "") || "/"}`,
		...(explicit?.target && { target: explicit.target }),
		...(explicit?.meta && { meta: scrubMeta(explicit.meta) }),
		method: ctx.method,
		path: ctx.path,
		createdAt: new Date(),
	};

	try {
		await colls.adminLogs.insertOne(doc);
	} catch (err) {
		console.error("[audit] failed to record admin action", doc.action, err);
	}
}

// -- Read side: GET /api/admin/audit-log ---------------------------------------
// Full admins only (authority === "admin"): the trail spans every admin domain
// (user mutations, tokens, newsletters, …), so scoped grantees don't get it.

export async function requireFullAdmin(ctx: Context, next: Next): Promise<void> {
	if (ctx.state.user?.authority !== "admin") {
		throw createError(403, "Full admin only");
	}
	await next();
}

const auditQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
	// Filter by acting admin (exact username), action (exact), or target id.
	admin: z.string().optional(),
	action: z.string().optional(),
	target: z.string().optional(),
});

const router = new Router<Application.DefaultState, Context>();

router.get("/", async (ctx) => {
	const { page, limit, admin, action, target } = auditQuerySchema.parse(ctx.query);
	const filter: Record<string, unknown> = {};
	if (admin) {
		filter["admin.name"] = admin;
	}
	if (action) {
		filter.action = action;
	}
	if (target) {
		filter["target.id"] = target;
	}

	const [logs, total, actions, admins] = await Promise.all([
		colls.adminLogs
			.find(filter)
			.sort({ createdAt: -1 })
			.skip((page - 1) * limit)
			.limit(limit)
			.toArray(),
		colls.adminLogs.countDocuments(filter),
		// Distinct values feed the filter dropdowns; cheap at admin-action volume.
		colls.adminLogs.distinct("action"),
		colls.adminLogs.distinct("admin.name"),
	]);

	ctx.body = {
		logs,
		total,
		page,
		limit,
		actions: actions.toSorted((a, b) => a.localeCompare(b)),
		admins: admins.toSorted((a, b) => a.localeCompare(b)),
	};
});

export default router;
