import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";
import { createEvent } from "../events/event.service.js";
import { requirePermission } from "../../security/rbac.js";
import { recordWorkLog } from "../work-logs/work-log.service.js";

export const ordersRouter = Router();

type WorkflowStageLite = {
  id: string;
  code: string;
  name: string;
};

type TransactionClient = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

const createOrderSchema = z.object({
  factoryId: z.string(),
  workflowTemplateId: z.string(),
  orderNumber: z.string().min(2),
  buyerName: z.string().min(2),
  productCategory: z.string().min(2),
  orderQuantity: z.number().int().positive(),
  deliveryDate: z.string().datetime()
});

const moveMaterialSchema = z.object({
  fromStageCode: z.string().min(1),
  toStageCode: z.string().min(1),
  quantity: z.number().int().positive(),
  movementType: z.enum(["FORWARD", "ROLLBACK", "REWORK", "SCRAP", "DISPATCH"]).default("FORWARD"),
  notes: z.string().optional()
});

const createReworkSchema = z.object({
  sourceStageCode: z.string(),
  quantity: z.number().int().positive(),
  reason: z.string().min(3)
});

const samplingDecisionSchema = z.object({
  action: z.enum(["REMOVE", "REVIVE", "APPROVE_FOR_PRODUCTION"]),
  target: z.enum(["STYLE", "ORDER"]).default("STYLE"),
  reason: z.string().optional()
});

const samplingApprovalSchema = z.object({
  status: z.enum(["PENDING", "SUBMITTED", "APPROVED", "REVISION_REQUIRED"]),
  comments: z.string().optional()
});

const samplingQuantitySchema = z.object({
  orderQuantity: z.number().int().positive()
});

const samplingDetailsSchema = z.object({
  orderNumber: z.string().min(2).max(80),
  buyerName: z.string().min(2).max(120),
  productCategory: z.string().min(2).max(120)
});

const samplingStageCodes = new Set([
  "INQUIRY",
  "DEVELOPMENT",
  "SAMPLE_CREATION",
  "SAMPLE_APPROVAL",
  "ORDER_CONFIRMATION",
  "LAB_DIP_APPROVAL",
  "FOB_APPROVAL",
  "PO_CONFIRMATION"
]);

const samplingCheckpoints = [
  {
    checkpointCode: "LAB_DIP_APPROVAL",
    label: "Lab Dip Approval by Buyer",
    owner: "Merchant",
    timeframe: "Variable",
    evidence: "Buyer approval comment or shade confirmation"
  },
  {
    checkpointCode: "FOB_APPROVAL",
    label: "FOB Approval by Buyer",
    owner: "Merchant",
    timeframe: "Variable",
    evidence: "Buyer approval or revised costing confirmation"
  },
  {
    checkpointCode: "PO",
    label: "P.O",
    owner: "Merchant",
    timeframe: "Required before production lock",
    evidence: "Purchase order reference"
  },
  {
    checkpointCode: "FABRIC_CUTTING_SWATCH",
    label: "Fabric Cutting Swatch",
    owner: "Sampling / Fabric",
    timeframe: "Internal",
    evidence: "Swatch cutting status"
  },
  {
    checkpointCode: "SIZE_RATIO",
    label: "Size Ratio",
    owner: "Merchant",
    timeframe: "Qty in pcs",
    evidence: "Ratio quantity confirmation"
  },
  {
    checkpointCode: "TRIMS_CARD",
    label: "Trims Card with Trims",
    owner: "Merchant / Store",
    timeframe: "Internal",
    evidence: "Trim card image or checklist"
  },
  {
    checkpointCode: "PP_COMMENTS",
    label: "P.P Comments from Buyer Side",
    owner: "Merchant",
    timeframe: "Variable",
    evidence: "Buyer comments and revision notes"
  },
  {
    checkpointCode: "PP_SEALER_GARMENT",
    label: "PP Sealer Garment",
    owner: "Sampling",
    timeframe: "Before bulk approval",
    evidence: "Sealer garment approval"
  },
  {
    checkpointCode: "SIZE_SET_APPROVAL",
    label: "Size Set Approval",
    owner: "Merchant / Buyer",
    timeframe: "Variable, domestic only",
    evidence: "Domestic size set approval"
  }
];

