import { prisma } from "../db.js";

export class InventoryService {

  async increase(
    orderId: string,
    workflowStageId: string,
    qty: number
  ) {

    const existing =
      await prisma.stageInventory.findFirst({
        where: {
          orderId,
          workflowStageId
        }
      });

    if (!existing) {

      return prisma.stageInventory.create({
        data: {
          orderId,
          workflowStageId,
          quantity: qty
        }
      });

    }

    return prisma.stageInventory.update({
      where: {
        id: existing.id
      },
      data: {
        quantity: existing.quantity + qty
      }
    });

  }

  async decrease(
    orderId: string,
    workflowStageId: string,
    qty: number
  ) {

    const inventory =
      await prisma.stageInventory.findFirst({
        where: {
          orderId,
          workflowStageId
        }
      });

    if (!inventory)
      throw new Error("Inventory not found");

    if (inventory.quantity < qty)
      throw new Error("Insufficient inventory");

    return prisma.stageInventory.update({
      where: {
        id: inventory.id
      },
      data: {
        quantity: inventory.quantity - qty
      }
    });

  }

}