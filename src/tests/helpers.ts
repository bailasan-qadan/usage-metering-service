import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../app.js";
import { client } from "../db/index.js";
import { isRecord } from "../validation.js";

export { client };

export type ApiResponse = { status: number; body: unknown };
export type SendOptions = { key?: string; body?: unknown; rawBody?: string };
export type Api = {
  send(method: string, path: string, options?: SendOptions): Promise<ApiResponse>;
};

export type Limits = { monthlyAllowance: number; maxPerRequest: number };
export type TestAccount = { id: string; key: string };
export type Scenario = TestAccount & {
  accountPlanId: string;
  userPlanIds: Record<string, string>;
};

export async function startApi(): Promise<{
  api: Api;
  stop: () => Promise<void>;
}> {
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The test server has no port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const api: Api = {
    async send(method, path, options = {}) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (options.key !== undefined) {
        headers["X-API-Key"] = options.key;
      }

      let body: string | undefined;
      if (options.rawBody !== undefined) {
        body = options.rawBody;
      } else if (options.body !== undefined) {
        body = JSON.stringify(options.body);
      }

      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body,
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text === "" ? undefined : JSON.parse(text),
      };
    },
  };

  const stop = async (): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await client.end();
  };

  return { api, stop };
}

// --- reading JSON responses without `any` -------------------------------

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

export function getString(value: unknown, path: string): string {
  const found = get(value, path);
  if (typeof found !== "string") {
    throw new Error(`Expected a string at '${path}'`);
  }
  return found;
}

export function getNumber(value: unknown, path: string): number {
  const found = get(value, path);
  if (typeof found !== "number") {
    throw new Error(`Expected a number at '${path}'`);
  }
  return found;
}

export function getList(value: unknown, path: string): unknown[] {
  const found = get(value, path);
  if (!Array.isArray(found)) {
    throw new Error(`Expected a list at '${path}'`);
  }
  return found;
}

export function expectStatus(res: ApiResponse, status: number): void {
  assert.equal(res.status, status, `Unexpected response: ${JSON.stringify(res.body)}`);
}

// --- building test data through the public API --------------------------

export function uniqueId(prefix = "req"): string {
  return `${prefix}-${randomUUID()}`;
}

export async function createAccount(
  api: Api,
  name = "Test account",
): Promise<TestAccount> {
  const res = await api.send("POST", "/accounts", { body: { name } });
  expectStatus(res, 201);
  return {
    id: getString(res.body, "account.id"),
    key: getString(res.body, "apiKey"),
  };
}

export async function createPlan(
  api: Api,
  account: TestAccount,
  plan: { kind: "account" | "user"; name: string } & Limits,
): Promise<string> {
  const res = await api.send("POST", "/plans", { key: account.key, body: plan });
  expectStatus(res, 201);
  return getString(res.body, "plan.id");
}

export async function createUser(
  api: Api,
  account: TestAccount,
  userId: string,
  planId?: string,
): Promise<void> {
  const res = await api.send("POST", "/users", {
    key: account.key,
    body: { userId, planId },
  });
  expectStatus(res, 201);
}

export async function setAccountPlan(
  api: Api,
  account: TestAccount,
  planId: string,
): Promise<void> {
  const res = await api.send("PUT", "/account/plan", {
    key: account.key,
    body: { planId },
  });
  expectStatus(res, 200);
}

export async function createScenario(
  api: Api,
  accountLimits: Limits,
  userLimits: Record<string, Limits>,
): Promise<Scenario> {
  const account = await createAccount(api);
  const accountPlanId = await createPlan(api, account, {
    kind: "account",
    name: "Test account plan",
    ...accountLimits,
  });
  await setAccountPlan(api, account, accountPlanId);

  const userPlanIds: Record<string, string> = {};
  for (const [userId, limits] of Object.entries(userLimits)) {
    const planId = await createPlan(api, account, {
      kind: "user",
      name: `Plan of ${userId}`,
      ...limits,
    });
    await createUser(api, account, userId, planId);
    userPlanIds[userId] = planId;
  }
  return { ...account, accountPlanId, userPlanIds };
}

export function planIdOf(scenario: Scenario, userId: string): string {
  const planId = scenario.userPlanIds[userId];
  if (planId === undefined) {
    throw new Error(`No plan recorded for ${userId}`);
  }
  return planId;
}

export function consumeUnits(
  api: Api,
  account: TestAccount,
  userId: string,
  units: number,
  requestId: string = uniqueId(),
): Promise<ApiResponse> {
  return api.send("POST", "/consume", {
    key: account.key,
    body: { userId, units, requestId },
  });
}
