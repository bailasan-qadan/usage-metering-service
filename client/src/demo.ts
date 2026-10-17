import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import {
  get,
  readList,
  readString,
  request,
  type ServiceResponse,
} from "./meteringApi.js";

// The predefined plans documented in the service's README.
export const PLAN_IDS = {
  basic: "00000000-0000-4000-8000-000000000003",
  premium: "00000000-0000-4000-8000-000000000004",
} as const;

export type UserPlanName = keyof typeof PLAN_IDS;

export function isUserPlanName(value: unknown): value is UserPlanName {
  return value === "basic" || value === "premium";
}

export const DEMO_USERS = [
  { userId: "alice", plan: "basic" },
  { userId: "bob", plan: "premium" },
] as const;

export type DemoUserId = (typeof DEMO_USERS)[number]["userId"];

export function isDemoUser(value: unknown): value is DemoUserId {
  return DEMO_USERS.some((user) => user.userId === value);
}

const COMPANY_PLAN_NAME = "Demo company plan";
const COMPANY_LIMITS = { monthlyAllowance: 100, maxPerRequest: 50 };

export type Session = { apiKey: string; companyPlanId: string };

function requireStatus(
  res: ServiceResponse,
  allowed: number[],
  action: string,
): void {
  if (!allowed.includes(res.status)) {
    throw new Error(
      `Could not ${action}: HTTP ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
}

async function createDemoAccount(): Promise<string> {
  const res = await request(config.meteringUrl, "POST", "/accounts", {
    body: { name: "Document Processing Co" },
  });
  requireStatus(res, [201], "create the demo account");
  return readString(res.body, "apiKey");
}

function findCompanyPlanId(body: unknown): string | undefined {
  const match = readList(body, "plans").find(
    (plan) =>
      get(plan, "name") === COMPANY_PLAN_NAME &&
      get(plan, "predefined") === false,
  );
  return match === undefined ? undefined : readString(match, "id");
}

async function createCompanyPlan(apiKey: string): Promise<string> {
  const res = await request(config.meteringUrl, "POST", "/plans", {
    key: apiKey,
    body: { kind: "account", name: COMPANY_PLAN_NAME, ...COMPANY_LIMITS },
  });
  requireStatus(res, [201], "create the company plan");
  return readString(res.body, "plan.id");
}

// Prepares everything the demo needs. Safe to run more than once.
export async function setUpDemo(): Promise<Session> {
  const apiKey = config.apiKey ?? (await createDemoAccount());

  const plans = await request(config.meteringUrl, "GET", "/plans?kind=account", {
    key: apiKey,
  });
  requireStatus(plans, [200], "list plans (is the API key valid?)");
  const companyPlanId =
    findCompanyPlanId(plans.body) ?? (await createCompanyPlan(apiKey));

  const assigned = await request(config.meteringUrl, "PUT", "/account/plan", {
    key: apiKey,
    body: { planId: companyPlanId },
  });
  requireStatus(assigned, [200], "assign the company plan");

  for (const user of DEMO_USERS) {
    const res = await request(config.meteringUrl, "POST", "/users", {
      key: apiKey,
      body: { userId: user.userId, planId: PLAN_IDS[user.plan] },
    });
    requireStatus(res, [201, 409], `register ${user.userId}`);
  }

  return { apiKey, companyPlanId };
}

// The business action. In a real application the document would be processed
// only when the answer says "accepted". Here, one page costs one unit and the
// processing itself is simulated. The service validates `pages`, so whatever
// the form sends is passed on as it is.
export function processDocument(
  session: Session,
  userId: DemoUserId,
  pages: unknown,
): Promise<ServiceResponse> {
  return request(config.meteringUrl, "POST", "/consume", {
    key: session.apiKey,
    body: { userId, units: pages, requestId: randomUUID() },
  });
}

export async function loadState(
  session: Session,
): Promise<{ usage: unknown; requests: unknown }> {
  const [usage, requests] = await Promise.all([
    request(config.meteringUrl, "GET", "/usage", { key: session.apiKey }),
    request(config.meteringUrl, "GET", "/requests?limit=8", {
      key: session.apiKey,
    }),
  ]);
  return { usage: usage.body, requests: requests.body };
}

export function switchUserPlan(
  session: Session,
  userId: DemoUserId,
  plan: UserPlanName,
): Promise<ServiceResponse> {
  return request(
    config.meteringUrl,
    "PUT",
    `/users/${encodeURIComponent(userId)}/plan`,
    { key: session.apiKey, body: { planId: PLAN_IDS[plan] } },
  );
}

export function setCompanyAllowance(
  session: Session,
  monthlyAllowance: unknown,
): Promise<ServiceResponse> {
  return request(
    config.meteringUrl,
    "PATCH",
    `/plans/${session.companyPlanId}`,
    { key: session.apiKey, body: { monthlyAllowance } },
  );
}
