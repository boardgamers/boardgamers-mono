import { z } from "zod";
import { zDate } from "./helpers.ts";

export const announcementSchema = z.object({
	title: z.string(),
	content: z.string(),
});

export type Announcement = z.output<typeof announcementSchema>;

export const settingsSchema = z.object({
	_id: z.string(),
	value: z.unknown(),
	createdAt: zDate().optional(),
	updatedAt: zDate().optional(),
});

export type SettingsDoc = z.output<typeof settingsSchema>;

export const SETTINGS_COLLECTION = "settings";

export const SettingsKey = {
	Announcement: "announcement",
	DBVersion: "dbVersion",
	// Last time the dead-user cleanup ran (ISO string in `value`) — lets the cron
	// survive restarts/deploys instead of counting 24h from process boot.
	CleanupDeadUsersLastRun: "cleanupDeadUsersLastRun",
} as const;
