import Router from "koa-router";
import gameplay from "./gameplay";

const router = new Router();

router.use("/api/gameplay", gameplay.routes(), gameplay.allowedMethods());

export default router;
