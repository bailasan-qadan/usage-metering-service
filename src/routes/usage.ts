import { Router } from "express";
import { authenticatedAccountId, requireApiKey } from "../middleware/auth.js";
import { getAccountUsage } from "../services/usage.js";
import { parseMonthParam, parsePagination } from "../validation.js";

export const usageRouter = Router();

usageRouter.use(requireApiKey);

usageRouter.get("/", async (req, res) => {
  const result = await getAccountUsage(
    authenticatedAccountId(req),
    parseMonthParam(req.query.month),
    parsePagination(req.query),
  );
  res.json(result);
});
