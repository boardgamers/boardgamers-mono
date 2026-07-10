import { api, ApiError } from "$lib/api.ts";

interface RecentUser {
	_id: string;
	account: { username: string };
	createdAt: string;
}
interface RecentGame {
	_id: string;
	game: { name: string };
	status: string;
	lastMove: string;
	createdAt: string;
}
export interface ServerInfo {
	disk: { free: number; size: number };
	nbUsers: number;
	nbAdmins: number;
	onlineUsers: number;
	connectedUsers: number;
	games: Record<string, number>;
	queue: Record<string, number>;
	recentUsers: RecentUser[];
	recentGames: RecentGame[];
	announcement: { title: string; content: string };
	cron: boolean;
}
interface LokiInstantResult {
	status: string;
	data: {
		resultType: "vector";
		result: { metric: Record<string, string>; value: [number, string] }[];
	};
}

export interface HealthStatus {
	total: number;
	errors: number;
	level: "ok" | "warn" | "error" | "down";
}

export async function load(): Promise<{ serverInfo: ServerInfo | null; healthStatus: HealthStatus }> {
	const [serverInfo, healthStatus] = await Promise.all([
		api.get<ServerInfo>("/admin/serverinfo").catch(() => null),
		computeHealthStatus(),
	]);

	return { serverInfo, healthStatus };
}

async function computeHealthStatus(): Promise<HealthStatus> {
	try {
		const result = await api.get<LokiInstantResult>("/admin/loki/query/statusCounts");
		const counts = (result.data.result ?? []).map((r) => ({
			status: r.metric.status ?? "?",
			count: Math.round(Number(r.value[1])),
		}));
		const total = counts.reduce((a, b) => a + b.count, 0);
		const errors = counts.filter((s) => Number(s.status) >= 400).reduce((a, b) => a + b.count, 0);
		return {
			total,
			errors,
			level: total === 0 ? "ok" : errors === 0 ? "ok" : errors / total > 0.1 ? "error" : "warn",
		};
	} catch (err) {
		// 502/503 = Loki is down (not a real API error). Anything else (401, 500,
		// network) is a genuine failure — don't mask it as "Loki unavailable".
		const lokiDown = err instanceof ApiError && [502, 503].includes(err.status);
		return { total: 0, errors: 0, level: lokiDown ? "down" : "error" };
	}
}
