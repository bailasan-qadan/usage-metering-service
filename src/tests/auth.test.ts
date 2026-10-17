import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import {
  type Api,
  client,
  createAccount,
  get,
  getString,
  startApi,
} from "./helpers.js";

const someId = "00000000-0000-4000-8000-000000000001";

const protectedRoutes: [method: string, path: string][] = [
  ["GET", "/account"],
  ["PUT", "/account/plan"],
  ["POST", "/users"],
  ["GET", "/users/ann"],
  ["GET", "/users/ann/usage"],
  ["PUT", "/users/ann/plan"],
  ["GET", "/plans"],
  ["POST", "/plans"],
  ["GET", `/plans/${someId}`],
  ["PATCH", `/plans/${someId}`],
  ["POST", "/consume"],
  ["GET", "/usage"],
  ["GET", "/requests"],
];

let api: Api;
let stop: () => Promise<void>;

before(async () => {
  ({ api, stop } = await startApi());
});

after(async () => {
  await stop();
});

describe("API key validation", () => {
  for (const [method, path] of protectedRoutes) {
    it(`${method} ${path} rejects a missing key`, async () => {
      const res = await api.send(method, path);
      assert.equal(res.status, 401);
      assert.equal(get(res.body, "error.code"), "missing_api_key");
    });

    it(`${method} ${path} rejects an invalid key`, async () => {
      const res = await api.send(method, path, { key: "mk_not-a-real-key" });
      assert.equal(res.status, 401);
      assert.equal(get(res.body, "error.code"), "invalid_api_key");
    });
  }

  it("rejects an empty key", async () => {
    const res = await api.send("GET", "/account", { key: "" });
    assert.equal(res.status, 401);
    assert.equal(get(res.body, "error.code"), "missing_api_key");
  });

  it("identifies the calling account from its key", async () => {
    const a = await createAccount(api, "Account A");
    const b = await createAccount(api, "Account B");

    const resA = await api.send("GET", "/account", { key: a.key });
    const resB = await api.send("GET", "/account", { key: b.key });
    assert.equal(resA.status, 200);
    assert.equal(getString(resA.body, "account.id"), a.id);
    assert.equal(getString(resB.body, "account.id"), b.id);
  });

  it("issues a key when an account is created, without needing one", async () => {
    const res = await api.send("POST", "/accounts", {
      body: { name: "New account" },
    });
    assert.equal(res.status, 201);
    assert.ok(getString(res.body, "apiKey").startsWith("mk_"));
  });

  it("stores only a hash of the key", async () => {
    const account = await createAccount(api);
    const rows =
      await client`SELECT key_hash FROM api_keys WHERE account_id = ${account.id}`;
    assert.equal(rows.length, 1);

    const stored = rows[0]?.key_hash;
    assert.notEqual(stored, account.key);
    assert.equal(stored, createHash("sha256").update(account.key).digest("hex"));
  });
});
