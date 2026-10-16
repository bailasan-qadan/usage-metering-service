import { BadRequestError } from "./errors.js";
import type { NewPlan, PlanChanges, PlanKind } from "./services/plans.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_INT32 = 2_147_483_647;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireBody(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    throw new BadRequestError("Body must be a JSON object", "invalid_body");
  }
  return body;
}

function parseInteger(
  value: unknown,
  field: string,
  code: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new BadRequestError(
      `'${field}' must be a whole number between ${min} and ${max}`,
      code,
    );
  }
  return value;
}

export function parseUserId(value: unknown): string {
  if (typeof value !== "string") {
    throw new BadRequestError("'userId' must be a string", "invalid_user_id");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    throw new BadRequestError(
      "'userId' must be between 1 and 200 characters",
      "invalid_user_id",
    );
  }
  return trimmed;
}

export function parsePlanId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new BadRequestError("'planId' must be a valid UUID", "invalid_plan_id");
  }
  return value;
}

export function parsePlanKind(value: unknown): PlanKind {
  if (value === "account" || value === "user") {
    return value;
  }
  throw new BadRequestError(
    "'kind' must be 'account' or 'user'",
    "invalid_kind",
  );
}

function parsePlanName(value: unknown): string {
  if (typeof value !== "string") {
    throw new BadRequestError("'name' must be a string", "invalid_plan_name");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 100) {
    throw new BadRequestError(
      "'name' must be between 1 and 100 characters",
      "invalid_plan_name",
    );
  }
  return trimmed;
}

function parseMonthlyAllowance(value: unknown): number {
  return parseInteger(
    value,
    "monthlyAllowance",
    "invalid_monthly_allowance",
    0,
    Number.MAX_SAFE_INTEGER,
  );
}

function parseMaxPerRequest(value: unknown): number {
  return parseInteger(
    value,
    "maxPerRequest",
    "invalid_max_per_request",
    1,
    MAX_INT32,
  );
}

export function parseNewPlan(body: unknown): NewPlan {
  const fields = requireBody(body);
  return {
    kind: parsePlanKind(fields.kind),
    name: parsePlanName(fields.name),
    monthlyAllowance: parseMonthlyAllowance(fields.monthlyAllowance),
    maxPerRequest: parseMaxPerRequest(fields.maxPerRequest),
  };
}

export function parsePlanChanges(body: unknown): PlanChanges {
  const fields = requireBody(body);

  if (fields.kind !== undefined) {
    throw new BadRequestError(
      "A plan's kind cannot be changed",
      "kind_not_updatable",
    );
  }

  const changes: PlanChanges = {};
  if (fields.name !== undefined) {
    changes.name = parsePlanName(fields.name);
  }
  if (fields.monthlyAllowance !== undefined) {
    changes.monthlyAllowance = parseMonthlyAllowance(fields.monthlyAllowance);
  }
  if (fields.maxPerRequest !== undefined) {
    changes.maxPerRequest = parseMaxPerRequest(fields.maxPerRequest);
  }

  if (Object.keys(changes).length === 0) {
    throw new BadRequestError(
      "Provide at least one of: name, monthlyAllowance, maxPerRequest",
      "no_changes",
    );
  }
  return changes;
}
