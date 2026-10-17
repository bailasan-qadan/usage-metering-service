import {
  type Account,
  type ConsumeSample,
  type Limits,
  consume,
  createAccount,
  createPlan,
  createUser,
  expectStatus,
  get,
  historyTotal,
  patchAllowance,
  readUsage,
  send,
  setAccountPlan,
} from "./api.js";
import { type Latency, latencyOf, tally } from "./stats.js";

export type Check = { label: string; passed: boolean; detail: string };

export type ScenarioResult = {
  name: string;
  description: string;
  requests: number;
  concurrency: number;
  durationMs: number;
  latency: Latency;
  outcomes: Record<string, number>;
  checks: Check[];
};

const BIG: Limits = { monthlyAllowance: 1_000_000_000, maxPerRequest: 1000 };

const rawScale = Number(process.env.LOADTEST_SCALE ?? "1");
export const SCALE = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;
const scaled = (count: number): number => Math.max(1, Math.round(count * SCALE));

// --- small helpers -----------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function at<T>(items: T[], index: number): T {
  const item = items[index % items.length];
  if (item === undefined) {
    throw new Error("Empty list");
  }
  return item;
}

function userIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `user${i}`);
}

// Runs `task(0..total-1)` with at most `concurrency` tasks in flight.
async function runPool(
  total: number,
  concurrency: number,
  task: (index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < total; index = next++) {
      await task(index);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

async function timed(work: () => Promise<void>): Promise<number> {
  const started = performance.now();
  await work();
  return performance.now() - started;
}

function check(label: string, passed: boolean, detail: string): Check {
  return { label, passed, detail };
}

function outcomeLabel(sample: ConsumeSample): string {
  if (sample.status !== 200) {
    return `HTTP ${sample.status}`;
  }
  const verdict = sample.accepted === true ? "accepted" : "rejected";
  return sample.replayed === true ? `${verdict} (replay)` : verdict;
}

function buildResult(args: {
  name: string;
  description: string;
  concurrency: number;
  durationMs: number;
  samples: ConsumeSample[];
  checks: Check[];
}): ScenarioResult {
  const failedCalls = args.samples.filter((s) => s.status !== 200).length;
  return {
    name: args.name,
    description: args.description,
    requests: args.samples.length,
    concurrency: args.concurrency,
    durationMs: args.durationMs,
    latency: latencyOf(args.samples.map((s) => s.ms)),
    outcomes: tally(args.samples.map(outcomeLabel)),
    checks: [
      check("every response was HTTP 200", failedCalls === 0, `${failedCalls} other responses`),
      ...args.checks,
    ],
  };
}

async function createAccountWith(
  accountLimits: Limits,
  userLimits: Limits,
  users: string[],
): Promise<{ account: Account; accountPlanId: string }> {
  const account = await createAccount("Load test account");
  const accountPlanId = await createPlan(account, {
    kind: "account",
    name: "Load test account plan",
    ...accountLimits,
  });
  await setAccountPlan(account, accountPlanId);
  const userPlanId = await createPlan(account, {
    kind: "user",
    name: "Load test user plan",
    ...userLimits,
  });
  for (const userId of users) {
    await createUser(account, userId, userPlanId);
  }
  return { account, accountPlanId };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

// --- warm-up (not reported) ------------------------------------------------

export async function warmUp(): Promise<void> {
  const { account } = await createAccountWith(BIG, BIG, ["user0"]);
  await runPool(300, 20, async (i) => {
    await consume(account, "user0", 1, `warm-${i}`);
  });
}

// --- scenarios -------------------------------------------------------------

async function independentAccounts(): Promise<ScenarioResult> {
  const accountCount = 40;
  const total = scaled(4000);
  const concurrency = 40;

  const accounts = await Promise.all(
    Array.from(
      { length: accountCount },
      async () => (await createAccountWith(BIG, BIG, ["user0"])).account,
    ),
  );

  const samples: ConsumeSample[] = [];
  const durationMs = await timed(() =>
    runPool(total, concurrency, async (i) => {
      samples.push(await consume(at(accounts, i), "user0", 1, `req-${i}`));
    }),
  );

  const usages = await Promise.all(accounts.map((account) => readUsage(account)));
  const stored = sum(usages.map((usage) => usage.accountUsed));
  const accepted = samples.filter((s) => s.accepted === true).length;

  return buildResult({
    name: "Independent accounts",
    description: `${accountCount} accounts, 1 unit per request, spread evenly. No two requests compete for the same counters.`,
    concurrency,
    durationMs,
    samples,
    checks: [
      check("every request was accepted", accepted === total, `${accepted} of ${total}`),
      check("stored usage equals accepted units", stored === accepted, `stored ${stored}, accepted ${accepted}`),
    ],
  });
}

async function hotAccount(): Promise<ScenarioResult> {
  const userCount = 20;
  const total = scaled(4000);
  const concurrency = 40;

  const { account } = await createAccountWith(BIG, BIG, userIds(userCount));

  const samples: ConsumeSample[] = [];
  const durationMs = await timed(() =>
    runPool(total, concurrency, async (i) => {
      samples.push(await consume(account, `user${i % userCount}`, 1, `req-${i}`));
    }),
  );

  const usage = await readUsage(account);
  const accepted = samples.filter((s) => s.accepted === true).length;
  const userTotal = sum(Object.values(usage.userUsed));

  return buildResult({
    name: "One hot account",
    description: `All requests belong to one account (${userCount} users), so they all compete for the same shared counter.`,
    concurrency,
    durationMs,
    samples,
    checks: [
      check("every request was accepted", accepted === total, `${accepted} of ${total}`),
      check("account usage equals accepted units", usage.accountUsed === accepted, `stored ${usage.accountUsed}, accepted ${accepted}`),
      check("users' usage adds up to the account's", userTotal === usage.accountUsed, `users ${userTotal}, account ${usage.accountUsed}`),
    ],
  });
}

async function sharedAllowance(): Promise<ScenarioResult> {
  const allowance = 5000;
  const units = 10;
  const total = scaled(1000);
  const concurrency = 100;
  const userCount = 20;
  const expectedAccepted = Math.min(total, allowance / units);

  const { account } = await createAccountWith(
    { monthlyAllowance: allowance, maxPerRequest: 50 },
    BIG,
    userIds(userCount),
  );

  const samples: ConsumeSample[] = [];
  const durationMs = await timed(() =>
    runPool(total, concurrency, async (i) => {
      samples.push(await consume(account, `user${i % userCount}`, units, `req-${i}`));
    }),
  );

  const usage = await readUsage(account);
  const history = await historyTotal(account);
  const accepted = samples.filter((s) => s.accepted === true).length;
  const wrongRejections = samples.filter(
    (s) => s.accepted === false && s.rejection !== "account/monthly_allowance",
  ).length;

  return buildResult({
    name: "Shared allowance",
    description: `${total} requests of ${units} units against an account allowance of ${allowance}: demand exceeds the allowance.`,
    concurrency,
    durationMs,
    samples,
    checks: [
      check("exactly the allowed number was accepted", accepted === expectedAccepted, `${accepted}, expected ${expectedAccepted}`),
      check("usage never exceeds the allowance", usage.accountUsed === expectedAccepted * units, `used ${usage.accountUsed} of ${allowance}`),
      check("remaining matches", usage.accountRemaining === allowance - usage.accountUsed, `remaining ${usage.accountRemaining}`),
      check("users' usage adds up to the account's", sum(Object.values(usage.userUsed)) === usage.accountUsed, `users ${sum(Object.values(usage.userUsed))}`),
      check("every rejection came from the account allowance", wrongRejections === 0, `${wrongRejections} unexpected`),
      check("every request is in the history exactly once", history === total, `history ${history}, sent ${total}`),
    ],
  });
}

async function retriesUnderLoad(): Promise<ScenarioResult> {
  const allowance = 1000;
  const units = 10;
  const distinct = scaled(300);
  const copies = 3;
  const total = distinct * copies;
  const concurrency = 100;
  const expectedAccepted = Math.min(distinct, allowance / units);

  const { account } = await createAccountWith(
    BIG,
    { monthlyAllowance: allowance, maxPerRequest: 10 },
    ["user0"],
  );

  const samples: ConsumeSample[] = [];
  const durationMs = await timed(() =>
    runPool(total, concurrency, async (i) => {
      samples.push(await consume(account, "user0", units, `req-${Math.floor(i / copies)}`));
    }),
  );

  const usage = await readUsage(account);
  const history = await historyTotal(account);
  const firstTime = samples.filter((s) => s.replayed === false).length;
  const replays = samples.filter((s) => s.replayed === true).length;
  const acceptedFirstTime = samples.filter(
    (s) => s.replayed === false && s.accepted === true,
  ).length;

  return buildResult({
    name: "Retries under load",
    description: `${distinct} request ids, each sent ${copies} times at almost the same moment, against a user allowance of ${allowance}.`,
    concurrency,
    durationMs,
    samples,
    checks: [
      check("each request id got exactly one first-time answer", firstTime === distinct, `${firstTime} of ${distinct}`),
      check("all other answers were replays", replays === total - distinct, `${replays} replays`),
      check("retries were not counted twice", usage.accountUsed === expectedAccepted * units, `used ${usage.accountUsed}, expected ${expectedAccepted * units}`),
      check("the right number was accepted", acceptedFirstTime === expectedAccepted, `${acceptedFirstTime}, expected ${expectedAccepted}`),
      check("history has one record per request id", history === distinct, `history ${history}, ids ${distinct}`),
    ],
  });
}

async function planChangesDuringLoad(): Promise<ScenarioResult> {
  const low = 6000;
  const high = 12000;
  const units = 5;
  const total = scaled(3000);
  const concurrency = 50;
  const userCount = 10;

  const { account, accountPlanId } = await createAccountWith(
    { monthlyAllowance: low, maxPerRequest: 100 },
    BIG,
    userIds(userCount),
  );

  let running = true;
  let applied = 0;
  let failed = 0;
  const toggler = (async () => {
    let raise = true;
    while (running) {
      const reply = await patchAllowance(account, accountPlanId, raise ? high : low);
      if (reply.status === 200) {
        applied++;
      } else {
        failed++;
      }
      raise = !raise;
      await sleep(25);
    }
  })();

  const samples: ConsumeSample[] = [];
  const durationMs = await timed(() =>
    runPool(total, concurrency, async (i) => {
      samples.push(await consume(account, `user${i % userCount}`, units, `req-${i}`));
    }),
  );
  running = false;
  await toggler;

  const usage = await readUsage(account);
  const history = await historyTotal(account);
  const acceptedUnits = sum(samples.filter((s) => s.accepted === true).map((s) => s.units));

  // Now lower the allowance far below what has been used and ask once more.
  expectStatus(await patchAllowance(account, accountPlanId, 100), 200, "lower the allowance");
  const afterLowering = await send("POST", "/consume", {
    key: account.key,
    body: { userId: "user0", units: 1, requestId: "after-lowering" },
  });

  return buildResult({
    name: "Plan changes during load",
    description: `The account allowance is switched between ${low} and ${high} every 25 ms while ${total} requests of ${units} units arrive.`,
    concurrency,
    durationMs,
    samples,
    checks: [
      check("plan changes were applied while the load ran", applied > 0 && failed === 0, `${applied} updates, ${failed} failed`),
      check("stored usage equals accepted units", usage.accountUsed === acceptedUnits, `stored ${usage.accountUsed}, accepted ${acceptedUnits}`),
      check("usage never exceeded the highest allowance", usage.accountUsed <= high, `used ${usage.accountUsed}, highest allowance ${high}`),
      check("every request is in the history exactly once", history === total, `history ${history}, sent ${total}`),
      check(
        "an allowance lowered below usage shows 0 remaining and rejects",
        get(afterLowering.body, "accepted") === false &&
          get(afterLowering.body, "account.remaining") === 0 &&
          get(afterLowering.body, "rejection.level") === "account",
        `remaining ${String(get(afterLowering.body, "account.remaining"))}`,
      ),
    ],
  });
}

export const allScenarios: (() => Promise<ScenarioResult>)[] = [
  independentAccounts,
  hotAccount,
  sharedAllowance,
  retriesUnderLoad,
  planChangesDuringLoad,
];
