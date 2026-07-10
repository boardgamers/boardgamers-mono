import { api, ApiError } from "$lib/api.ts";

interface LokiInstantResult {
	status: string;
	data: {
		resultType: "vector";
		result: { metric: Record<string, string>; value: [number, string] }[];
	};
}
interface LokiRangeResult {
	status: string;
	data: {
		resultType: "matrix" | "streams";
		result: { metric: Record<string, string>; values: [number, string][] }[];
	};
}

export interface ApiErrorEntry {
	_id: string;
	error: { name: string; message: string };
	request: { method: string; url: string; status?: number; id?: string };
	user?: string | null;
	createdAt?: string;
}

export interface DbErrorsResult {
	errors: ApiErrorEntry[];
	total: number;
	page: number;
	limit: number;
}

export interface HealthData {
	statusCounts: { status: string; count: number }[];
	slowEndpoints: { route: string; value: number }[];
	errorEndpoints: { route: string; value: number }[];
	recentErrors: {
		timestamp: number;
		line: string;
		source: string;
		level: string;
		status?: string;
		path?: string;
		route?: string;
		ip?: string;
		requestId?: string;
	}[];
	dbErrors: ApiErrorEntry[];
	dbErrorsTotal: number;
	lokiAvailable: boolean;
}

const EMPTY_HEALTH: HealthData = {
	statusCounts: [],
	slowEndpoints: [],
	errorEndpoints: [],
	recentErrors: [],
	dbErrors: [],
	dbErrorsTotal: 0,
	lokiAvailable: false,
};

export async function load(): Promise<{ health: HealthData }> {
	const results = await Promise.allSettled([
		api.get<LokiInstantResult>("/admin/loki/query/statusCounts"),
		api.get<LokiInstantResult>("/admin/loki/query/slowEndpoints"),
		api.get<LokiInstantResult>("/admin/loki/query/errorEndpoints"),
		api.get<LokiRangeResult>("/admin/loki/query/recentErrors?limit=50"),
	]);
	// DB errors are independent of Loki — always fetch them (page 1).
	const dbErrorsResult = await api
		.get<DbErrorsResult>("/admin/errors?page=1&limit=20")
		.catch(() => ({ errors: [], total: 0, page: 1, limit: 20 }));

	// All four queries hit the same Loki instance. A 502/503 means Loki itself
	// is down — degrade gracefully. Any other failure (401, 500, network) is a
	// real error we should not swallow, so let it surface as a 500-ish load error.
	const lokiDown = results.some(
		(r) => r.status === "rejected" && r.reason instanceof ApiError && [502, 503].includes(r.reason.status),
	);
	if (lokiDown) {
		return { health: { ...EMPTY_HEALTH, dbErrors: dbErrorsResult.errors, dbErrorsTotal: dbErrorsResult.total } };
	}

	if (!results.every((r) => r.status === "fulfilled")) {
		// Non-Loki error — rethrow so SvelteKit shows its error page.
		const failed = results.find((r) => r.status === "rejected");
		throw failed?.status === "rejected" ? failed.reason : new Error("Unknown load failure");
	}

	// Guard above ensures all four are fulfilled; narrow to the value branch.
	const fulfilled = results as PromiseFulfilledResult<LokiInstantResult | LokiRangeResult>[];
	const status = fulfilled[0] as PromiseFulfilledResult<LokiInstantResult>;
	const slow = fulfilled[1] as PromiseFulfilledResult<LokiInstantResult>;
	const errors = fulfilled[2] as PromiseFulfilledResult<LokiInstantResult>;
	const logs = fulfilled[3] as PromiseFulfilledResult<LokiRangeResult>;

	return {
		health: {
			lokiAvailable: true,
			statusCounts: (status.value.data.result ?? []).map((r) => ({
				status: r.metric.status ?? "?",
				count: Math.round(Number(r.value[1])),
			})),
			slowEndpoints: (slow.value.data.result ?? []).map((r) => ({
						route: r.metric.route ?? r.metric.path ?? "?",
						value: Math.round(Number(r.value[1])),
					})),
					errorEndpoints: (errors.value.data.result ?? []).map((r) => ({
						route: r.metric.route ?? r.metric.path ?? "?",
						value: Math.round(Number(r.value[1])),
					})),
			recentErrors: (logs.value.data.result ?? []).flatMap((stream) =>
				(stream.values ?? []).map(([ts, line]) => {
					let parsed: Record<string, unknown> = {};
					try {
						parsed = JSON.parse(line);
					} catch {
						// non-JSON line (morgan format, stack trace)
					}
					return {
						timestamp: ts,
						line: typeof parsed.msg === "string" ? (parsed as { msg: string }).msg : line,
						source: (parsed.source as string) ?? stream.metric.source ?? "?",
						level: (parsed.level as string) ?? stream.metric.level ?? "?",
						status: parsed.status != null ? String(parsed.status) : undefined,
						path: (parsed.path as string) ?? undefined,
											route: (parsed.route as string) ?? undefined,
											ip: (parsed.ip as string) ?? undefined,
						requestId: (parsed.requestId as string) ?? undefined,
					};
				}),
			),
			dbErrors: dbErrorsResult.errors,
					dbErrorsTotal: dbErrorsResult.total,
				},
				};
			}
