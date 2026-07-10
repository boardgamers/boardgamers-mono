import type { Context } from "koa";
import { colls } from "../../config/db.ts";
import { accessTokenDuration, createAccessToken, generateRefreshCode, isUserAdmin } from "../../models/index.ts";

export async function sendAuthInfo(ctx: Context) {
  const code = generateRefreshCode();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 120 * 24 * 3600 * 1000);

  const result = await colls.jwtRefreshTokens.insertOne({
    user: ctx.state.user._id,
    code,
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
    expiresAt: createdAt.getTime() + 120 * 24 * 3600 * 1000,
  };

  try {
    // Should not be needed as already done in the front-end code, but sveltekit has weird issues
    ctx.cookies.set("refreshToken", JSON.stringify(json), {
      httpOnly: false,
      expires: expiresAt,
      secure: true,
      sameSite: true,
    });
  } catch {
    // Happens on localhost, because of secure flag
  }

  ctx.body = {
    user: ctx.state.user,
    refreshToken: json,
    accessToken: {
      code: await createAccessToken(refreshToken, ["all"], isUserAdmin(ctx.state.user)),
      expiresAt: Date.now() + accessTokenDuration(),
    },
  };
}
