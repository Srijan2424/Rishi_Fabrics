import { Router } from "express";
import { z } from "zod";
import { WorkflowEngineService } from "../../core/workflow-engine/workflow-engine.service.js";
import { asyncRoute } from "../../http.js";
import { requirePermission } from "../../security/rbac.js";

const router = Router();
const engine = new WorkflowEngineService();

const movementSchema = z.object({
  orderId: z.string(),
  fromStageId: z.string(),
  toStageId: z.string(),
  quantity: z.number().int().positive(),
  notes: z.string().optional()
});

router.post(
  "/move-forward",
  requirePermission("MOVE_INVENTORY"),
  asyncRoute(async (req, res) => {
    const input = movementSchema.parse(req.body);
    const result = await engine.moveForward({
      ...input,
      createdBy: req.authUser?.id
    });

    res.status(201).json(result);
  })
);

router.post(
  "/rollback",
  requirePermission("MOVE_INVENTORY"),
  asyncRoute(async (req, res) => {
    const input = movementSchema.parse(req.body);
    const result = await engine.rollback({
      ...input,
      createdBy: req.authUser?.id
    });

    res.status(201).json(result);
  })
);

export default router;
