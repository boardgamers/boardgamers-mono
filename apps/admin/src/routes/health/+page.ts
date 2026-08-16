import { api } from "$lib/api.ts";
import type { ApiErrorFront } from "@bgs/models";

export type ApiErrorEntry = ApiErrorFront;

export interface DbErrorsResult {
	errors: ApiErrorEntry[];
	total: number;
	page: number;
	limit: number;
}

export interface HealthData {
	dbErrors: ApiErrorEntry[];
	dbErrorsTotal: number;
}

// Only the DB-backed data loads in `load` (fast Mongo reads). The Loki-backed
// panels (request metrics, log stream) fetch client-side in +page.svelte so the
// page renders immediately instead of hanging on Loki latency.
export async function load(): Promise<{ health: HealthData }> {
	const dbErrorsResult = await api
		.get<DbErrorsResult>("/admin/errors?page=1&limit=20")
		.catch(() => ({ errors: [], total: 0, page: 1, limit: 20 }));

	return { health: { dbErrors: dbErrorsResult.errors, dbErrorsTotal: dbErrorsResult.total } };
}