async function ensureSamplingApprovals(orderId: string) {
  for (const checkpoint of samplingCheckpoints) {
    await prisma.samplingApproval.upsert({
      where: {
        orderId_checkpointCode: {
          orderId,
          checkpointCode: checkpoint.checkpointCode
        }
      },
      update: {},
      create: {
        orderId,
        ...checkpoint
      }
    });
  }

  return prisma.samplingApproval.findMany({
    where: {
      orderId
    },
    orderBy: {
      createdAt: "asc"
    }
  });
}

async function getFirstProductionStage(workflowTemplateId: string) {
  return prisma.workflowStage.findFirst({
    where: {
      workflowTemplateId,
      category: {
        in: ["PRODUCTION", "INSPECTION", "DISPATCH"]
      }
    },
    orderBy: {
      sequence: "asc"
    }
  });
}

ordersRouter.get("/", asyncRoute(async (req, res) => {
  const factoryId = String(req.query.factoryId ?? "");

  const orders = await prisma.order.findMany({
    where: factoryId ? { factoryId } : undefined,
    include: {
      stages: { orderBy: { createdAt: "asc" } },
      materialMovements: { orderBy: { createdAt: "desc" }, take: 10 },
      reworkTickets: { orderBy: { createdAt: "desc" }, take: 10 },
      samplingApprovals: { orderBy: { createdAt: "asc" } }
    },
    orderBy: { createdAt: "desc" }
  });

  res.json(orders);
}));

ordersRouter.get("/:id", asyncRoute(async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: String(req.params.id)},
    include: {
      workflowTemplate: true,
      stages: { orderBy: { createdAt: "asc" } },
      materialMovements: { orderBy: { createdAt: "desc" } },
      reworkTickets: { orderBy: { createdAt: "desc" } },
      samplingApprovals: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "desc" } }
    }
  });

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  res.json(order);
}));

ordersRouter.post("/", asyncRoute(async (req, res) => {
  const input = createOrderSchema.parse(req.body);

  const workflowStages = await prisma.workflowStage.findMany({
    where: { workflowTemplateId: input.workflowTemplateId },
    orderBy: { sequence: "asc" }
  });

  if (workflowStages.length === 0) {
    res.status(400).json({ error: "Workflow has no stages" });
    return;
  }

  const order = await prisma.order.create({
    data: {
      ...input,
      deliveryDate: new Date(input.deliveryDate),
      currentStageCode: workflowStages[0].code,
      stages: {
        create: workflowStages.map((stage: WorkflowStageLite) => ({
          workflowStageId: stage.id,
          stageCode: stage.code,
          stageName: stage.name,
          plannedQuantity: input.orderQuantity
        }))
      }
    },
    include: { stages: true }
  });

  await createEvent({
    factoryId: order.factoryId,
    orderId: order.id,
    type: "ORDER_CREATED",
    message: `Order ${order.orderNumber} created.`
  });

  res.status(201).json(order);
}));

