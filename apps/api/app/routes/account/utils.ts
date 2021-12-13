import { Context } from "koa";
import { JwtRefreshToken } from "../../models";

export async function sendAuthInfo(ctx: Context) {
  const refreshToken = new JwtRefreshToken({
    user: ctx.state.user._id,
  });

  await refreshToken.save();

  ctx.body = {
    user: ctx.state.user,
    refreshToken: {
      code: refreshToken.code,
      expiresAt: refreshToken.createdAt.getTime() + 120 * 24 * 3600 * 1000,
    },
    accessToken: {
      code: await refreshToken.createAccessToken(["all"], ctx.state.user.isAdmin()),
      expiresAt: Date.now() + JwtRefreshToken.accessTokenDuration(),
    },
  };
}
