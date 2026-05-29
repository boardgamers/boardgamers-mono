import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

describe("User API — avatar", () => {
  const dicebearUserId = new ObjectId();
  const uploadUserId = new ObjectId();
  const rawPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  before(async () => {
    await colls.users.insertOne(testUser({ _id: dicebearUserId, account: { avatar: "bottts" } }));
    await colls.users.insertOne(testUser({ _id: uploadUserId, account: { avatar: "upload" } }));
    await colls.images.insertOne({
      ref: uploadUserId,
      refType: "User",
      key: "avatar",
      formats: ["64x64"],
      images: { "64x64": { mime: "image/png", raw: rawPng, size: rawPng.length } },
    });
  });

  // Guards the Koa body bug: fetch() returns a WHATWG ReadableStream, which Koa
  // can't stream and serializes as `{}`. The route buffers it instead.
  it("returns a non-empty SVG for a dicebear avatar", async () => {
    const res = await fetch(`${baseURL()}/api/user/${dicebearUserId.toHexString()}/avatar?size=64`);
    const body = await res.text();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("content-type"), "image/svg+xml");
    assert.ok(body.includes("<svg"), `expected an SVG body, got: ${body.slice(0, 80)}`);
  });

  it("returns the stored bytes for an uploaded avatar", async () => {
    const res = await fetch(`${baseURL()}/api/user/${uploadUserId.toHexString()}/avatar?size=64`);
    const body = Buffer.from(await res.arrayBuffer());

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("content-type"), "image/png");
    assert.deepStrictEqual(body, rawPng);
  });

  it("404s for an unknown user", async () => {
    const res = await fetch(`${baseURL()}/api/user/${new ObjectId().toHexString()}/avatar`);
    assert.strictEqual(res.status, 404);
  });

  after(() => db().dropDatabase());
});