ordersRouter.post("/:id/movements", asyncRoute(async (req, res) => {
  const input = moveMaterialSchema.parse(req.body);

  const order = await prisma.order.findUnique({
    where: { id: String(req.params.id) },
    include: {
      stages: {
        include: { workflowStage: true },
        orderBy: { workflowStage: { sequence: "asc" } }
      }
    }
  });
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  if (input.fromStageCode === input.toStageCode) {
    res.status(400).json({ error: "Source and target stage cannot be the same." });
    return;
  }

  const sourceStage = order.stages.find((stage) => stage.stageCode === input.fromStageCode);
  const targetStage = order.stages.find((stage) => stage.stageCode === input.toStageCode);
  const sourceIndex = order.stages.findIndex((stage) => stage.stageCode === input.fromStageCode);
  const targetIndex = order.stages.findIndex((stage) => stage.stageCode === input.toStageCode);

  if (!sourceStage) {
    res.status(400).json({ error: "Source stage does not exist on this order." });
    return;
  }

  if (!targetStage) {
    res.status(400).json({ error: "Target stage does not exist on this order." });
    return;
  }

  if (input.movementType === "FORWARD" && targetIndex !== sourceIndex + 1) {
    res.status(400).json({ error: "Forward movement is only allowed to the next workflow stage." });
    return;
  }

  if (input.movementType === "ROLLBACK" && targetIndex !== sourceIndex - 1) {
    res.status(400).json({ error: "Rollback movement is only allowed to the previous workflow stage." });
    return;
  }

  if (input.movementType === "DISPATCH" && (targetIndex !== sourceIndex + 1 || !targetStage.workflowStage.isDispatchStage)) {
    res.status(400).json({ error: "Dispatch movement is only allowed from Packing to Dispatch." });
    return;
  }

  const movedOut = await prisma.materialMovement.aggregate({
    where: {
      orderId: order.id,
      fromStageCode: input.fromStageCode,
      movementType: { in: ["FORWARD", "ROLLBACK", "REWORK", "SCRAP", "DISPATCH"] }
    },
    _sum: { quantity: true }
  });
  const availableQuantity = Math.max(0, sourceStage.completedQuantity - (movedOut._sum.quantity ?? 0));

  if (input.quantity > availableQuantity) {
    res.status(400).json({
      error: `Only ${availableQuantity} unit(s) are available to move from ${sourceStage.stageName}. ${sourceStage.completedQuantity} are completed there and ${movedOut._sum.quantity ?? 0} have already been moved out.`
    });
    return;
  }

  const movement = await prisma.$transaction(async (tx: TransactionClient) => {
    const createdMovement = await tx.materialMovement.create({
      data: {
        orderId: order.id,
        fromStageCode: input.fromStageCode,
        toStageCode: input.toStageCode,
        quantity: input.quantity,
        movementType: input.movementType,
        notes: input.notes
      }
    });

    await tx.orderStage.update({
      where: { id: targetStage.id },
      data: {
        startedAt: targetStage.startedAt ?? new Date(),
        completedQuantity: {
          increment: input.movementType === "SCRAP" ? 0 : input.quantity
        }
      }
    });

    await tx.order.update({
      where: { id: order.id },
      data: {
        currentStageCode: input.toStageCode,
        status: input.movementType === "DISPATCH" ? "DISPATCHED" : order.status
      }
    });

    await tx.event.create({
      data: {
        factoryId: order.factoryId,
        orderId: order.id,
        type: input.movementType === "DISPATCH" ? "DISPATCH_COMPLETED" : "MATERIAL_MOVED",
        message: `${input.quantity} units moved from ${sourceStage.stageName} to ${targetStage.stageName}.`,
        metadata: JSON.parse(JSON.stringify({ ...input, availableBeforeMove: availableQuantity }))
      }
    });

    return createdMovement;
  });

  res.status(201).json(movement);
}));

