import { Context } from "koa";
import { JwtRefreshToken } from "../../models";

export async function sendAuthInfo(ctx: Context) {
  const refreshToken = new JwtRefreshToken({
    user: ctx.state.user._id,
  });

  await refreshToken.save();

  const json = {
    code: refreshToken.code,
    expiresAt: refreshToken.createdAt.getTime() + 120 * 24 * 3600 * 1000,
  };

  try {
    // Should not be needed as already done in the front-end code, but sveltekit has weird issues
    ctx.cookies.set("refreshToken", JSON.stringify(json), {
      httpOnly: false,
      expires: refreshToken.expiresAt,
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
      code: await refreshToken.createAccessToken(["all"], ctx.state.user.isAdmin()),
      expiresAt: Date.now() + JwtRefreshToken.accessTokenDuration(),
    },
  };
}
