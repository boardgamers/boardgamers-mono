import { gameInfoSchema, type GameInfoDoc } from "@bgs/models";
import { z } from "zod";

/**
 * Base URL of a public BGS API to pull game info from when seeding a local dev DB.
 * Defaults to production. Override with $seedSource, e.g.
 *   seedSource=https://www.boardgamers.space/api pnpm seed
 */
const SEED_SOURCE = process.env.seedSource || "https://www.boardgamers.space/api";

const listedGameInfosSchema = z.array(z.object({ _id: z.object({ game: z.string(), version: z.number() }) }));

/**
 * Fetch the latest *public* version of each game from a live BGS API and
 * normalize it into documents that satisfy `gameInfoSchema`.
 *
 * Strategy:
 *  - GET /boardgame/info lists every public version (but strips `viewer`).
 *  - For each distinct game we GET /boardgame/:game/info/latest, which returns
 *    the full document including `viewer`.
 *  - Each doc is parsed through `gameInfoSchema`, which drops server-only fields
 *    (`__v`, `createdAt`, `updatedAt`, ...) so the result matches our DB schema.
 *
 * Throws on any network / validation failure so the caller can fall back to the
 * committed JSON fixtures.
 */
export async function fetchGameInfos(): Promise<GameInfoDoc[]> {
  const listRes = await fetch(`${SEED_SOURCE}/boardgame/info`);
  if (!listRes.ok) {
    throw new Error(`Failed to list boardgames: ${listRes.status} ${listRes.statusText}`);
  }

  const listed = listedGameInfosSchema.parse(await listRes.json());
  const games = [...new Set(listed.map((info) => info._id.game))].sort();

  const docs = await Promise.all(
    games.map(async (game) => {
      const res = await fetch(`${SEED_SOURCE}/boardgame/${encodeURIComponent(game)}/info/latest`);
      if (!res.ok) {
        throw new Error(`Failed to fetch latest info for ${game}: ${res.status} ${res.statusText}`);
      }
      // gameInfoSchema strips unknown keys, so server-only metadata is dropped.
      return gameInfoSchema.parse(await res.json());
    }),
  );

  return docs;
}