ordersRouter.post("/:id/rework", asyncRoute(async (req, res) => {
  const input = createReworkSchema.parse(req.body);

  const order = await prisma.order.findUnique({ where: { id: String(req.params.id) } });
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const ticket = await prisma.$transaction(async (tx: TransactionClient) => {
    const reworkTicket = await tx.reworkTicket.create({
      data: {
        orderId: order.id,
        sourceStageCode: input.sourceStageCode,
        quantity: input.quantity,
        reason: input.reason
      }
    });

    await tx.materialMovement.create({
      data: {
        orderId: order.id,
        fromStageCode: input.sourceStageCode,
        toStageCode: "REWORK",
        quantity: input.quantity,
        movementType: "REWORK",
        notes: input.reason
      }
    });

    await tx.event.create({
      data: {
        factoryId: order.factoryId,
        orderId: order.id,
        type: "REWORK_CREATED",
        message: `${input.quantity} units sent to rework from ${input.sourceStageCode}.`,
        metadata: JSON.parse(JSON.stringify(input))
      }
    });

    return reworkTicket;
  });

  res.status(201).json(ticket);
}));

ordersRouter.get(
  "/:id/sampling-approvals",
  requirePermission("VIEW_SAMPLING"),
  asyncRoute(async (req, res) => {
    const orderId = String(req.params.id);
    const order = await prisma.order.findUnique({
      where: {
        id: orderId
      }
    });

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const approvals = await ensureSamplingApprovals(orderId);
    const firstApproved = approvals
      .map((approval) => approval.approvedAt)
      .filter((date): date is Date => Boolean(date))
      .sort((left, right) => left.getTime() - right.getTime())[0];
    const samplingStartedAt = order.createdAt;
    const samplingCompletedAt = approvals.every((approval) => approval.status === "APPROVED")
      ? firstApproved ?? new Date()
      : null;

    res.json({
      approvals,
      progress: {
        approved: approvals.filter((approval) => approval.status === "APPROVED").length,
        total: approvals.length,
        samplingStartedAt,
        samplingCompletedAt,
        daysInSampling: Math.max(
          0,
          Math.ceil(((samplingCompletedAt ?? new Date()).getTime() - samplingStartedAt.getTime()) / (1000 * 60 * 60 * 24))
        )
      }
    });
  })
);

ordersRouter.patch(
  "/:id/sampling-details",
  requirePermission("MANAGE_SAMPLING"),
  asyncRoute(async (req, res) => {
    const input = samplingDetailsSchema.parse(req.body);
    const orderId = String(req.params.id);
    const order = await prisma.order.findUnique({
      where: {
        id: orderId
      }
    });

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const isSamplingOrder = order.currentStageCode ? samplingStageCodes.has(order.currentStageCode) : false;

    if (!isSamplingOrder) {
      res.status(400).json({ error: "Style details can be edited here only while the style is in sampling." });
      return;
    }

    if (input.orderNumber !== order.orderNumber) {
      const duplicate = await prisma.order.findFirst({
        where: {
          factoryId: order.factoryId,
          orderNumber: input.orderNumber,
          NOT: {
            id: order.id
          }
        }
      });

      if (duplicate) {
        res.status(409).json({ error: `Style/order number already exists: ${input.orderNumber}` });
        return;
      }

      const duplicateTechPackStyle = await prisma.techPackStyle.findFirst({
        where: {
          factoryId: order.factoryId,
          styleNumber: input.orderNumber,
          NOT: {
            styleNumber: order.orderNumber
          }
        }
      });

      if (duplicateTechPackStyle) {
        res.status(409).json({ error: `Tech pack style already exists: ${input.orderNumber}` });
        return;
      }
    }

    const updated = await prisma.$transaction(async (tx: TransactionClient) => {
      const nextOrder = await tx.order.update({
        where: {
          id: order.id
        },
        data: {
          orderNumber: input.orderNumber,
          buyerName: input.buyerName,
          productCategory: input.productCategory
        }
      });

      await tx.orderLine.updateMany({
        where: {
          orderId: order.id
        },
        data: {
          buyerName: input.buyerName,
          styleName: input.orderNumber,
          description: input.productCategory
        }
      });

      await tx.techPackStyle.updateMany({
        where: {
          factoryId: order.factoryId,
          styleNumber: order.orderNumber
        },
        data: {
          styleNumber: input.orderNumber,
          brandDivision: input.buyerName,
          descriptionOne: input.productCategory
        }
      });

      await tx.event.create({
        data: {
          factoryId: order.factoryId,
          orderId: order.id,
          type: "ORDER_UPDATED",
          message: `${order.orderNumber} sampling details updated.`,
          metadata: JSON.parse(JSON.stringify({
            previousOrderNumber: order.orderNumber,
            ...input
          })),
          createdBy: req.authUser?.id
        }
      });

      return nextOrder;
    });

    await recordWorkLog({ factoryId: order.factoryId, userId: req.authUser?.id, module: "SAMPLING", action: "Sampling details updated", itemType: "order", itemId: order.id, itemLabel: input.orderNumber, metadata: { previousOrderNumber: order.orderNumber, buyerName: input.buyerName, productCategory: input.productCategory } });

    res.json(updated);
  })
);

