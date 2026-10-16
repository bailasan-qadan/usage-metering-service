import { and, count, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  accounts,
  accountUsage,
  plans,
  userUsage,
  users,
} from "../db/schema.js";
import { BadRequestError, NotFoundError } from "../errors.js";
import { formatMonth, utcMonthStart } from "../months.js";
import type { Pagination } from "../validation.js";
import { remainingUnits } from "./decision.js";

export type UsageLevel = {
  plan: string;
  monthlyAllowance: number;
  maxPerRequest: number;
  used: number;
  remaining: number | null;
};

export type UserUsage = UsageLevel & { userId: string };

export type AccountUsageResult = {
  month: string;
  account: UsageLevel;
  users: UserUsage[];
  pagination: { limit: number; offset: number; total: number };
};

type PlanLimits = {
  name: string;
  monthlyAllowance: number;
  maxPerRequest: number;
};

function resolveMonth(
  requested: string | undefined,
  now: Date,
): { month: string; isCurrent: boolean } {
  const currentMonth = utcMonthStart(now);
  const month = requested ?? currentMonth;
  if (month > currentMonth) {
    throw new BadRequestError(
      "'month' cannot be in the future",
      "month_in_future",
    );
  }
  return { month, isCurrent: month === currentMonth };
}

function toUsageLevel(
  plan: PlanLimits,
  used: number,
  isCurrent: boolean,
): UsageLevel {
  return {
    plan: plan.name,
    monthlyAllowance: plan.monthlyAllowance,
    maxPerRequest: plan.maxPerRequest,
    used,
    remaining: isCurrent ? remainingUnits({ ...plan, used }) : null,
  };
}

export async function getAccountUsage(
  accountId: string,
  requestedMonth: string | undefined,
  page: Pagination,
  now: Date = new Date(),
): Promise<AccountUsageResult> {
  const { month, isCurrent } = resolveMonth(requestedMonth, now);

  return db.transaction(
    async (tx) => {
      const [accountRow] = await tx
        .select({
          name: plans.name,
          monthlyAllowance: plans.monthlyAllowance,
          maxPerRequest: plans.maxPerRequest,
          used: accountUsage.unitsUsed,
        })
        .from(accounts)
        .innerJoin(plans, eq(accounts.planId, plans.id))
        .leftJoin(
          accountUsage,
          and(
            eq(accountUsage.accountId, accounts.id),
            eq(accountUsage.month, month),
          ),
        )
        .where(eq(accounts.id, accountId));

      if (accountRow === undefined) {
        throw new NotFoundError("Account not found", "account_not_found");
      }

      const userRows = await tx
        .select({
          userId: users.externalId,
          name: plans.name,
          monthlyAllowance: plans.monthlyAllowance,
          maxPerRequest: plans.maxPerRequest,
          used: userUsage.unitsUsed,
        })
        .from(users)
        .innerJoin(plans, eq(users.planId, plans.id))
        .leftJoin(
          userUsage,
          and(eq(userUsage.userId, users.id), eq(userUsage.month, month)),
        )
        .where(eq(users.accountId, accountId))
        .orderBy(users.externalId)
        .limit(page.limit)
        .offset(page.offset);

      const [totalRow] = await tx
        .select({ total: count() })
        .from(users)
        .where(eq(users.accountId, accountId));

      return {
        month: formatMonth(month),
        account: toUsageLevel(accountRow, accountRow.used ?? 0, isCurrent),
        users: userRows.map(
          (row): UserUsage => ({
            userId: row.userId,
            ...toUsageLevel(row, row.used ?? 0, isCurrent),
          }),
        ),
        pagination: {
          limit: page.limit,
          offset: page.offset,
          total: totalRow?.total ?? 0,
        },
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export async function getUserUsage(
  accountId: string,
  userId: string,
  requestedMonth: string | undefined,
  now: Date = new Date(),
): Promise<{ month: string; user: UserUsage }> {
  const { month, isCurrent } = resolveMonth(requestedMonth, now);

  const [row] = await db
    .select({
      userId: users.externalId,
      name: plans.name,
      monthlyAllowance: plans.monthlyAllowance,
      maxPerRequest: plans.maxPerRequest,
      used: userUsage.unitsUsed,
    })
    .from(users)
    .innerJoin(plans, eq(users.planId, plans.id))
    .leftJoin(
      userUsage,
      and(eq(userUsage.userId, users.id), eq(userUsage.month, month)),
    )
    .where(and(eq(users.accountId, accountId), eq(users.externalId, userId)));

  if (row === undefined) {
    throw new NotFoundError("User not found", "user_not_found");
  }

  return {
    month: formatMonth(month),
    user: {
      userId: row.userId,
      ...toUsageLevel(row, row.used ?? 0, isCurrent),
    },
  };
}
