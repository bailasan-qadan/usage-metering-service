import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { consume } from "../services/consume.js";
import { listRequests } from "../services/history.js";
import { getAccountUsage } from "../services/usage.js";
import { type Api, createScenario, startApi } from "./helpers.js";

let api: Api;
let stop: () => Promise<void>;

before(async () => {
  ({ api, stop } = await startApi());
});

after(async () => {
  await stop();
});

const page = { limit: 20, offset: 0 };

describe("UTC months", () => {
  it("starts each month at zero and keeps the totals of earlier months", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 1000, maxPerRequest: 100 },
      { ann: { monthlyAllowance: 1000, maxPerRequest: 100 } },
    );
    const input = (requestId: string, units: number) => ({
      accountId: s.id,
      userId: "ann",
      requestId,
      units,
    });
    const lateAugust = new Date("2026-08-31T23:59:59Z");
    const firstOfSeptember = new Date("2026-09-01T00:00:00Z");
    const midSeptember = new Date("2026-09-15T12:00:00Z");

    const august = await consume(input("aug-1", 10), lateAugust);
    assert.equal(august.month, "2026-08");

    const septemberBefore = await getAccountUsage(s.id, "2026-09-01", page, midSeptember);
    assert.equal(septemberBefore.account.used, 0);

    const september = await consume(input("sep-1", 5), firstOfSeptember);
    assert.equal(september.month, "2026-09");

    const augustUsage = await getAccountUsage(s.id, "2026-08-01", page, midSeptember);
    assert.equal(augustUsage.account.used, 10);
    assert.equal(augustUsage.account.remaining, null);
    assert.equal(augustUsage.users[0]?.used, 10);

    const septemberUsage = await getAccountUsage(s.id, "2026-09-01", page, midSeptember);
    assert.equal(septemberUsage.account.used, 5);
    assert.equal(septemberUsage.account.remaining, 995);
    assert.equal(septemberUsage.users[0]?.used, 5);

    const augustHistory = await listRequests(s.id, { month: "2026-08-01" }, page);
    assert.deepEqual(
      augustHistory.requests.map((record) => record.requestId),
      ["aug-1"],
    );
  });

  it("makes an exhausted monthly allowance available again in the next month", async () => {
    const s = await createScenario(
      api,
      { monthlyAllowance: 1000, maxPerRequest: 100 },
      { ann: { monthlyAllowance: 20, maxPerRequest: 20 } },
    );
    const input = (requestId: string, units: number) => ({
      accountId: s.id,
      userId: "ann",
      requestId,
      units,
    });

    const first = await consume(input("aug-1", 20), new Date("2026-08-20T10:00:00Z"));
    const second = await consume(input("aug-2", 1), new Date("2026-08-21T10:00:00Z"));
    const third = await consume(input("sep-1", 20), new Date("2026-09-01T00:00:00Z"));

    assert.equal(first.accepted, true);
    assert.equal(second.accepted, false);
    assert.equal(second.rejection?.rule, "monthly_allowance");
    assert.equal(third.accepted, true);
  });
});