ordersRouter.patch(
  "/:id/sampling-quantity",
  requirePermission("MANAGE_SAMPLING"),
  asyncRoute(async (req, res) => {
    const input = samplingQuantitySchema.parse(req.body);
    const orderId = String(req.params.id);
    const order = await prisma.order.findUnique({
      where: {
        id: orderId
      },
      include: {
        stages: true
      }
    });

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const isSamplingOrder = order.currentStageCode ? samplingStageCodes.has(order.currentStageCode) : false;

    if (!isSamplingOrder) {
      res.status(400).json({ error: "Quantity can be edited here only while the style is in sampling." });
      return;
    }

    const maxCompletedQuantity = Math.max(0, ...order.stages.map((stage) => stage.completedQuantity));

    if (input.orderQuantity < maxCompletedQuantity) {
      res.status(400).json({
        error: `Quantity cannot be lower than already recorded progress ${maxCompletedQuantity}.`
      });
      return;
    }

    const updated = await prisma.$transaction(async (tx: TransactionClient) => {
      const nextOrder = await tx.order.update({
        where: {
          id: order.id
        },
        data: {
          orderQuantity: input.orderQuantity
        }
      });

      await tx.orderStage.updateMany({
        where: {
          orderId: order.id
        },
        data: {
          plannedQuantity: input.orderQuantity
        }
      });

      await tx.orderLine.updateMany({
        where: {
          orderId: order.id
        },
        data: {
          orderQuantity: input.orderQuantity
        }
      });

      await tx.event.create({
        data: {
          factoryId: order.factoryId,
          orderId: order.id,
          type: "ORDER_UPDATED",
          message: `${order.orderNumber} sampling quantity updated to ${input.orderQuantity}.`,
          metadata: JSON.parse(JSON.stringify({
            previousQuantity: order.orderQuantity,
            orderQuantity: input.orderQuantity
          })),
          createdBy: req.authUser?.id
        }
      });

      return nextOrder;
    });

    await recordWorkLog({ factoryId: order.factoryId, userId: req.authUser?.id, module: "SAMPLING", action: "Sampling quantity updated", itemType: "order", itemId: order.id, itemLabel: order.orderNumber, metadata: { previousQuantity: order.orderQuantity, orderQuantity: input.orderQuantity } });

    res.json(updated);
  })
);

