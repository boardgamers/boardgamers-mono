export interface SettingsDoc {
  _id: string;
  value: unknown;
}

export const SETTINGS_COLLECTION = "settings";

export const SettingsKey = {
  Announcement: "announcement",
  DBVersion: "dbVersion",
} as const;
export type SettingsKey = (typeof SettingsKey)[keyof typeof SettingsKey];
