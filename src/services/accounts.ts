import { eq } from "drizzle-orm";
import { generateApiKey, hashApiKey } from "../auth/apiKeys.js";
import { db } from "../db/index.js";
import { accounts, apiKeys, plans } from "../db/schema.js";
import { PREDEFINED_PLAN_IDS } from "../db/seed.js";
import { NotFoundError } from "../errors.js";

export type PlanView = {
  id: string;
  kind: "account" | "user";
  name: string;
  monthlyAllowance: number;
  maxPerRequest: number;
  predefined: boolean;
};

export type AccountView = {
  id: string;
  name: string;
  createdAt: Date;
  plan: PlanView;
};

export async function getAccount(accountId: string): Promise<AccountView> {
  const [row] = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      createdAt: accounts.createdAt,
      planId: plans.id,
      planKind: plans.kind,
      planName: plans.name,
      monthlyAllowance: plans.monthlyAllowance,
      maxPerRequest: plans.maxPerRequest,
      ownerAccountId: plans.ownerAccountId,
    })
    .from(accounts)
    .innerJoin(plans, eq(accounts.planId, plans.id))
    .where(eq(accounts.id, accountId));

  if (row === undefined) {
    throw new NotFoundError("Account not found", "account_not_found");
  }

  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    plan: {
      id: row.planId,
      kind: row.planKind,
      name: row.planName,
      monthlyAllowance: row.monthlyAllowance,
      maxPerRequest: row.maxPerRequest,
      predefined: row.ownerAccountId === null,
    },
  };
}

export async function createAccount(
  name: string,
): Promise<{ account: AccountView; apiKey: string }> {
  const apiKey = generateApiKey();

  const accountId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(accounts)
      .values({ name, planId: PREDEFINED_PLAN_IDS.starter })
      .returning({ id: accounts.id });

    if (created === undefined) {
      throw new Error("Failed to create account");
    }

    await tx
      .insert(apiKeys)
      .values({ accountId: created.id, keyHash: hashApiKey(apiKey) });

    return created.id;
  });

  return { account: await getAccount(accountId), apiKey };
}
