import { Router } from "express";
import { authenticatedAccountId, requireApiKey } from "../middleware/auth.js";
import { listRequests } from "../services/history.js";
import {
  parseMonthParam,
  parsePagination,
  parseUserId,
} from "../validation.js";

export const requestsRouter = Router();

requestsRouter.use(requireApiKey);

requestsRouter.get("/", async (req, res) => {
  const userId =
    req.query.userId === undefined ? undefined : parseUserId(req.query.userId);

  const result = await listRequests(
    authenticatedAccountId(req),
    { month: parseMonthParam(req.query.month), userId },
    parsePagination(req.query),
  );
  res.json(result);
});
