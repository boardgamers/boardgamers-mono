import { api } from "$lib/api.ts";
import type { ApiErrorFront } from "@bgs/models";

export interface HangsData {
	hangs: ApiErrorFront[];
	total: number;
}

// Two kinds of entries, both recorded by the game-server as apiErrors:
//  - EngineTimeoutError: a move that overran the worker-thread budget and was killed
//    (see apps/game-server/app/routes/gameplay.ts);
//  - SlowEngineCall: a main-thread engine call that completed but exceeded the slow
//    threshold — the early-warning trail before an actual freeze
//    (see apps/game-server/app/services/engine-call-context.ts).
export async function load(): Promise<HangsData> {
	const res = await api
		.get<{ errors: ApiErrorFront[]; total: number }>("/admin/errors?name=EngineTimeoutError,SlowEngineCall&limit=100")
		.catch(() => ({ errors: [], total: 0 }));
	return { hangs: res.errors, total: res.total };
}
