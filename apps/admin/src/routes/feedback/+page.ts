import { api } from "$lib/api.ts";
import type { FeedbackRequestFront, FeedbackStatus } from "@bgs/models";

export interface AdminFeedbackRequest extends Omit<FeedbackRequestFront, "requestedBy" | "status" | "likeCount"> {
	status: FeedbackStatus;
	likeCount: number;
	requestedBy?: string;
}

export async function load(): Promise<{ requests: AdminFeedbackRequest[] }> {
	const requests = await api.get<AdminFeedbackRequest[]>("/admin/feedback").catch(() => []);
	return { requests };
}
