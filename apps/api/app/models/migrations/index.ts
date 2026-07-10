import { SettingsKey } from "@bgs/models";
import semver from "semver";
import { colls } from "../../config/db.ts";
import { migration as restructureGameDocuments } from "./1.0.0-restructure-game-documents.ts";
import { migration as gamesStatusAndPlayerData } from "./1.1.0-games-status-and-player-data.ts";
import { migration as recalculateUserKarma } from "./1.2.0-recalculate-user-karma.ts";
import { migration as addCurrentPlayers } from "./1.3.0-add-current-players.ts";
import { migration as addUserSlugs } from "./1.3.1-add-user-slugs.ts";

export type Migration = {
  up(): Promise<void>;
};

// Keyed by the version they migrate the DB *to*. Each lives in its own
// `<version>.ts` file; register new ones here.
const migrationMap: Record<string, Migration> = {
  "1.0.0": restructureGameDocuments,
  "1.1.0": gamesStatusAndPlayerData,
  "1.2.0": recalculateUserKarma,
  "1.3.0": addCurrentPlayers,
  "1.3.1": addUserSlugs,
};

export const migrations: [string, Migration][] = Object.entries(migrationMap).sort(([a], [b]) => semver.compare(a, b));

const latestMigration = migrations.length ? migrations[migrations.length - 1][0] : "0.1.0";

export async function migrate() {
  const dbVersionDoc = await colls.settings.findOne({ _id: SettingsKey.DBVersion });

  if (!dbVersionDoc) {
    console.log("fresh database detected, skipping historical migrations and stamping version", latestMigration);
    await colls.settings.updateOne(
      { _id: SettingsKey.DBVersion },
      { $set: { value: latestMigration } },
      { upsert: true },
    );
    return;
  }

  let currentVersion = typeof dbVersionDoc.value === "string" ? dbVersionDoc.value : "0.1.0";

  for (const [key, migration] of migrations) {
    if (semver.gt(key, currentVersion)) {
      console.log("running migration for", key);
      await migration.up();

      await colls.settings.updateOne({ _id: SettingsKey.DBVersion }, { $set: { value: key } }, { upsert: true });
      currentVersion = key;

      console.log("migration done");
    }
  }
}