ordersRouter.patch(
  "/:id/sampling-approvals/:checkpointCode",
  requirePermission("MANAGE_SAMPLING"),
  asyncRoute(async (req, res) => {
    const input = samplingApprovalSchema.parse(req.body);
    const orderId = String(req.params.id);
    const checkpointCode = String(req.params.checkpointCode);
    const order = await prisma.order.findUnique({
      where: {
        id: orderId
      }
    });

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    await ensureSamplingApprovals(orderId);

    const updated = await prisma.samplingApproval.update({
      where: {
        orderId_checkpointCode: {
          orderId,
          checkpointCode
        }
      },
      data: {
        status: input.status,
        comments: input.comments,
        submittedAt: input.status === "SUBMITTED" ? new Date() : undefined,
        approvedAt: input.status === "APPROVED" ? new Date() : null,
        updatedBy: req.authUser?.id
      }
    });

    await createEvent({
      factoryId: order.factoryId,
      orderId: order.id,
      type: "ORDER_UPDATED",
      message: `${updated.label} marked ${updated.status} for ${order.orderNumber}.`,
      metadata: JSON.parse(JSON.stringify({
        checkpointCode,
        status: updated.status,
        comments: input.comments
      }))
    });

    await recordWorkLog({
      factoryId: order.factoryId,
      userId: req.authUser?.id,
      module: "SAMPLING",
      action: "Sampling approval updated",
      itemType: "order",
      itemId: order.id,
      itemLabel: order.orderNumber,
      notes: `${updated.label}: ${updated.status}`,
      metadata: { checkpointCode, status: updated.status, comments: input.comments }
    });

    res.json(updated);
  })
);

ordersRouter.patch("/:id/sampling-decision", requirePermission("MANAGE_SAMPLING"), asyncRoute(async (req, res) => {
  const input = samplingDecisionSchema.parse(req.body);
  const orderId = String(req.params.id);

  const order = await prisma.order.findUnique({
    where: {
      id: orderId
    }
  });

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const isSamplingOrder = order.currentStageCode ? samplingStageCodes.has(order.currentStageCode) : false;

  if (input.action !== "REVIVE" && !isSamplingOrder) {
    res.status(400).json({ error: "Only sampling-stage orders can be changed from the sampling workspace" });
    return;
  }

  const nextStage = input.action === "APPROVE_FOR_PRODUCTION"
    ? await getFirstProductionStage(order.workflowTemplateId)
    : null;

  if (input.action === "APPROVE_FOR_PRODUCTION") {
    const approvals = await ensureSamplingApprovals(order.id);
    const pending = approvals.filter((approval) => approval.status !== "APPROVED");

    if (pending.length > 0) {
      res.status(400).json({
        error: "Sampling cannot move to production until all approvals are approved",
        pendingApprovals: pending.map((approval) => approval.label)
      });
      return;
    }
  }

  if (input.action === "APPROVE_FOR_PRODUCTION" && !nextStage) {
    res.status(400).json({ error: "No production stage found for this order workflow" });
    return;
  }

  const updated = await prisma.$transaction(async (tx: TransactionClient) => {
    const nextStageCode = input.action === "APPROVE_FOR_PRODUCTION" ? nextStage?.code : order.currentStageCode;
    const data = input.action === "REMOVE"
      ? { status: "CANCELLED" as const }
      : input.action === "REVIVE"
        ? { status: "RUNNING" as const }
        : {
          status: "RUNNING" as const,
          currentStageCode: nextStageCode
        };

    const updatedOrder = await tx.order.update({
      where: {
        id: order.id
      },
      data
    });

    await tx.event.create({
      data: {
        factoryId: order.factoryId,
        orderId: order.id,
        type: "ORDER_UPDATED",
        message: input.action === "REMOVE"
          ? `${input.target} ${order.orderNumber} removed from sampling.`
          : input.action === "REVIVE"
            ? `${input.target} ${order.orderNumber} revived into sampling.`
            : `${order.orderNumber} approved for production.`,
        metadata: JSON.parse(JSON.stringify({
          action: input.action,
          target: input.target,
          reason: input.reason,
          previousStage: order.currentStageCode,
          nextStage: nextStageCode
        }))
      }
    });

    return updatedOrder;
  });

  await recordWorkLog({
    factoryId: order.factoryId,
    userId: req.authUser?.id,
    module: "SAMPLING",
    action: "Sampling decision recorded",
    itemType: "order",
    itemId: order.id,
    itemLabel: order.orderNumber,
    notes: input.action,
    metadata: { action: input.action, target: input.target, reason: input.reason }
  });

  res.json(updated);
}));
