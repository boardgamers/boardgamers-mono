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

export interface HealthData {
	statusCounts: { status: string; count: number }[];
	slowEndpoints: { path: string; value: number }[];
	errorEndpoints: { path: string; value: number }[];
	recentErrors: { timestamp: number; line: string; source: string; level: string }[];
	lokiAvailable: boolean;
}

const EMPTY_HEALTH: HealthData = {
	statusCounts: [],
	slowEndpoints: [],
	errorEndpoints: [],
	recentErrors: [],
	lokiAvailable: false,
};

export async function load(): Promise<{ health: HealthData }> {
	const results = await Promise.allSettled([
		api.get<LokiInstantResult>("/admin/loki/query/statusCounts"),
		api.get<LokiInstantResult>("/admin/loki/query/slowEndpoints"),
		api.get<LokiInstantResult>("/admin/loki/query/errorEndpoints"),
		api.get<LokiRangeResult>("/admin/loki/query/recentErrors?limit=50"),
	]);

	// All four queries hit the same Loki instance. A 502/503 means Loki itself
	// is down — degrade gracefully. Any other failure (401, 500, network) is a
	// real error we should not swallow, so let it surface as a 500-ish load error.
	const lokiDown = results.some(
		(r) => r.status === "rejected" && r.reason instanceof ApiError && [502, 503].includes(r.reason.status),
	);
	if (lokiDown) {
		return { health: EMPTY_HEALTH };
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
				path: r.metric.path ?? "?",
				value: Math.round(Number(r.value[1])),
			})),
			errorEndpoints: (errors.value.data.result ?? []).map((r) => ({
				path: r.metric.path ?? "?",
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
					};
				}),
			),
		},
	};
}
