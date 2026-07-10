import { prisma } from "../db.js";

export class MaterialMovementService {

  async createMovement(data: {

    orderId: string;

    fromStageCode?: string;

    toStageCode?: string;

    quantity: number;

    movementType:
      | "FORWARD"
      | "ROLLBACK"
      | "REWORK"
      | "SCRAP"
      | "DISPATCH";

    notes?: string;

  }) {

    return prisma.materialMovement.create({
      data
    });

  }

}