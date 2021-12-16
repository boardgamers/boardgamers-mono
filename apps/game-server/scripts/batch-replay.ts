import assert from "assert";
import { batchReplay } from "../app/services/batch";

const [_tsNode, _fileName, gameName] = process.argv;

assert(gameName, "Please specify a game name to replay");

new Promise<void>(async (resolve, reject) => {
  try {
    const res = await batchReplay({ "game.name": gameName });
    console.log(res);

    resolve();
  } catch (err) {
    console.error(err);
    reject();
  }
}).then(
  () => process.exit(0),
  () => process.exit(1)
);
