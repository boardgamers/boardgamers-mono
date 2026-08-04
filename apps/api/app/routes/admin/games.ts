import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { colls } from "../../config/db.ts";

const router = new Router<Application.DefaultState, Context>();

router.get("/:gameId", async (ctx) => {
	const game = await colls.games.findOne({ _id: ctx.params.gameId });
	if (!game) {
		throw createError(404, "Game not found: " + ctx.params.gameId);
	}

	const userIds = [...new Set([game.creator, ...game.players.map((pl) => pl._id)])];
	const [users, chat, errors, logs] = await Promise.all([
		colls.users.find({ _id: { $in: userIds } }, { projection: { "account.username": 1 } }).toArray(),
		colls.chatMessages.find({ room: game._id }).sort({ _id: 1 }).limit(200).toArray(),
		colls.apiErrors
			.find({ "request.url": { $regex: game._id } }, { sort: { createdAt: -1 }, limit: 10 })
			.toArray(),
		colls.logs.find({ "data.game": game._id }).sort({ createdAt: -1 }).limit(20).toArray(),
	]);

	const usernames = new Map(users.map((u) => [u._id.toString(), u.account.username]));

	const { data: _data, ...gameData } = game;
	ctx.body = {
		game: gameData,
		usernames: Object.fromEntries(usernames),
		chat,
		errors,
		logs,
	};
});

export default router;
