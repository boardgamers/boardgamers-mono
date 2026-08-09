import type { Context, Next } from "koa";
import { colls } from "../../config/db.ts";
import {
	accessTokenDuration,
	createAccessToken,
	generateRefreshCode,
	hashRefreshCode,
	isUserAdmin,
} from "../../models/index.ts";
import { refreshTokenDuration, setRefreshCookie } from "../../models/session.ts";

// Usable as route middleware (ctx, next) — the next param doubles as loginMethod in internal calls.
export async function sendAuthInfo(ctx: Context, loginMethodOrNext?: string | Next): Promise<void> {
	const loginMethod = typeof loginMethodOrNext === "string" ? loginMethodOrNext : undefined;
	const code = generateRefreshCode();
	const createdAt = new Date();
	// The social-signup strategy stashes the OAuth provider on the user it returns.
	const method = loginMethod ?? ctx.state.user?.loginMethod;

	// Only the code's hash is stored — the raw code is the session credential (cookie
	// + response body below) and a db read must not hand out live sessions (#164).
	await colls.jwtRefreshTokens.insertOne({
		user: ctx.state.user._id,
		codeHash: hashRefreshCode(code),
		loginMethod: method,
		createdAt,
	});

	const json = {
		code,
		expiresAt: createdAt.getTime() + refreshTokenDuration(),
	};

	setRefreshCookie(ctx, code);

	ctx.body = {
		user: ctx.state.user,
		refreshToken: json,
		accessToken: {
			code: await createAccessToken({ user: ctx.state.user._id, createdAt }, ["all"], isUserAdmin(ctx.state.user)),
			expiresAt: Date.now() + accessTokenDuration(),
		},
	};
}
