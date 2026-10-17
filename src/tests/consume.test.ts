import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  type Api,
  consumeUnits,
  createScenario,
  createUser,
  expectAccepted,
  expectStatus,
  get,
  getNumber,
  planIdOf,
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

describe("consuming units", () => {
  it("accepts a request that fits both plans and counts it at both levels", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 100, maxPerRequest: 50 },
      { ann: { monthlyAllowance: 60, maxPerRequest: 20 } },
    );
    const res = await consumeUnits(api, s, "ann", 10);
    expectStatus(res, 200);
    assert.equal(get(res.body, "accepted"), true);
    assert.equal(get(res.body, "rejection"), null);
    assert.equal(get(res.body, "replayed"), false);
    assert.equal(get(res.body, "account.used"), 10);
    assert.equal(get(res.body, "account.remaining"), 90);
    assert.equal(get(res.body, "user.used"), 10);
    assert.equal(get(res.body, "user.remaining"), 50);
  });

  it("rejects a request above the user's per-request limit even when both allowances have room", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 100, maxPerRequest: 50 },
      { ann: { monthlyAllowance: 60, maxPerRequest: 20 } },
    );
    const res = await consumeUnits(api, s, "ann", 25);
    expectStatus(res, 200);
    assert.equal(get(res.body, "accepted"), false);
    assert.equal(get(res.body, "rejection.level"), "user");
    assert.equal(get(res.body, "rejection.rule"), "max_per_request");
  });

  it("rejects a request above the account's per-request limit", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 1000, maxPerRequest: 30 },
      { ann: { monthlyAllowance: 1000, maxPerRequest: 100 } },
    );
    const res = await consumeUnits(api, s, "ann", 40);
    assert.equal(get(res.body, "accepted"), false);
    assert.equal(get(res.body, "rejection.level"), "account");
    assert.equal(get(res.body, "rejection.rule"), "max_per_request");
  });

  it("rejects when the user's own monthly allowance is used up", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 1000, maxPerRequest: 100 },
      { ann: { monthlyAllowance: 30, maxPerRequest: 20 } },
    );
    expectAccepted(await consumeUnits(api, s, "ann", 20));
    const res = await consumeUnits(api, s, "ann", 20);
    assert.equal(get(res.body, "accepted"), false);
    assert.equal(get(res.body, "rejection.level"), "user");
    assert.equal(get(res.body, "rejection.rule"), "monthly_allowance");
    assert.equal(get(res.body, "user.used"), 20);
  });

  it("rejects when the shared account allowance is short, even though the user has plenty", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 100, maxPerRequest: 50 },
      { ann: { monthlyAllowance: 1000, maxPerRequest: 200 } },
    );
    expectAccepted(await consumeUnits(api, s, "ann", 50));
    expectAccepted(await consumeUnits(api, s, "ann", 45));

    const res = await consumeUnits(api, s, "ann", 10);
    assert.equal(get(res.body, "accepted"), false);
    assert.equal(get(res.body, "rejection.level"), "account");
    assert.equal(get(res.body, "rejection.rule"), "monthly_allowance");
    assert.equal(get(res.body, "account.remaining"), 5);
    assert.equal(get(res.body, "user.used"), 95);
  });

  it("consumes nothing on a rejection, but records it", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 100, maxPerRequest: 50 },
      { ann: { monthlyAllowance: 60, maxPerRequest: 20 } },
    );
    await consumeUnits(api, s, "ann", 25);

    const usage = await api.send("GET", "/usage", { key: s.key });
    assert.equal(getNumber(usage.body, "account.used"), 0);
    assert.equal(get(usage.body, "users.0.used"), 0);

    const history = await api.send("GET", "/requests", { key: s.key });
    assert.equal(getNumber(history.body, "pagination.total"), 1);
    assert.equal(get(history.body, "requests.0.accepted"), false);
  });

  it("keeps separate usage totals for users sharing one plan", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 1000, maxPerRequest: 100 },
      { ann: { monthlyAllowance: 100, maxPerRequest: 10 } },
    );
    await createUser(api, s, "ben", planIdOf(s, "ann"));
    expectAccepted(await consumeUnits(api, s, "ann", 10));

    const ann = await api.send("GET", "/users/ann/usage", { key: s.key });
    const ben = await api.send("GET", "/users/ben/usage", { key: s.key });
    const account = await api.send("GET", "/usage", { key: s.key });
    assert.equal(getNumber(ann.body, "user.used"), 10);
    assert.equal(getNumber(ben.body, "user.used"), 0);
    assert.equal(getNumber(account.body, "account.used"), 10);
  });

  it("answers a retry with the original decision and counts it once", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 100, maxPerRequest: 50 },
      { ann: { monthlyAllowance: 60, maxPerRequest: 20 } },
    );
    const requestId = uniqueId();
    const first = await consumeUnits(api, s, "ann", 10, requestId);
    const retry = await consumeUnits(api, s, "ann", 10, requestId);

    assert.equal(get(first.body, "replayed"), false);
    assert.equal(get(retry.body, "replayed"), true);
    assert.equal(get(retry.body, "accepted"), true);
    assert.equal(get(retry.body, "account.used"), 10);

    const history = await api.send("GET", "/requests", { key: s.key });
    assert.equal(getNumber(history.body, "pagination.total"), 1);
  });

  it("replays a rejected request as rejected, while a new id can succeed", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 1000, maxPerRequest: 100 },
      { ann: { monthlyAllowance: 20, maxPerRequest: 20 } },
    );
    expectAccepted(await consumeUnits(api, s, "ann", 20));
    const rejectedId = uniqueId();
    const rejected = await consumeUnits(api, s, "ann", 5, rejectedId);
    assert.equal(get(rejected.body, "accepted"), false);

    expectStatus(
      await api.send("PATCH", `/plans/${planIdOf(s, "ann")}`, {
        key: s.key,
        body: { monthlyAllowance: 100 },
      }),
      200,
    );

    const replay = await consumeUnits(api, s, "ann", 5, rejectedId);
    assert.equal(get(replay.body, "replayed"), true);
    assert.equal(get(replay.body, "accepted"), false);

    const fresh = await consumeUnits(api, s, "ann", 5);
    assert.equal(get(fresh.body, "accepted"), true);
  });

  it("returns a conflict when a request id is reused with different data", async () => {
    const limits = { monthlyAllowance: 100, maxPerRequest: 50 };
    const s = await createScenario(
      api,
      { monthlyAllowance: 1000, maxPerRequest: 100 },
      { ann: limits, ben: limits },
    );
    const requestId = uniqueId();
    expectAccepted(await consumeUnits(api, s, "ann", 10, requestId));

    const otherUnits = await consumeUnits(api, s, "ann", 11, requestId);
    assert.equal(otherUnits.status, 409);
    assert.equal(get(otherUnits.body, "error.code"), "request_id_conflict");

    const otherUser = await consumeUnits(api, s, "ben", 10, requestId);
    assert.equal(otherUser.status, 409);
  });

  it("shows zero remaining when an allowance is lowered below usage, until it is raised", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 100, maxPerRequest: 50 },
      { ann: { monthlyAllowance: 1000, maxPerRequest: 200 } },
    );
    expectAccepted(await consumeUnits(api, s, "ann", 40));
    expectAccepted(await consumeUnits(api, s, "ann", 40));

    const setAllowance = async (monthlyAllowance: number): Promise<void> => {
      expectStatus(
        await api.send("PATCH", `/plans/${s.accountPlanId}`, {
          key: s.key,
          body: { monthlyAllowance },
        }),
        200,
      );
    };

    await setAllowance(50);
    const blocked = await consumeUnits(api, s, "ann", 1);
    assert.equal(get(blocked.body, "accepted"), false);
    assert.equal(get(blocked.body, "rejection.level"), "account");
    assert.equal(get(blocked.body, "account.remaining"), 0);
    assert.equal(get(blocked.body, "account.used"), 80);

    await setAllowance(200);
    const allowed = await consumeUnits(api, s, "ann", 1);
    assert.equal(get(allowed.body, "accepted"), true);
    assert.equal(get(allowed.body, "account.remaining"), 119);
  });

  const invalidBodies: [label: string, body: Record<string, unknown>, code: string][] = [
    ["zero units", { userId: "ann", units: 0, requestId: "x" }, "invalid_units"],
    ["negative units", { userId: "ann", units: -5, requestId: "x" }, "invalid_units"],
    ["fractional units", { userId: "ann", units: 1.5, requestId: "x" }, "invalid_units"],
    ["units as a string", { userId: "ann", units: "10", requestId: "x" }, "invalid_units"],
    ["null units", { userId: "ann", units: null, requestId: "x" }, "invalid_units"],
    ["units above the maximum", { userId: "ann", units: 3_000_000_000, requestId: "x" }, "invalid_units"],
    ["missing units", { userId: "ann", requestId: "x" }, "invalid_units"],
    ["a missing request id", { userId: "ann", units: 5 }, "invalid_request_id"],
    ["an empty request id", { userId: "ann", units: 5, requestId: "" }, "invalid_request_id"],
    ["a missing user id", { units: 5, requestId: "x" }, "invalid_user_id"],
  ];
  for (const [label, body, code] of invalidBodies) {
    it(`rejects ${label}`, async () => {
      const s = await createScenario(
        api,
        { monthlyAllowance: 100, maxPerRequest: 50 },
        { ann: { monthlyAllowance: 60, maxPerRequest: 20 } },
      );
      const res = await api.send("POST", "/consume", { key: s.key, body });
      assert.equal(res.status, 400);
      assert.equal(get(res.body, "error.code"), code);
    });
  }

  it("rejects a body that is not valid JSON", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 100, maxPerRequest: 50 },
      { ann: { monthlyAllowance: 60, maxPerRequest: 20 } },
    );
    const res = await api.send("POST", "/consume", { key: s.key, rawBody: "{bad json" });
    assert.equal(res.status, 400);
    assert.equal(get(res.body, "error.code"), "invalid_json");
  });

  it("returns 404 for an unknown user and records nothing", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 100, maxPerRequest: 50 },
      { ann: { monthlyAllowance: 60, maxPerRequest: 20 } },
    );
    const res = await consumeUnits(api, s, "nobody", 5);
    assert.equal(res.status, 404);
    assert.equal(get(res.body, "error.code"), "user_not_found");

    const history = await api.send("GET", "/requests", { key: s.key });
    assert.equal(getNumber(history.body, "pagination.total"), 0);
  });
});
