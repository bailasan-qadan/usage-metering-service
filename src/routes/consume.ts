import { Router } from "express";
import { authenticatedAccountId, requireApiKey } from "../middleware/auth.js";
import { consume } from "../services/consume.js";
import {
  parseRequestId,
  parseUnits,
  parseUserId,
  requireBody,
} from "../validation.js";

export const consumeRouter = Router();

consumeRouter.use(requireApiKey);

consumeRouter.post("/", async (req, res) => {
  const body = requireBody(req.body);

  const result = await consume({
    accountId: authenticatedAccountId(req),
    userId: parseUserId(body.userId),
    requestId: parseRequestId(body.requestId),
    units: parseUnits(body.units),
  });

  res.json(result);
});
