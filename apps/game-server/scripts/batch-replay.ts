import assert from "node:assert";
import { batchReplay } from "../app/services/batch.ts";

const [_tsNode, _fileName, gameName] = process.argv;

assert(gameName, "Please specify a game name to replay");

async function run() {
  try {
    const res = await batchReplay({ "game.name": gameName });
    console.log(res);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

void run();
