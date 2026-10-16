import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { consumptionRequests, users } from "../db/schema.js";
import { formatMonth } from "../months.js";
import type { Pagination } from "../validation.js";
import { describeRejection, type Rejection } from "./decision.js";

export type RequestRecord = {
  requestId: string;
  userId: string;
  units: number;
  month: string;
  accepted: boolean;
  rejection: (Rejection & { message: string }) | null;
  createdAt: Date;
};

export type RequestFilters = { month?: string; userId?: string };

export type RequestHistory = {
  requests: RequestRecord[];
  pagination: { limit: number; offset: number; total: number };
};

export async function listRequests(
  accountId: string,
  filters: RequestFilters,
  page: Pagination,
): Promise<RequestHistory> {
  const where = and(
    eq(consumptionRequests.accountId, accountId),
    filters.month === undefined
      ? undefined
      : eq(consumptionRequests.month, filters.month),
    filters.userId === undefined
      ? undefined
      : eq(users.externalId, filters.userId),
  );

  return db.transaction(
    async (tx) => {
      const rows = await tx
        .select({
          requestId: consumptionRequests.requestId,
          userId: users.externalId,
          units: consumptionRequests.units,
          month: consumptionRequests.month,
          accepted: consumptionRequests.accepted,
          rejectedLevel: consumptionRequests.rejectedLevel,
          rejectedRule: consumptionRequests.rejectedRule,
          createdAt: consumptionRequests.createdAt,
        })
        .from(consumptionRequests)
        .innerJoin(users, eq(consumptionRequests.userId, users.id))
        .where(where)
        .orderBy(desc(consumptionRequests.createdAt), desc(consumptionRequests.id))
        .limit(page.limit)
        .offset(page.offset);

      const [totalRow] = await tx
        .select({ total: count() })
        .from(consumptionRequests)
        .innerJoin(users, eq(consumptionRequests.userId, users.id))
        .where(where);

      return {
        requests: rows.map(
          (row): RequestRecord => ({
            requestId: row.requestId,
            userId: row.userId,
            units: row.units,
            month: formatMonth(row.month),
            accepted: row.accepted,
            rejection:
              row.rejectedLevel !== null && row.rejectedRule !== null
                ? {
                    level: row.rejectedLevel,
                    rule: row.rejectedRule,
                    message: describeRejection({
                      level: row.rejectedLevel,
                      rule: row.rejectedRule,
                    }),
                  }
                : null,
            createdAt: row.createdAt,
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
