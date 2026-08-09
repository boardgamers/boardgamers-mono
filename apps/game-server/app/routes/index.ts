import Router from "koa-router";
import gameplay from "./gameplay.ts";

const router = new Router();

// Liveness probe for the watchdog (scripts/watchdog.ts): 200 as long as the event
// loop serves HTTP. Deliberately does NOT touch the DB — a slow db must not read as
// "hung" and trigger a restart. Registered before the /api/gameplay mount so it can
// never be shadowed by a gameplay route.
router.get("/health", (ctx) => {
	ctx.body = { ok: true, uptime: process.uptime() };
});

router.use("/api/gameplay", gameplay.routes(), gameplay.allowedMethods());

export default router;
