import { after, before } from "node:test";
import { setup, teardown } from "./test-setup.ts";

before(() => setup());
after(() => teardown());
