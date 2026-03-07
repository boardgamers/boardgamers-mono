import { z } from "zod";

export const settingsSchema = z.object({
  _id: z.string(),
  value: z.unknown(),
});

export type SettingsDoc = z.output<typeof settingsSchema>;

export const SETTINGS_COLLECTION = "settings";

export const SettingsKey = {
  Announcement: "announcement",
  DBVersion: "dbVersion",
} as const;
