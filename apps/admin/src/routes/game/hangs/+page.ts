import { api } from "$lib/api.ts";
import type { ApiErrorFront } from "@bgs/models";

export interface HangsData {
	hangs: ApiErrorFront[];
	total: number;
}

// Engine hangs/timeouts, recorded by the game-server as apiErrors with
// error.name = "EngineTimeoutError" (see apps/game-server/app/routes/gameplay.ts).
export async function load(): Promise<HangsData> {
	const res = await api
		.get<{ errors: ApiErrorFront[]; total: number }>("/admin/errors?name=EngineTimeoutError&limit=100")
		.catch(() => ({ errors: [], total: 0 }));
	return { hangs: res.errors, total: res.total };
}
