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

export enum SettingsKey {
  Announcement = "announcement",
  DBVersion = "dbVersion",
}

export { Settings };
