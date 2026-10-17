import { isRecord } from "../validation.js";

export const BASE_URL = (
  process.env.METERING_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

export type Reply = { status: number; body: unknown; ms: number };
export type Account = { id: string; key: string };
export type Limits = { monthlyAllowance: number; maxPerRequest: number };

export type ConsumeSample = {
  ms: number;
  status: number;
  accepted: boolean | undefined;
  replayed: boolean | undefined;
  rejection: string | undefined;
  units: number;
};

type SendOptions = { key?: string; body?: unknown };

export async function send(
  method: string,
  path: string,
  options: SendOptions = {},
): Promise<Reply> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.key !== undefined) {
    headers["X-API-Key"] = options.key;
  }

  const started = performance.now();
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const ms = performance.now() - started;

  return {
    status: response.status,
    body: text === "" ? undefined : JSON.parse(text),
    ms,
  };
}

// --- reading JSON without `any` -------------------------------------------

export function get(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const key of path.split(".")) {
    if (Array.isArray(current)) {
      current = current[Number(key)];
    } else if (isRecord(current)) {
      current = current[key];
    } else {
      return undefined;
    }
  }
  return current;
}

function getString(value: unknown, path: string): string {
  const found = get(value, path);
  if (typeof found !== "string") {
    throw new Error(`Expected a string at '${path}'`);
  }
  return found;
}

function getNumber(value: unknown, path: string): number {
  const found = get(value, path);
  if (typeof found !== "number") {
    throw new Error(`Expected a number at '${path}'`);
  }
  return found;
}

function getList(value: unknown, path: string): unknown[] {
  const found = get(value, path);
  if (!Array.isArray(found)) {
    throw new Error(`Expected a list at '${path}'`);
  }
  return found;
}

export function expectStatus(
  reply: Reply,
  status: number,
  action: string,
): void {
  if (reply.status !== status) {
    throw new Error(
      `Could not ${action}: expected HTTP ${status}, got ${reply.status} ${JSON.stringify(reply.body)}`,
    );
  }
}

// --- setting up test data --------------------------------------------------

export async function createAccount(name: string): Promise<Account> {
  const reply = await send("POST", "/accounts", { body: { name } });
  expectStatus(reply, 201, "create an account");
  return {
    id: getString(reply.body, "account.id"),
    key: getString(reply.body, "apiKey"),
  };
}

export async function createPlan(
  account: Account,
  plan: { kind: "account" | "user"; name: string } & Limits,
): Promise<string> {
  const reply = await send("POST", "/plans", { key: account.key, body: plan });
  expectStatus(reply, 201, "create a plan");
  return getString(reply.body, "plan.id");
}

export async function setAccountPlan(
  account: Account,
  planId: string,
): Promise<void> {
  const reply = await send("PUT", "/account/plan", {
    key: account.key,
    body: { planId },
  });
  expectStatus(reply, 200, "assign the account plan");
}

export async function createUser(
  account: Account,
  userId: string,
  planId: string,
): Promise<void> {
  const reply = await send("POST", "/users", {
    key: account.key,
    body: { userId, planId },
  });
  expectStatus(reply, 201, "register a user");
}

export function patchAllowance(
  account: Account,
  planId: string,
  monthlyAllowance: number,
): Promise<Reply> {
  return send("PATCH", `/plans/${planId}`, {
    key: account.key,
    body: { monthlyAllowance },
  });
}

// --- the operation under test and the checks afterwards --------------------

export async function consume(
  account: Account,
  userId: string,
  units: number,
  requestId: string,
): Promise<ConsumeSample> {
  const reply = await send("POST", "/consume", {
    key: account.key,
    body: { userId, units, requestId },
  });
  const accepted = get(reply.body, "accepted");
  const replayed = get(reply.body, "replayed");
  const level = get(reply.body, "rejection.level");
  const rule = get(reply.body, "rejection.rule");

  return {
    ms: reply.ms,
    status: reply.status,
    accepted: typeof accepted === "boolean" ? accepted : undefined,
    replayed: typeof replayed === "boolean" ? replayed : undefined,
    rejection:
      typeof level === "string" && typeof rule === "string"
        ? `${level}/${rule}`
        : undefined,
    units,
  };
}

export async function readUsage(account: Account): Promise<{
  accountUsed: number;
  accountRemaining: number;
  userUsed: Record<string, number>;
}> {
  const reply = await send("GET", "/usage?limit=100", { key: account.key });
  expectStatus(reply, 200, "read usage");

  const userUsed: Record<string, number> = {};
  for (const user of getList(reply.body, "users")) {
    userUsed[getString(user, "userId")] = getNumber(user, "used");
  }
  return {
    accountUsed: getNumber(reply.body, "account.used"),
    accountRemaining: getNumber(reply.body, "account.remaining"),
    userUsed,
  };
}

export async function historyTotal(account: Account): Promise<number> {
  const reply = await send("GET", "/requests?limit=1", { key: account.key });
  expectStatus(reply, 200, "read history");
  return getNumber(reply.body, "pagination.total");
}
