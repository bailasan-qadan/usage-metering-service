import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  accounts,
  accountUsage,
  consumptionRequests,
  plans,
  userUsage,
  users,
} from "../db/schema.js";
import { ConflictError, NotFoundError } from "../errors.js";
import { formatMonth, utcMonthStart } from "../months.js";
import {
  decide,
  describeRejection,
  remainingUnits,
  type LevelState,
  type Rejection,
} from "./decision.js";

export type ConsumeInput = {
  accountId: string;
  userId: string;
  requestId: string;
  units: number;
};

export type LevelReport = {
  plan: string;
  monthlyAllowance: number;
  maxPerRequest: number;
  used: number;
  remaining: number;
};

export type ConsumeResult = {
  accepted: boolean;
  requestId: string;
  userId: string;
  units: number;
  month: string;
  replayed: boolean;
  rejection: (Rejection & { message: string }) | null;
  account: LevelReport;
  user: LevelReport;
};

function report(planName: string, state: LevelState): LevelReport {
  return {
    plan: planName,
    monthlyAllowance: state.monthlyAllowance,
    maxPerRequest: state.maxPerRequest,
    used: state.used,
    remaining: remainingUnits(state),
  };
}

function buildResult(args: {
  input: ConsumeInput;
  month: string;
  replayed: boolean;
  rejection: Rejection | null;
  accountPlan: string;
  accountState: LevelState;
  userPlan: string;
  userState: LevelState;
}): ConsumeResult {
  return {
    accepted: args.rejection === null,
    requestId: args.input.requestId,
    userId: args.input.userId,
    units: args.input.units,
    month: formatMonth(args.month),
    replayed: args.replayed,
    rejection:
      args.rejection === null
        ? null
        : { ...args.rejection, message: describeRejection(args.rejection) },
    account: report(args.accountPlan, args.accountState),
    user: report(args.userPlan, args.userState),
  };
}

