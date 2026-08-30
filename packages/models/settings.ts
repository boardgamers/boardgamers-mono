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
	// Site-wide chat kill switch (`value` is a ChatKillSwitchMode). Escalation
	// hatch above the per-boardgame `chatDisabled` flag: "public" stops posting
	// in every public room (game chat keeps working), "all" stops every chat
	// post/edit/reaction site-wide. History stays readable either way. Missing
	// doc = "off". Enforced in the api's shared chat handlers.
	ChatKillSwitch: "chatKillSwitch",
} as const;

export const chatKillSwitchModeSchema = z.enum(["off", "public", "all"]);
export type ChatKillSwitchMode = z.output<typeof chatKillSwitchModeSchema>;
