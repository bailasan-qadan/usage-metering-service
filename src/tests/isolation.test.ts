import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PREDEFINED_PLAN_IDS } from "../db/seed.js";
import {
  type Api,
  consumeUnits,
  createAccount,
  createScenario,
  createUser,
  expectAccepted,
  get,
  getList,
  getNumber,
  planIdOf,
  type Scenario,
  startApi,
  type TestAccount,
} from "./helpers.js";

let api: Api;
let stop: () => Promise<void>;
let a: Scenario;
let b: TestAccount;

before(async () => {
  ({ api, stop } = await startApi());
  a = await createScenario(
    api,
    { monthlyAllowance: 1000, maxPerRequest: 100 },
    { ann: { monthlyAllowance: 500, maxPerRequest: 50 } },
  );
  b = await createAccount(api, "Other account");
  expectAccepted(await consumeUnits(api, a, "ann", 10));
});

after(async () => {
  await stop();
});

describe("account isolation", () => {
  it("hides another account's users", async () => {
    const user = await api.send("GET", "/users/ann", { key: b.key });
    assert.equal(user.status, 404);
    assert.equal(get(user.body, "error.code"), "user_not_found");

    const usage = await api.send("GET", "/users/ann/usage", { key: b.key });
    assert.equal(usage.status, 404);
  });

  it("refuses to consume units for another account's user and leaves its usage alone", async () => {
    const res = await consumeUnits(api, b, "ann", 5);
    assert.equal(res.status, 404);
    assert.equal(get(res.body, "error.code"), "user_not_found");

    const usage = await api.send("GET", "/users/ann/usage", { key: a.key });
    assert.equal(getNumber(usage.body, "user.used"), 10);
  });

  it("refuses to change another account's user plan", async () => {
    const res = await api.send("PUT", "/users/ann/plan", {
      key: b.key,
      body: { planId: PREDEFINED_PLAN_IDS.premium },
    });
    assert.equal(res.status, 404);

    const user = await api.send("GET", "/users/ann", { key: a.key });
    assert.equal(get(user.body, "user.plan.name"), "Plan of ann");
  });

  it("hides, protects and does not list another account's custom plans", async () => {
    const planId = planIdOf(a, "ann");

    const view = await api.send("GET", `/plans/${planId}`, { key: b.key });
    assert.equal(view.status, 404);

    const edit = await api.send("PATCH", `/plans/${planId}`, {
      key: b.key,
      body: { monthlyAllowance: 1 },
    });
    assert.equal(edit.status, 404);

    const list = await api.send("GET", "/plans", { key: b.key });
    assert.equal(getList(list.body, "plans").length, 4);
  });

  it("refuses to assign another account's plans", async () => {
    await createUser(api, b, "zed");

    const userPlan = await api.send("PUT", "/users/zed/plan", {
      key: b.key,
      body: { planId: planIdOf(a, "ann") },
    });
    assert.equal(userPlan.status, 404);
    assert.equal(get(userPlan.body, "error.code"), "plan_not_found");

    const accountPlan = await api.send("PUT", "/account/plan", {
      key: b.key,
      body: { planId: a.accountPlanId },
    });
    assert.equal(accountPlan.status, 404);
  });

  it("shows another account none of this account's usage or history", async () => {
    const history = await api.send("GET", "/requests", { key: b.key });
    assert.equal(getNumber(history.body, "pagination.total"), 0);

    const usage = await api.send("GET", "/usage", { key: b.key });
    assert.equal(getNumber(usage.body, "account.used"), 0);
    assert.ok(
      getList(usage.body, "users").every((user) => get(user, "userId") !== "ann"),
    );
  });

  it("keeps the same user id and request id separate in two accounts", async () => {
    await createUser(api, b, "ann");

    const forB = await consumeUnits(api, b, "ann", 5, "shared-id");
    const forA = await consumeUnits(api, a, "ann", 7, "shared-id");
    assert.equal(get(forB.body, "replayed"), false);
    assert.equal(get(forA.body, "replayed"), false);

    const usageA = await api.send("GET", "/users/ann/usage", { key: a.key });
    const usageB = await api.send("GET", "/users/ann/usage", { key: b.key });
    assert.equal(getNumber(usageA.body, "user.used"), 17);
    assert.equal(getNumber(usageB.body, "user.used"), 5);
  });
});
