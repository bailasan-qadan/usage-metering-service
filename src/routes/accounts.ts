import { Router } from "express";
import { BadRequestError } from "../errors.js";
import { authenticatedAccountId, requireApiKey } from "../middleware/auth.js";
import {
  assignAccountPlan,
  createAccount,
  getAccount,
} from "../services/accounts.js";
import { parsePlanId, requireBody } from "../validation.js";

export const accountsRouter = Router();

function parseCreateAccountBody(body: unknown): { name: string } {
  if (
    typeof body !== "object" ||
    body === null ||
    !("name" in body) ||
    typeof body.name !== "string"
  ) {
    throw new BadRequestError(
      "Body must be a JSON object with a string 'name'",
      "invalid_body",
    );
  }

  const name = body.name.trim();
  if (name.length === 0 || name.length > 200) {
    throw new BadRequestError(
      "'name' must be between 1 and 200 characters",
      "invalid_name",
    );
  }
  return { name };
}

accountsRouter.post("/accounts", async (req, res) => {
  const { name } = parseCreateAccountBody(req.body);
  const { account, apiKey } = await createAccount(name);
  res.status(201).json({ account, apiKey });
});

accountsRouter.get("/account", requireApiKey, async (req, res) => {
  const account = await getAccount(authenticatedAccountId(req));
  res.json({ account });
});

accountsRouter.put("/account/plan", requireApiKey, async (req, res) => {
  const planId = parsePlanId(requireBody(req.body).planId);
  const account = await assignAccountPlan(authenticatedAccountId(req), planId);
  res.json({ account });
});
