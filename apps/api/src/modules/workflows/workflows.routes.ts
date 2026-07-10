import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";

export const workflowsRouter = Router();

type WorkflowStageInput = {
  name: string;
  code: string;
  kind: "MANUAL" | "AUTOMATIC" | "HYBRID";
  category: "APPROVAL" | "PRODUCTION" | "INSPECTION" | "REWORK" | "DISPATCH";
  sequence: number;
  allowsPartial: boolean;
  allowsRollback: boolean;
  isDispatchStage: boolean;
};

const createWorkflowSchema = z.object({
  factoryId: z.string(),
  name: z.string().min(2),
  description: z.string().optional(),

  stages: z.array(
    z.object({
      name: z.string().min(2),

      code: z.string().min(2),

      kind: z.enum([
        "MANUAL",
        "AUTOMATIC",
        "HYBRID"
      ]),

      category: z.enum([
        "APPROVAL",
        "PRODUCTION",
        "INSPECTION",
        "REWORK",
        "DISPATCH"
      ]),

      sequence: z.number().int().positive(),

      allowsPartial: z.boolean().default(true),

      allowsRollback: z.boolean().default(true),

      isDispatchStage: z.boolean().default(false)
    })
  ).min(1)
});

workflowsRouter.get("/", asyncRoute(async (req, res) => {
  const factoryId = String(req.query.factoryId ?? "");

  const workflows = await prisma.workflowTemplate.findMany({
    where: factoryId ? { factoryId } : undefined,
    include: { stages: { orderBy: { sequence: "asc" } } },
    orderBy: { createdAt: "desc" }
  });

  res.json(workflows);
}));

workflowsRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const input = createWorkflowSchema.parse(req.body);

    const workflow = await prisma.workflowTemplate.create({
      data: {
        factoryId: input.factoryId,

        name: input.name,

        description: input.description,

        stages: {
          create: input.stages.map((stage: WorkflowStageInput) => ({
            name: stage.name,

            code: stage.code,

            kind: stage.kind,

            category: stage.category,

            sequence: stage.sequence,

            allowsPartial: stage.allowsPartial,

            allowsRollback: stage.allowsRollback,

            isDispatchStage: stage.isDispatchStage
          }))
        }
      },

      include: {
        stages: {
          orderBy: {
            sequence: "asc"
          }
        }
      }
    });

    res.status(201).json(workflow);
  })
);
