import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PREDEFINED_PLAN_IDS } from "../db/seed.js";
import {
  type Api,
  consumeUnits,
  createAccount,
  createPlan,
  createScenario,
  createUser,
  expectAccepted,
  expectStatus,
  get,
  getList,
  getNumber,
  getString,
  planIdOf,
  setAccountPlan,
  startApi,
} from "./helpers.js";

let api: Api;
let stop: () => Promise<void>;

before(async () => {
  ({ api, stop } = await startApi());
});

after(async () => {
  await stop();
});

describe("predefined plans", () => {
  it("lists the four predefined plans with their documented limits", async () => {
    const account = await createAccount(api);
    const res = await api.send("GET", "/plans", { key: account.key });
    expectStatus(res, 200);

    const summary = getList(res.body, "plans").map((plan) => [
      get(plan, "name"),
      get(plan, "kind"),
      get(plan, "monthlyAllowance"),
      get(plan, "maxPerRequest"),
      get(plan, "predefined"),
    ]);
    assert.deepEqual(summary, [
      ["Pro", "account", 100000, 1000, true],
      ["Starter", "account", 10000, 100, true],
      ["Basic", "user", 1000, 20, true],
      ["Premium", "user", 5000, 100, true],
    ]);
  });

  it("starts new accounts on Starter and new users on Basic", async () => {
    const account = await createAccount(api);
    await createUser(api, account, "ann");

    const accountRes = await api.send("GET", "/account", { key: account.key });
    assert.equal(get(accountRes.body, "account.plan.name"), "Starter");
    const userRes = await api.send("GET", "/users/ann", { key: account.key });
    assert.equal(get(userRes.body, "user.plan.name"), "Basic");
  });

  it("keeps predefined plans read-only", async () => {
    const account = await createAccount(api);
    const res = await api.send("PATCH", `/plans/${PREDEFINED_PLAN_IDS.premium}`, {
      key: account.key,
      body: { monthlyAllowance: 1 },
    });
    assert.equal(res.status, 403);
    assert.equal(get(res.body, "error.code"), "predefined_plan_read_only");
  });
});

