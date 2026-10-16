import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { plans } from "../db/schema.js";
import { BadRequestError, NotFoundError } from "../errors.js";

export type PlanKind = "account" | "user";

export type PlanView = {
  id: string;
  kind: PlanKind;
  name: string;
  monthlyAllowance: number;
  maxPerRequest: number;
  predefined: boolean;
};

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

export async function getAssignablePlan(
  accountId: string,
  planId: string,
  kind: PlanKind,
): Promise<PlanView> {
  const [row] = await db
    .select(planColumns)
    .from(plans)
    .where(
      and(
        eq(plans.id, planId),
        or(isNull(plans.ownerAccountId), eq(plans.ownerAccountId, accountId)),
      ),
    );

  if (row === undefined) {
    throw new NotFoundError("Plan not found", "plan_not_found");
  }
  if (row.planKind !== kind) {
    throw new BadRequestError(
      `Plan '${row.planName}' is a ${row.planKind} plan, but a ${kind} plan is required`,
      "wrong_plan_kind",
    );
  }
  return toPlanView(row);
}
