import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  type Api,
  consumeUnits,
  createAccount,
  createScenario,
  expectAccepted,
  expectStatus,
  get,
  getList,
  getNumber,
  startApi,
  type TestAccount,
} from "./helpers.js";

let api: Api;
let stop: () => Promise<void>;

before(async () => {
  ({ api, stop } = await startApi());
});

after(async () => {
  await stop();
});

const currentMonth = new Date().toISOString().slice(0, 7);

async function historyIds(account: TestAccount, query: string): Promise<unknown[]> {
  const res = await api.send("GET", `/requests${query}`, { key: account.key });
  expectStatus(res, 200);
  return getList(res.body, "requests").map((record) => get(record, "requestId"));
}

describe("usage", () => {
  it("shows consumed and remaining units for the account and each user", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 1000, maxPerRequest: 100 },
      {
        ann: { monthlyAllowance: 500, maxPerRequest: 50 },
        ben: { monthlyAllowance: 300, maxPerRequest: 50 },
        idle: { monthlyAllowance: 200, maxPerRequest: 50 },
      },
    );
    expectAccepted(await consumeUnits(api, s, "ann", 10));
    expectAccepted(await consumeUnits(api, s, "ben", 20));

    const res = await api.send("GET", "/usage", { key: s.key });
    expectStatus(res, 200);
    assert.equal(get(res.body, "month"), currentMonth);
    assert.equal(get(res.body, "account.used"), 30);
    assert.equal(get(res.body, "account.remaining"), 970);

    const rows = getList(res.body, "users").map((user) => [
      get(user, "userId"),
      get(user, "used"),
      get(user, "remaining"),
    ]);
    assert.deepEqual(rows, [
      ["ann", 10, 490],
      ["ben", 20, 280],
      ["idle", 0, 200],
    ]);

    const single = await api.send("GET", "/users/ann/usage", { key: s.key });
    assert.equal(getNumber(single.body, "user.used"), 10);
    assert.equal(getNumber(single.body, "user.remaining"), 490);
  });

  it("shows zero usage and no remaining figure for a past month with no activity", async () => {
    const account = await createAccount(api);
    const res = await api.send("GET", "/usage?month=2020-01", { key: account.key });
    expectStatus(res, 200);
    assert.equal(get(res.body, "month"), "2020-01");
    assert.equal(get(res.body, "account.used"), 0);
    assert.equal(get(res.body, "account.remaining"), null);
  });

  it("pages through history newest first", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 1000, maxPerRequest: 100 },
      { ann: { monthlyAllowance: 500, maxPerRequest: 50 } },
    );
    for (let i = 1; i <= 5; i++) {
      expectAccepted(await consumeUnits(api, s, "ann", 1, `h${i}`));
    }

    assert.deepEqual(await historyIds(s, "?limit=2"), ["h5", "h4"]);
    assert.deepEqual(await historyIds(s, "?limit=2&offset=2"), ["h3", "h2"]);
    assert.deepEqual(await historyIds(s, "?limit=2&offset=4"), ["h1"]);

    const first = await api.send("GET", "/requests?limit=2", { key: s.key });
    assert.equal(getNumber(first.body, "pagination.total"), 5);
  });

  it("filters history by user and by month", async () => {
    const limits = { monthlyAllowance: 500, maxPerRequest: 50 };
    const s = await createScenario(
      api,
      { monthlyAllowance: 1000, maxPerRequest: 100 },
      { ann: limits, ben: limits },
    );
    expectAccepted(await consumeUnits(api, s, "ann", 1, "ann-1"));
    expectAccepted(await consumeUnits(api, s, "ben", 1, "ben-1"));

    assert.deepEqual(await historyIds(s, "?userId=ann"), ["ann-1"]);
    assert.deepEqual(await historyIds(s, "?userId=ben"), ["ben-1"]);
    assert.deepEqual(await historyIds(s, `?month=${currentMonth}`), ["ben-1", "ann-1"]);
    assert.deepEqual(await historyIds(s, "?month=2020-01"), []);
  });

  const badQueries: [path: string, code: string][] = [
    ["/requests?limit=0", "invalid_limit"],
    ["/requests?limit=101", "invalid_limit"],
    ["/requests?limit=abc", "invalid_limit"],
    ["/requests?offset=-1", "invalid_offset"],
    ["/requests?month=abc", "invalid_month"],
    ["/requests?userId=", "invalid_user_id"],
    ["/usage?month=2026-13", "invalid_month"],
    ["/usage?month=2099-01", "month_in_future"],
    ["/usage?limit=0", "invalid_limit"],
    ["/users/ann/usage?month=2099-01", "month_in_future"],
  ];
  for (const [path, code] of badQueries) {
    it(`rejects ${path}`, async () => {
      const account = await createAccount(api);
      const res = await api.send("GET", path, { key: account.key });
      assert.equal(res.status, 400);
      assert.equal(get(res.body, "error.code"), code);
    });
  }
});
