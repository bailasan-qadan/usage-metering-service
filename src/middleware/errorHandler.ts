import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../errors.js";

function isBodyParseError(err: unknown): boolean {
  return (
    err instanceof SyntaxError &&
    "type" in err &&
    err.type === "entity.parse.failed"
  );
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res
      .status(err.statusCode)
      .json({ error: { code: err.code, message: err.message } });
    return;
  }

  if (isBodyParseError(err)) {
    res.status(400).json({
      error: { code: "invalid_json", message: "Request body is not valid JSON" },
    });
    return;
  }

  console.error("Unhandled error:", err);
  res.status(500).json({
    error: { code: "internal_error", message: "Internal server error" },
  });
}
