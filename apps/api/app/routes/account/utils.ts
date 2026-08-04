import type { Context } from "koa";
import { colls } from "../../config/db.ts";
import { accessTokenDuration, createAccessToken, generateRefreshCode, isUserAdmin } from "../../models/index.ts";
import { refreshTokenDuration, setRefreshCookie } from "../../models/session.ts";

export async function sendAuthInfo(ctx: Context, loginMethod?: string) {
	const code = generateRefreshCode();
	const createdAt = new Date();
	// The social-signup strategy stashes the OAuth provider on the user it returns.
	const method = loginMethod ?? ctx.state.user?.loginMethod;

	const result = await colls.jwtRefreshTokens.insertOne({
		user: ctx.state.user._id,
		code,
		loginMethod: method,
		createdAt,
	});

	const refreshToken = {
		_id: result.insertedId,
		user: ctx.state.user._id,
		code,
		createdAt,
	};

	const json = {
		code: refreshToken.code,
		expiresAt: createdAt.getTime() + refreshTokenDuration(),
	};

	setRefreshCookie(ctx, code);

	ctx.body = {
		user: ctx.state.user,
		refreshToken: json,
		accessToken: {
			code: await createAccessToken(refreshToken, ["all"], isUserAdmin(ctx.state.user)),
			expiresAt: Date.now() + accessTokenDuration(),
		},
	};
}
