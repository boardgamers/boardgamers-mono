/**
 * CI guard: every migration a PR *adds* must have a version strictly greater
 * than the highest migration version already on the base branch.
 *
 * Why: `migrate()` only runs a migration when `semver.gt(key, dbVersion)`. A
 * deployed DB is already stamped at the latest version, so a newly-added
 * migration keyed at or below an existing one would silently never run.
 *
 * Compares the migration registry on the current checkout against the base ref
 * (default `origin/master`, override with $BASE_REF). Works across both the old
 * single-file (`migrations.ts`) and the new per-version (`migrations/`) layouts,
 * since it just scrapes the `"x.y.z":` registry keys from whichever exists.
 */
import { execFileSync } from "node:child_process";
import semver from "semver";
import { migrations } from "../app/models/migrations/index.ts";

const BASE_REF = process.env.BASE_REF || "origin/master";

const SEMVER_KEY = /["'](\d+\.\d+\.\d+)["']\s*:/g;

function keysFromSource(source: string): string[] {
  return [...source.matchAll(SEMVER_KEY)].map((m) => m[1]);
}

function baseSource(): string | null {
  // The base branch may keep migrations in either layout; try both.
  const candidates = ["apps/api/app/models/migrations/index.ts", "apps/api/app/models/migrations.ts"];
  for (const path of candidates) {
    try {
      return execFileSync("git", ["show", `${BASE_REF}:${path}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      // not present at this path on the base ref; try the next
    }
  }
  return null;
}

function main() {
  // Ensure the base ref is available (CI checkouts are often shallow / single-branch).
  try {
    execFileSync("git", ["rev-parse", "--verify", BASE_REF], { stdio: "ignore" });
  } catch {
    try {
      execFileSync("git", ["fetch", "--no-tags", "--depth=1", "origin", BASE_REF.replace(/^origin\//, "")], {
        stdio: "ignore",
      });
    } catch {
      console.warn(`Could not resolve base ref ${BASE_REF}; skipping migration order check.`);
      return;
    }
  }

  const currentKeys = migrations.map(([key]) => key);
  const source = baseSource();

  if (source === null) {
    // No migrations on base (brand-new project / first introduction). Anything goes.
    console.log("No migrations found on base ref; nothing to check.");
    return;
  }

  const baseKeys = new Set(keysFromSource(source));
  const baseMax = [...baseKeys].reduce<string | null>((max, k) => (max && semver.gte(max, k) ? max : k), null);

  const added = currentKeys.filter((k) => !baseKeys.has(k));

  if (added.length === 0) {
    console.log("No new migrations added in this branch.");
    return;
  }

  const offenders = baseMax ? added.filter((k) => !semver.gt(k, baseMax)) : [];

  if (offenders.length > 0) {
    console.error(
      `Migration version(s) [${offenders.join(", ")}] are not greater than the latest migration on ` +
        `${BASE_REF} (${baseMax}). A migration at or below the deployed DB version will never run. ` +
        `Bump the version above ${baseMax}.`,
    );
    process.exit(1);
  }

  console.log(`OK: added migration(s) [${added.join(", ")}] are all greater than base latest (${baseMax}).`);
}

main();
