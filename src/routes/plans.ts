import { Router } from "express";
import { authenticatedAccountId, requireApiKey } from "../middleware/auth.js";
import {
  createPlan,
  getVisiblePlan,
  listPlans,
  updatePlan,
} from "../services/plans.js";
import {
  parseNewPlan,
  parsePlanChanges,
  parsePlanId,
  parsePlanKind,
} from "../validation.js";

export const plansRouter = Router();

plansRouter.use(requireApiKey);

plansRouter.get("/", async (req, res) => {
  const kind =
    req.query.kind === undefined ? undefined : parsePlanKind(req.query.kind);
  const plans = await listPlans(authenticatedAccountId(req), kind);
  res.json({ plans });
});

plansRouter.get("/:planId", async (req, res) => {
  const planId = parsePlanId(req.params.planId);
  const plan = await getVisiblePlan(authenticatedAccountId(req), planId);
  res.json({ plan });
});

plansRouter.post("/", async (req, res) => {
  const plan = await createPlan(
    authenticatedAccountId(req),
    parseNewPlan(req.body),
  );
  res.status(201).json({ plan });
});

plansRouter.patch("/:planId", async (req, res) => {
  const planId = parsePlanId(req.params.planId);
  const plan = await updatePlan(
    authenticatedAccountId(req),
    planId,
    parsePlanChanges(req.body),
  );
  res.json({ plan });
});
