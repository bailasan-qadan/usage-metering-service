import { BadRequestError } from "./errors.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireBody(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    throw new BadRequestError("Body must be a JSON object", "invalid_body");
  }
  return body;
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
