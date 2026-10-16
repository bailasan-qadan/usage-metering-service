import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { plans } from "../db/schema.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../errors.js";

export type PlanKind = "account" | "user";

export type PlanView = {
  id: string;
  kind: PlanKind;
  name: string;
  monthlyAllowance: number;
  maxPerRequest: number;
  predefined: boolean;
};

export type NewPlan = {
  kind: PlanKind;
  name: string;
  monthlyAllowance: number;
  maxPerRequest: number;
};

export type PlanChanges = Partial<Omit<NewPlan, "kind">>;

type PlanRow = {
  planId: string;
  planKind: PlanKind;
  planName: string;
  monthlyAllowance: number;
  maxPerRequest: number;
  ownerAccountId: string | null;
};

export const planColumns = {
  planId: plans.id,
  planKind: plans.kind,
  planName: plans.name,
  monthlyAllowance: plans.monthlyAllowance,
  maxPerRequest: plans.maxPerRequest,
  ownerAccountId: plans.ownerAccountId,
};

export function toPlanView(row: PlanRow): PlanView {
  return {
    id: row.planId,
    kind: row.planKind,
    name: row.planName,
    monthlyAllowance: row.monthlyAllowance,
    maxPerRequest: row.maxPerRequest,
    predefined: row.ownerAccountId === null,
  };
}

function visibleTo(accountId: string) {
  return or(isNull(plans.ownerAccountId), eq(plans.ownerAccountId, accountId));
}

export async function getVisiblePlan(
  accountId: string,
  planId: string,
): Promise<PlanView> {
  const [row] = await db
    .select(planColumns)
    .from(plans)
    .where(and(eq(plans.id, planId), visibleTo(accountId)));

  if (row === undefined) {
    throw new NotFoundError("Plan not found", "plan_not_found");
  }
  return toPlanView(row);
}

export async function getAssignablePlan(
  accountId: string,
  planId: string,
  kind: PlanKind,
): Promise<PlanView> {
  const plan = await getVisiblePlan(accountId, planId);
  if (plan.kind !== kind) {
    throw new BadRequestError(
      `Plan '${plan.name}' has kind '${plan.kind}', but kind '${kind}' is required`,
      "wrong_plan_kind",
    );
  }
  return plan;
}

export async function listPlans(
  accountId: string,
  kind: PlanKind | undefined,
): Promise<PlanView[]> {
  const rows = await db
    .select(planColumns)
    .from(plans)
    .where(
      and(
        visibleTo(accountId),
        kind === undefined ? undefined : eq(plans.kind, kind),
      ),
    )
    .orderBy(plans.kind, plans.name);

  return rows.map(toPlanView);
}

export async function createPlan(
  accountId: string,
  input: NewPlan,
): Promise<PlanView> {
  const [row] = await db
    .insert(plans)
    .values({ ...input, ownerAccountId: accountId })
    .returning(planColumns);

  if (row === undefined) {
    throw new Error("Failed to create plan");
  }
  return toPlanView(row);
}

export async function updatePlan(
  accountId: string,
  planId: string,
  changes: PlanChanges,
): Promise<PlanView> {
  const existing = await getVisiblePlan(accountId, planId);
  if (existing.predefined) {
    throw new ForbiddenError(
      "Predefined plans are read-only",
      "predefined_plan_read_only",
    );
  }

  const [row] = await db
    .update(plans)
    .set(changes)
    .where(and(eq(plans.id, planId), eq(plans.ownerAccountId, accountId)))
    .returning(planColumns);

  if (row === undefined) {
    throw new NotFoundError("Plan not found", "plan_not_found");
  }
  return toPlanView(row);
}
