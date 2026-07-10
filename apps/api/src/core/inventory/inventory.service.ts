import { prisma } from "../../db.js";

import {
  AddInventoryInput,
  RemoveInventoryInput,
  TransferInventoryInput
} from "./inventory.types.js";

import {
  InventoryNotFoundError,
  InvalidInventoryQuantityError,
  InsufficientInventoryError
} from "./inventory.errors.js";
import { TimelineService } from "../timeline/timeline.service.js";

export class InventoryService {
  constructor(private readonly db = prisma) {}

  private assertPositiveQuantity(quantity: number) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new InvalidInventoryQuantityError();
    }
  }

  async getInventory(
    orderId: string,
    workflowStageId: string
  ) {
    return this.db.stageInventory.findFirst({
      where: {
        orderId,
        workflowStageId
      }
    });
  }

  async getOrderInventory(
    orderId: string
  ) {
    return this.db.stageInventory.findMany({
      where: {
        orderId
      },
      include: {
        workflowStage: true
      },
      orderBy: {
        workflowStage: {
          sequence: "asc"
        }
      }
    });
  }

  async addInventory(
    input: AddInventoryInput
  ) {
    this.assertPositiveQuantity(input.quantity);

    const existing =
      await this.getInventory(
        input.orderId,
        input.workflowStageId
      );

    if (!existing) {
      return this.db.stageInventory.create({
        data: {
          orderId: input.orderId,
          workflowStageId: input.workflowStageId,
          quantity: input.quantity
        }
      });
    }

    return this.db.stageInventory.update({
      where: {
        id: existing.id
      },
      data: {
        quantity: {
          increment: input.quantity
        }
      }
    });
  }

  async removeInventory(
    input: RemoveInventoryInput
  ) {
    this.assertPositiveQuantity(input.quantity);

    const inventory =
      await this.getInventory(
        input.orderId,
        input.workflowStageId
      );

    if (!inventory) {
      throw new InventoryNotFoundError();
    }

    if (
      inventory.quantity <
      input.quantity
    ) {
      throw new InsufficientInventoryError();
    }

    return this.db.stageInventory.update({
      where: {
        id: inventory.id
      },
      data: {
        quantity: {
          decrement: input.quantity
        }
      }
    });
  }

  async transferInventory(
    input: TransferInventoryInput
  ) {
    this.assertPositiveQuantity(input.quantity);

    return this.db.$transaction(async (tx: any) => {
      const order = await tx.order.findUniqueOrThrow({
        where: {
          id: input.orderId
        }
      });

      const sourceInventory = await tx.stageInventory.findFirst({
        where: {
          orderId: input.orderId,
          workflowStageId: input.fromStageId
        }
      });

      if (!sourceInventory) {
        throw new InventoryNotFoundError();
      }

      if (sourceInventory.quantity < input.quantity) {
        throw new InsufficientInventoryError();
      }

      await tx.stageInventory.update({
        where: {
          id: sourceInventory.id
        },
        data: {
          quantity: {
            decrement: input.quantity
          }
        }
      });

      await tx.stageInventory.upsert({
        where: {
          orderId_workflowStageId: {
            orderId: input.orderId,
            workflowStageId: input.toStageId
          }
        },
        update: {
          quantity: {
            increment: input.quantity
          }
        },
        create: {
          orderId: input.orderId,
          workflowStageId: input.toStageId,
          quantity: input.quantity
        }
      });

      const movementType = input.movementType ?? "FORWARD";

      const movement = await tx.materialMovement.create({
        data: {
          orderId: input.orderId,
          fromStageCode: input.fromStageId,
          toStageCode: input.toStageId,
          quantity: input.quantity,
          movementType,
          notes: input.notes
        }
      });

      const event = await new TimelineService(tx).createEvent({
        factoryId: order.factoryId,
        orderId: order.id,
        type: movementType === "DISPATCH" ? "DISPATCH_COMPLETED" : "MATERIAL_MOVED",
        message: input.eventMessage ?? `${input.quantity} units moved from ${input.fromStageId} to ${input.toStageId}`,
        metadata: {
          fromStageId: input.fromStageId,
          toStageId: input.toStageId,
          quantity: input.quantity,
          movementType,
          notes: input.notes
        },
        createdBy: input.createdBy,
        source: input.source ?? "inventory-engine"
      });

      return {
        success: true,
        movement,
        event
      };
    });
  }
}