describe("custom plans", () => {
  it("creates, views, lists and updates a custom plan", async () => {
    const account = await createAccount(api);
    const created = await api.send("POST", "/plans", {
      key: account.key,
      body: { kind: "user", name: "Team", monthlyAllowance: 300, maxPerRequest: 30 },
    });
    expectStatus(created, 201);
    assert.equal(get(created.body, "plan.predefined"), false);
    const planId = getString(created.body, "plan.id");

    const viewed = await api.send("GET", `/plans/${planId}`, { key: account.key });
    assert.equal(get(viewed.body, "plan.name"), "Team");

    const updated = await api.send("PATCH", `/plans/${planId}`, {
      key: account.key,
      body: { name: "Team plus", monthlyAllowance: 400 },
    });
    expectStatus(updated, 200);
    assert.equal(get(updated.body, "plan.name"), "Team plus");
    assert.equal(get(updated.body, "plan.monthlyAllowance"), 400);
    assert.equal(get(updated.body, "plan.maxPerRequest"), 30);

    const listed = await api.send("GET", "/plans?kind=user", { key: account.key });
    const names = getList(listed.body, "plans").map((plan) => get(plan, "name"));
    assert.ok(names.includes("Team plus"));
  });

  it("applies an update immediately to every user sharing the plan and to the account", async () => {
    const account = await createAccount(api);
    const userPlan = await createPlan(api, account, {
      kind: "user",
      name: "Shared",
      monthlyAllowance: 50,
      maxPerRequest: 5,
    });
    await createUser(api, account, "ann", userPlan);
    await createUser(api, account, "ben", userPlan);

    const accountPlan = await createPlan(api, account, {
      kind: "account",
      name: "Mine",
      monthlyAllowance: 100,
      maxPerRequest: 10,
    });
    await setAccountPlan(api, account, accountPlan);

    expectStatus(
      await api.send("PATCH", `/plans/${userPlan}`, {
        key: account.key,
        body: { monthlyAllowance: 80 },
      }),
      200,
    );
    expectStatus(
      await api.send("PATCH", `/plans/${accountPlan}`, {
        key: account.key,
        body: { maxPerRequest: 20 },
      }),
      200,
    );

    for (const userId of ["ann", "ben"]) {
      const res = await api.send("GET", `/users/${userId}`, { key: account.key });
      assert.equal(get(res.body, "user.plan.monthlyAllowance"), 80);
    }
    const acct = await api.send("GET", "/account", { key: account.key });
    assert.equal(get(acct.body, "account.plan.maxPerRequest"), 20);
  });

  const invalidPlans: [label: string, body: Record<string, unknown>, code: string][] = [
    ["an unknown kind", { kind: "team", name: "x", monthlyAllowance: 1, maxPerRequest: 1 }, "invalid_kind"],
    ["a zero per-request limit", { kind: "user", name: "x", monthlyAllowance: 1, maxPerRequest: 0 }, "invalid_max_per_request"],
    ["a negative allowance", { kind: "user", name: "x", monthlyAllowance: -1, maxPerRequest: 1 }, "invalid_monthly_allowance"],
    ["a fractional allowance", { kind: "user", name: "x", monthlyAllowance: 1.5, maxPerRequest: 1 }, "invalid_monthly_allowance"],
    ["an empty name", { kind: "user", name: "", monthlyAllowance: 1, maxPerRequest: 1 }, "invalid_plan_name"],
    ["a missing name", { kind: "user", monthlyAllowance: 1, maxPerRequest: 1 }, "invalid_plan_name"],
  ];
  for (const [label, body, code] of invalidPlans) {
    it(`rejects ${label}`, async () => {
      const account = await createAccount(api);
      const res = await api.send("POST", "/plans", { key: account.key, body });
      assert.equal(res.status, 400);
      assert.equal(get(res.body, "error.code"), code);
    });
  }

  it("does not allow changing a plan's kind or sending an empty update", async () => {
    const account = await createAccount(api);
    const planId = await createPlan(api, account, {
      kind: "user",
      name: "Fixed",
      monthlyAllowance: 10,
      maxPerRequest: 5,
    });

    const kind = await api.send("PATCH", `/plans/${planId}`, {
      key: account.key,
      body: { kind: "account" },
    });
    assert.equal(get(kind.body, "error.code"), "kind_not_updatable");

    const empty = await api.send("PATCH", `/plans/${planId}`, {
      key: account.key,
      body: {},
    });
    assert.equal(get(empty.body, "error.code"), "no_changes");
  });

  it("refuses to assign a plan of the wrong kind", async () => {
    const account = await createAccount(api);
    await createUser(api, account, "ann");

    const accountPlanToUser = await api.send("PUT", "/users/ann/plan", {
      key: account.key,
      body: { planId: PREDEFINED_PLAN_IDS.pro },
    });
    assert.equal(accountPlanToUser.status, 400);
    assert.equal(get(accountPlanToUser.body, "error.code"), "wrong_plan_kind");

    const userPlanToAccount = await api.send("PUT", "/account/plan", {
      key: account.key,
      body: { planId: PREDEFINED_PLAN_IDS.basic },
    });
    assert.equal(userPlanToAccount.status, 400);
    assert.equal(get(userPlanToAccount.body, "error.code"), "wrong_plan_kind");
  });
});

describe("changing plans", () => {
  it("keeps units already consumed when a user switches plans", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 1000, maxPerRequest: 100 },
      { ann: { monthlyAllowance: 100, maxPerRequest: 10 } },
    );
    expectAccepted(await consumeUnits(api, s, "ann", 10));

    const bigger = await createPlan(api, s, {
      kind: "user",
      name: "Bigger",
      monthlyAllowance: 500,
      maxPerRequest: 50,
    });
    expectStatus(
      await api.send("PUT", "/users/ann/plan", { key: s.key, body: { planId: bigger } }),
      200,
    );

    const usage = await api.send("GET", "/users/ann/usage", { key: s.key });
    assert.equal(getNumber(usage.body, "user.used"), 10);
    assert.equal(getNumber(usage.body, "user.remaining"), 490);
  });

  it("keeps request history unchanged when a plan is updated", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 1000, maxPerRequest: 100 },
      { ann: { monthlyAllowance: 100, maxPerRequest: 10 } },
    );
    expectAccepted(await consumeUnits(api, s, "ann", 10));
    const rejected = await consumeUnits(api, s, "ann", 25);
    assert.equal(get(rejected.body, "accepted"), false);

    expectStatus(
      await api.send("PATCH", `/plans/${planIdOf(s, "ann")}`, {
        key: s.key,
        body: { maxPerRequest: 100 },
      }),
      200,
    );

    const history = await api.send("GET", "/requests", { key: s.key });
    const records = getList(history.body, "requests");
    assert.equal(records.length, 2);

    const rejectedRecord = records.find((record) => get(record, "units") === 25);
    assert.equal(get(rejectedRecord, "accepted"), false);
    assert.equal(get(rejectedRecord, "rejection.rule"), "max_per_request");
  });
});
