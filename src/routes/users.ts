import { Router } from "express";
import { authenticatedAccountId, requireApiKey } from "../middleware/auth.js";
import { assignUserPlan, getUser, registerUser } from "../services/users.js";
import { parsePlanId, parseUserId, requireBody } from "../validation.js";

export const usersRouter = Router();

usersRouter.use(requireApiKey);

usersRouter.post("/", async (req, res) => {
  const body = requireBody(req.body);
  const userId = parseUserId(body.userId);
  const planId =
    body.planId === undefined ? undefined : parsePlanId(body.planId);

  const user = await registerUser(authenticatedAccountId(req), userId, planId);
  res.status(201).json({ user });
});

usersRouter.get("/:userId", async (req, res) => {
  const userId = parseUserId(req.params.userId);
  const user = await getUser(authenticatedAccountId(req), userId);
  res.json({ user });
});

usersRouter.put("/:userId/plan", async (req, res) => {
  const userId = parseUserId(req.params.userId);
  const planId = parsePlanId(requireBody(req.body).planId);

  const user = await assignUserPlan(authenticatedAccountId(req), userId, planId);
  res.json({ user });
});
