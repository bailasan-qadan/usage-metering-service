import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { hashApiKey } from "../auth/apiKeys.js";
import { db } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import { UnauthorizedError } from "../errors.js";

export async function requireApiKey(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const key = req.get("X-API-Key");
  if (key === undefined || key === "") {
    throw new UnauthorizedError("Missing API key", "missing_api_key");
  }

  const [row] = await db
    .select({ accountId: apiKeys.accountId })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hashApiKey(key)))
    .limit(1);

  if (row === undefined) {
    throw new UnauthorizedError("Invalid API key", "invalid_api_key");
  }

  req.accountId = row.accountId;
  next();
}

export function authenticatedAccountId(req: Request): string {
  if (req.accountId === undefined) {
    throw new UnauthorizedError("Missing API key", "missing_api_key");
  }
  return req.accountId;
}
