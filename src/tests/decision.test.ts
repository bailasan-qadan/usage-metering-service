import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { utcMonthStart } from "../months.js";
import {
  decide,
  remainingUnits,
  type LevelState,
} from "../services/decision.js";

const roomy: LevelState = { monthlyAllowance: 1000, maxPerRequest: 100, used: 0 };

describe("decide", () => {
  it("accepts a request that fits both plans", () => {
    assert.deepEqual(decide(10, roomy, roomy), { accepted: true });
  });

  it("rejects by the user's per-request limit even when both allowances have room", () => {
    const user: LevelState = { ...roomy, maxPerRequest: 20 };
    assert.deepEqual(decide(25, user, roomy), {
      accepted: false,
      rejection: { level: "user", rule: "max_per_request" },
    });
  });

  it("rejects by the account's per-request limit", () => {
    const account: LevelState = { ...roomy, maxPerRequest: 20 };
    assert.deepEqual(decide(25, roomy, account), {
      accepted: false,
      rejection: { level: "account", rule: "max_per_request" },
    });
  });

  it("rejects by the user's monthly allowance", () => {
    const user: LevelState = { ...roomy, used: 995 };
    assert.deepEqual(decide(10, user, roomy), {
      accepted: false,
      rejection: { level: "user", rule: "monthly_allowance" },
    });
  });

  it("rejects by the account's monthly allowance when the user has plenty left", () => {
    const account: LevelState = { ...roomy, used: 995 };
    assert.deepEqual(decide(10, roomy, account), {
      accepted: false,
      rejection: { level: "account", rule: "monthly_allowance" },
    });
  });

  it("accepts exactly the remaining amount and rejects one unit more", () => {
    const account: LevelState = { ...roomy, used: 990 };
    assert.deepEqual(decide(10, roomy, account), { accepted: true });
    assert.equal(decide(11, roomy, account).accepted, false);
  });

  it("reports per-request limits before monthly allowances, and the user before the account", () => {
    const everythingExceeded: LevelState = {
      monthlyAllowance: 10,
      maxPerRequest: 5,
      used: 10,
    };
    assert.deepEqual(decide(50, everythingExceeded, everythingExceeded), {
      accepted: false,
      rejection: { level: "user", rule: "max_per_request" },
    });

    const userOutOfUnits: LevelState = {
      monthlyAllowance: 10,
      maxPerRequest: 100,
      used: 10,
    };
    const accountTooSmallPerRequest: LevelState = {
      monthlyAllowance: 1000,
      maxPerRequest: 5,
      used: 0,
    };
    assert.deepEqual(decide(50, userOutOfUnits, accountTooSmallPerRequest), {
      accepted: false,
      rejection: { level: "account", rule: "max_per_request" },
    });
  });

  it("shows zero remaining and rejects when an allowance is lowered below usage", () => {
    const lowered: LevelState = { monthlyAllowance: 10, maxPerRequest: 50, used: 105 };
    assert.equal(remainingUnits(lowered), 0);
    assert.deepEqual(decide(1, roomy, lowered), {
      accepted: false,
      rejection: { level: "account", rule: "monthly_allowance" },
    });
  });
});

describe("utcMonthStart", () => {
  it("switches month at midnight UTC", () => {
    assert.equal(utcMonthStart(new Date("2026-08-31T23:59:59Z")), "2026-08-01");
    assert.equal(utcMonthStart(new Date("2026-09-01T00:00:00Z")), "2026-09-01");
  });

  it("handles the change of year", () => {
    assert.equal(utcMonthStart(new Date("2026-12-31T23:59:59Z")), "2026-12-01");
    assert.equal(utcMonthStart(new Date("2027-01-01T00:00:00Z")), "2027-01-01");
  });
});
