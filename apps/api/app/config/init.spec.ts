import { after, before, describe, it } from "node:test";
import { setup, teardown } from "./test-setup.ts";

describe("Test setup", () => {
  before(() => setup());
  after(() => teardown());

  it("should initialize the test environment", () => {});
});