export async function consume(
  input: ConsumeInput,
  now: Date = new Date(),
): Promise<ConsumeResult> {
  const month = utcMonthStart(now);

  return db.transaction(async (tx) => {
    // 1. The user must belong to the calling account.
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.accountId, input.accountId),
          eq(users.externalId, input.userId),
        ),
      );
    if (user === undefined) {
      throw new NotFoundError("User not found", "user_not_found");
    }

    // 2. Create-or-lock this month's counters: the shared account counter
    //    first, then the user's. The "update" does not change the value, but
    //    it takes a row lock that is held until the transaction ends. Every
    //    request locks in the same order, so requests of one account queue up
    //    here (no overspending, no deadlocks) while other accounts run in parallel.
    const [accountCounter] = await tx
      .insert(accountUsage)
      .values({ accountId: input.accountId, month, unitsUsed: 0 })
      .onConflictDoUpdate({
        target: [accountUsage.accountId, accountUsage.month],
        set: { unitsUsed: sql`${accountUsage.unitsUsed}` },
      })
      .returning({ used: accountUsage.unitsUsed });

    const [userCounter] = await tx
      .insert(userUsage)
      .values({ userId: user.id, month, unitsUsed: 0 })
      .onConflictDoUpdate({
        target: [userUsage.userId, userUsage.month],
        set: { unitsUsed: sql`${userUsage.unitsUsed}` },
      })
      .returning({ used: userUsage.unitsUsed });

    if (accountCounter === undefined || userCounter === undefined) {
      throw new Error("Failed to lock usage counters");
    }

    // 3. Read the plans that apply right now, while holding the locks.
    //    (Always use `tx` here, never `db`: `db` would use a different
    //    connection, outside this transaction.)
    const [accountPlan] = await tx
      .select({
        name: plans.name,
        monthlyAllowance: plans.monthlyAllowance,
        maxPerRequest: plans.maxPerRequest,
      })
      .from(accounts)
      .innerJoin(plans, eq(accounts.planId, plans.id))
      .where(eq(accounts.id, input.accountId));

    const [userPlan] = await tx
      .select({
        name: plans.name,
        monthlyAllowance: plans.monthlyAllowance,
        maxPerRequest: plans.maxPerRequest,
      })
      .from(users)
      .innerJoin(plans, eq(users.planId, plans.id))
      .where(eq(users.id, user.id));

    if (accountPlan === undefined || userPlan === undefined) {
      throw new Error("Plan not found for account or user");
    }

    const accountState: LevelState = { ...accountPlan, used: accountCounter.used };
    const userState: LevelState = { ...userPlan, used: userCounter.used };

    // 4. Retry check. Because we hold the account lock, two requests with the
    //    same requestId can never run this check at the same time.
    const [previous] = await tx
      .select({
        userId: consumptionRequests.userId,
        units: consumptionRequests.units,
        month: consumptionRequests.month,
        rejectedLevel: consumptionRequests.rejectedLevel,
        rejectedRule: consumptionRequests.rejectedRule,
      })
      .from(consumptionRequests)
      .where(
        and(
          eq(consumptionRequests.accountId, input.accountId),
          eq(consumptionRequests.requestId, input.requestId),
        ),
      );

    if (previous !== undefined) {
      if (previous.userId !== user.id || previous.units !== input.units) {
        throw new ConflictError(
          "This requestId was already used with a different user or number of units",
          "request_id_conflict",
        );
      }
      
      const [originalAccountCounter] = await tx
        .select({ used: accountUsage.unitsUsed })
        .from(accountUsage)
        .where(
          and(
            eq(accountUsage.accountId, input.accountId),
            eq(accountUsage.month, previous.month),
          ),
        );

      const [originalUserCounter] = await tx
        .select({ used: userUsage.unitsUsed })
        .from(userUsage)
        .where(
          and(
            eq(userUsage.userId, user.id),
            eq(userUsage.month, previous.month),
          ),
        );

      return buildResult({
        input,
        month: previous.month,
        replayed: true,
        rejection:
          previous.rejectedLevel !== null && previous.rejectedRule !== null
            ? { level: previous.rejectedLevel, rule: previous.rejectedRule }
            : null,
        accountPlan: accountPlan.name,
        accountState: {
          ...accountState,
          used: originalAccountCounter?.used ?? 0,
        },
        userPlan: userPlan.name,
        userState: {
          ...userState,
          used: originalUserCounter?.used ?? 0,
        },
      });
    }

    // 5. Decide.
    const decision = decide(input.units, userState, accountState);

    // 6. Count the usage (accepted only) and record the decision (always).
    if (decision.accepted) {
      await tx
        .update(accountUsage)
        .set({ unitsUsed: sql`${accountUsage.unitsUsed} + ${input.units}` })
        .where(
          and(
            eq(accountUsage.accountId, input.accountId),
            eq(accountUsage.month, month),
          ),
        );
      await tx
        .update(userUsage)
        .set({ unitsUsed: sql`${userUsage.unitsUsed} + ${input.units}` })
        .where(and(eq(userUsage.userId, user.id), eq(userUsage.month, month)));
    }

    await tx.insert(consumptionRequests).values({
      accountId: input.accountId,
      userId: user.id,
      requestId: input.requestId,
      units: input.units,
      month,
      accepted: decision.accepted,
      rejectedLevel: decision.accepted ? null : decision.rejection.level,
      rejectedRule: decision.accepted ? null : decision.rejection.rule,
    });

    const added = decision.accepted ? input.units : 0;
    return buildResult({
      input,
      month,
      replayed: false,
      rejection: decision.accepted ? null : decision.rejection,
      accountPlan: accountPlan.name,
      accountState: { ...accountState, used: accountState.used + added },
      userPlan: userPlan.name,
      userState: { ...userState, used: userState.used + added },
    });
  });
}
