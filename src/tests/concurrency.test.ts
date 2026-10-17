import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  type Api,
  consumeUnits,
  createScenario,
  expectStatus,
  get,
  getList,
  getNumber,
  getString,
  startApi,
  uniqueId,
} from "./helpers.js";

let api: Api;
let stop: () => Promise<void>;

before(async () => {
  ({ api, stop } = await startApi());
});

after(async () => {
  await stop();
});

describe("concurrent requests", () => {
  it("never overspends a user's allowance", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 100000, maxPerRequest: 1000 },
      { ann: { monthlyAllowance: 100, maxPerRequest: 10 } },
    );
    const responses = await Promise.all(
      Array.from({ length: 30 }, () => consumeUnits(api, s, "ann", 10)),
    );
    responses.forEach((res) => expectStatus(res, 200));

    const accepted = responses.filter((res) => get(res.body, "accepted") === true);
    assert.equal(accepted.length, 10);

    const usage = await api.send("GET", "/users/ann/usage", { key: s.key });
    assert.equal(getNumber(usage.body, "user.used"), 100);
    assert.equal(getNumber(usage.body, "user.remaining"), 0);
  });

  it("never overspends the shared account allowance across users", async () => {
    const limits = { monthlyAllowance: 1000, maxPerRequest: 200 };
    const s = await createScenario(
      api,
      { monthlyAllowance: 100, maxPerRequest: 50 },
      { u1: limits, u2: limits },
    );
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        consumeUnits(api, s, i % 2 === 0 ? "u1" : "u2", 10),
      ),
    );
    responses.forEach((res) => expectStatus(res, 200));
    assert.equal(
      responses.filter((res) => get(res.body, "accepted") === true).length,
      10,
    );

    const usage = await api.send("GET", "/usage", { key: s.key });
    assert.equal(getNumber(usage.body, "account.used"), 100);
    const userTotal = getList(usage.body, "users").reduce<number>(
      (sum, user) => sum + getNumber(user, "used"),
      0,
    );
    assert.equal(userTotal, 100);
  });

  it("counts parallel retries of one request id only once", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 1000, maxPerRequest: 100 },
      { ann: { monthlyAllowance: 100, maxPerRequest: 10 } },
    );
    const requestId = uniqueId();
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => consumeUnits(api, s, "ann", 10, requestId)),
    );

    assert.ok(responses.every((res) => get(res.body, "accepted") === true));
    assert.equal(
      responses.filter((res) => get(res.body, "replayed") === false).length,
      1,
    );

    const usage = await api.send("GET", "/users/ann/usage", { key: s.key });
    assert.equal(getNumber(usage.body, "user.used"), 10);
  });

  it("keeps every total equal to the units that were accepted", async () => {
    const limits = { monthlyAllowance: 100, maxPerRequest: 10 };
    const s = await createScenario(
      api,
      { monthlyAllowance: 150, maxPerRequest: 50 },
      { u1: limits, u2: limits },
    );
    const calls = Array.from({ length: 40 }, (_, i) => ({
      userId: i % 2 === 0 ? "u1" : "u2",
      units: (i % 7) + 1,
    }));
    const responses = await Promise.all(
      calls.map((call) => consumeUnits(api, s, call.userId, call.units)),
    );

    let acceptedTotal = 0;
    const acceptedByUser: Record<string, number> = { u1: 0, u2: 0 };
    responses.forEach((res, i) => {
      expectStatus(res, 200);
      const call = calls[i];
      if (call === undefined) {
        throw new Error("Missing call");
      }
      if (get(res.body, "accepted") === true) {
        acceptedTotal += call.units;
        acceptedByUser[call.userId] = (acceptedByUser[call.userId] ?? 0) + call.units;
      }
    });

    const usage = await api.send("GET", "/usage", { key: s.key });
    const accountUsed = getNumber(usage.body, "account.used");
    assert.equal(accountUsed, acceptedTotal);
    assert.ok(accountUsed <= 150);
    for (const user of getList(usage.body, "users")) {
      const used = getNumber(user, "used");
      assert.equal(used, acceptedByUser[getString(user, "userId")]);
      assert.ok(used <= 100);
    }
  });
});
