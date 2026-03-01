import mongoose from "mongoose";

interface SettingsDocument extends mongoose.Document {
  _id: string;
  value: any;
}

const schema = new mongoose.Schema({
  _id: String,
  value: {},
});

const Settings = mongoose.model<SettingsDocument>("settings", schema);

const SettingsKey = {
  Announcement: "announcement",
  DBVersion: "dbVersion",
} as const;
export type SettingsKey = (typeof SettingsKey)[keyof typeof SettingsKey];
export { SettingsKey };

export { Settings };
