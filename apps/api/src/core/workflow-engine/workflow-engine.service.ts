import { prisma } from "../../db.js";
import { InventoryService } from "../inventory/inventory.service.js";
import { InvalidTransitionError } from "./workflow-engine.errors.js";
import { MoveForwardInput, RollbackInput } from "./workflow-engine.types.js";

type WorkflowTransitionType = "FORWARD" | "ROLLBACK" | "REWORK" | "REJECT";

export class WorkflowEngineService {
  constructor(
    private readonly db = prisma,
    private readonly inventory = new InventoryService(db)
  ) {}

  async validateTransition(
    workflowTemplateId: string,
    fromStageId: string,
    toStageId: string,
    transitionType?: WorkflowTransitionType
  ) {
    const transition = await this.db.workflowTransition.findFirst({
      where: {
        workflowTemplateId,
        fromStageId,
        toStageId,
        ...(transitionType ? { transitionType } : {})
      }
    });

    return !!transition;
  }

  async moveForward(input: MoveForwardInput) {
    const order = await this.db.order.findUniqueOrThrow({
      where: {
        id: input.orderId
      }
    });

    const toStage = await this.db.workflowStage.findUniqueOrThrow({
      where: {
        id: input.toStageId
      }
    });

    const allowed = await this.validateTransition(
      order.workflowTemplateId,
      input.fromStageId,
      input.toStageId,
      "FORWARD"
    );

    if (!allowed) {
      throw new InvalidTransitionError();
    }

    const result = await this.inventory.transferInventory({
      orderId: input.orderId,
      fromStageId: input.fromStageId,
      toStageId: input.toStageId,
      quantity: input.quantity,
      movementType: "FORWARD",
      notes: input.notes,
      createdBy: input.createdBy,
      source: "workflow-engine",
      eventMessage: `${input.quantity} units moved forward to ${toStage.code}`
    });

    await this.db.order.update({
      where: {
        id: order.id
      },
      data: {
        currentStageCode: toStage.code,
        status: toStage.isDispatchStage ? "DISPATCHED" : order.status
      }
    });

    return result;
  }

  async rollback(input: RollbackInput) {
    const order = await this.db.order.findUniqueOrThrow({
      where: {
        id: input.orderId
      }
    });

    const [fromStage, toStage] = await Promise.all([
      this.db.workflowStage.findUniqueOrThrow({
        where: {
          id: input.fromStageId
        }
      }),
      this.db.workflowStage.findUniqueOrThrow({
        where: {
          id: input.toStageId
        }
      })
    ]);

    const allowed = await this.validateTransition(
      order.workflowTemplateId,
      input.fromStageId,
      input.toStageId,
      "ROLLBACK"
    );

    if (!allowed || !fromStage.allowsRollback) {
      throw new InvalidTransitionError();
    }

    const result = await this.inventory.transferInventory({
      orderId: input.orderId,
      fromStageId: input.fromStageId,
      toStageId: input.toStageId,
      quantity: input.quantity,
      movementType: "ROLLBACK",
      notes: input.notes,
      createdBy: input.createdBy,
      source: "workflow-engine",
      eventMessage: `${input.quantity} units rolled back from ${fromStage.code} to ${toStage.code}`
    });

    await this.db.order.update({
      where: {
        id: order.id
      },
      data: {
        currentStageCode: toStage.code
      }
    });

    return result;
  }
}
