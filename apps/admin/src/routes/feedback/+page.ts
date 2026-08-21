import { api } from "$lib/api.ts";
import { EMPTY_ME, type AdminMe } from "$lib/permissions.ts";
import type { FeedbackRequestFront, FeedbackStatus } from "@bgs/models";

export interface AdminFeedbackRequest extends Omit<FeedbackRequestFront, "requestedBy" | "status" | "likeCount"> {
	status: FeedbackStatus;
	likeCount: number;
	requestedBy?: string;
}

export async function load(): Promise<{ requests: AdminFeedbackRequest[]; me: AdminMe }> {
	const [requests, me] = await Promise.all([
		api.get<AdminFeedbackRequest[]>("/admin/feedback").catch(() => []),
		api.get<AdminMe>("/admin/me").catch(() => EMPTY_ME),
	]);
	return { requests, me };
}
