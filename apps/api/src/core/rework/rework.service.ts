import { prisma } from "../../db.js";
import { InventoryService } from "../inventory/inventory.service.js";
import { TimelineService } from "../timeline/timeline.service.js";
import { InvalidReworkQuantityError, ReworkStageNotFoundError } from "./rework.errors.js";
import { CreateReworkInput } from "./rework.types.js";

export class ReworkEngineService {
  constructor(
    private readonly db = prisma,
    private readonly inventory = new InventoryService(db),
    private readonly timeline = new TimelineService(db)
  ) {}

  private assertPositiveQuantity(quantity: number) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new InvalidReworkQuantityError();
    }
  }

  async createRework(input: CreateReworkInput) {
    this.assertPositiveQuantity(input.quantity);

    const order = await this.db.order.findUniqueOrThrow({
      where: {
        id: input.orderId
      }
    });

    const sourceStage = await this.db.workflowStage.findUniqueOrThrow({
      where: {
        id: input.sourceStageId
      }
    });

    const reworkStage = await this.db.workflowStage.findFirst({
      where: {
        workflowTemplateId: order.workflowTemplateId,
        category: "REWORK"
      },
      orderBy: {
        sequence: "asc"
      }
    });

    if (!reworkStage) {
      throw new ReworkStageNotFoundError();
    }

    const transfer = await this.inventory.transferInventory({
      orderId: input.orderId,
      fromStageId: input.sourceStageId,
      toStageId: reworkStage.id,
      quantity: input.quantity,
      movementType: "REWORK",
      notes: input.reason,
      createdBy: input.createdBy,
      source: "rework-engine",
      eventMessage: `${input.quantity} units moved to rework from ${sourceStage.code}`
    });

    const ticket = await this.db.reworkTicket.create({
      data: {
        orderId: input.orderId,
        sourceStageCode: sourceStage.code,
        quantity: input.quantity,
        reason: input.reason,
        department: input.department,
        severity: input.severity,
        rootCause: input.rootCause,
        correctiveAction: input.correctiveAction
      }
    });

    const event = await this.timeline.createEvent({
      factoryId: order.factoryId,
      orderId: order.id,
      type: "REWORK_CREATED",
      message: `${input.quantity} units sent to rework from ${sourceStage.code}.`,
      metadata: {
        reworkTicketId: ticket.id,
        sourceStageId: input.sourceStageId,
        sourceStageCode: sourceStage.code,
        reworkStageId: reworkStage.id,
        quantity: input.quantity,
        reason: input.reason,
        department: input.department,
        severity: input.severity,
        rootCause: input.rootCause,
        correctiveAction: input.correctiveAction
      },
      createdBy: input.createdBy,
      source: "rework-engine"
    });

    return {
      success: true,
      ticket,
      transfer,
      event
    };
  }
}
