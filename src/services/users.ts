import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { plans, users } from "../db/schema.js";
import { PREDEFINED_PLAN_IDS } from "../db/seed.js";
import { ConflictError, NotFoundError } from "../errors.js";
import {
  getAssignablePlan,
  planColumns,
  toPlanView,
  type PlanView,
} from "./plans.js";

export type UserView = {
  userId: string;
  createdAt: Date;
  plan: PlanView;
};

export async function getUser(
  accountId: string,
  userId: string,
): Promise<UserView> {
  const [row] = await db
    .select({
      userId: users.externalId,
      createdAt: users.createdAt,
      ...planColumns,
    })
    .from(users)
    .innerJoin(plans, eq(users.planId, plans.id))
    .where(and(eq(users.accountId, accountId), eq(users.externalId, userId)));

  if (row === undefined) {
    throw new NotFoundError("User not found", "user_not_found");
  }

  return {
    userId: row.userId,
    createdAt: row.createdAt,
    plan: toPlanView(row),
  };
}

export async function registerUser(
  accountId: string,
  userId: string,
  planId: string | undefined,
): Promise<UserView> {
  const plan =
    planId === undefined
      ? undefined
      : await getAssignablePlan(accountId, planId, "user");

  const [created] = await db
    .insert(users)
    .values({
      accountId,
      externalId: userId,
      planId: plan?.id ?? PREDEFINED_PLAN_IDS.basic,
    })
    .onConflictDoNothing({ target: [users.accountId, users.externalId] })
    .returning({ id: users.id });

  if (created === undefined) {
    throw new ConflictError("User already exists", "user_already_exists");
  }

  return getUser(accountId, userId);
}

export async function assignUserPlan(
  accountId: string,
  userId: string,
  planId: string,
): Promise<UserView> {
  const plan = await getAssignablePlan(accountId, planId, "user");

  const updated = await db
    .update(users)
    .set({ planId: plan.id })
    .where(and(eq(users.accountId, accountId), eq(users.externalId, userId)))
    .returning({ id: users.id });

  if (updated.length === 0) {
    throw new NotFoundError("User not found", "user_not_found");
  }

  return getUser(accountId, userId);
}
