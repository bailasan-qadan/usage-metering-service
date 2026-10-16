import { db } from "./index.js";
import { plans } from "./schema.js";

export const PREDEFINED_PLAN_IDS = {
  starter: "00000000-0000-4000-8000-000000000001",
  pro: "00000000-0000-4000-8000-000000000002",
  basic: "00000000-0000-4000-8000-000000000003",
  premium: "00000000-0000-4000-8000-000000000004",
} as const;

const predefinedPlans: (typeof plans.$inferInsert)[] = [
  {
    id: PREDEFINED_PLAN_IDS.starter,
    kind: "account",
    name: "Starter",
    monthlyAllowance: 10_000,
    maxPerRequest: 100,
  },
  {
    id: PREDEFINED_PLAN_IDS.pro,
    kind: "account",
    name: "Pro",
    monthlyAllowance: 100_000,
    maxPerRequest: 1_000,
  },
  {
    id: PREDEFINED_PLAN_IDS.basic,
    kind: "user",
    name: "Basic",
    monthlyAllowance: 1_000,
    maxPerRequest: 20,
  },
  {
    id: PREDEFINED_PLAN_IDS.premium,
    kind: "user",
    name: "Premium",
    monthlyAllowance: 5_000,
    maxPerRequest: 100,
  },
];

export async function seedPredefinedPlans(): Promise<void> {
  await db
    .insert(plans)
    .values(predefinedPlans)
    .onConflictDoNothing({ target: plans.id });
}
