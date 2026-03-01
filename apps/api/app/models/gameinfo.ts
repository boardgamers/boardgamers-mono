import { colls } from "../config/db.ts";

export async function findGameInfoWithVersion(game: string, version: number | "latest") {
  if (version === "latest") {
    return colls.gameInfos.findOne({ "_id.game": game }, { sort: { "_id.version": -1 } });
  }
  return colls.gameInfos.findOne({ _id: { game, version } });
}
