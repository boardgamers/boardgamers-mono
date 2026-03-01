import { before, describe, it } from "node:test";
import { db } from "../app/config/db.ts";
import { setup } from "../app/config/test-setup.ts";
import { seed } from "./seed.ts";

describe("Seed", () => {
  before(async () => {
    await setup();
    await db().dropDatabase();
  });

  it("should seed with no problems", async () => {
    await seed();
  });
});
