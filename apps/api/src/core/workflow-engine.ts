import { prisma } from "../db.js";

import { InventoryService }
from "./inventory-service.js";

import { EventService }
from "./event-service.js";

import { MaterialMovementService }
from "./material-movement.js";

export class WorkflowEngine {

  inventory = new InventoryService();

  events = new EventService();

  movements = new MaterialMovementService();

  async moveForward(
    orderId: string,
    fromStageId: string,
    toStageId: string,
    qty: number
  ) {

    const order =
      await prisma.order.findUniqueOrThrow({
        where: { id: orderId }
      });

    await this.inventory.decrease(
      orderId,
      fromStageId,
      qty
    );

    await this.inventory.increase(
      orderId,
      toStageId,
      qty
    );

    await this.movements.createMovement({
      orderId,
      quantity: qty,
      movementType: "FORWARD"
    });

    await this.events.createEvent(
      order.factoryId,
      orderId,
      "MATERIAL_MOVED",
      `${qty} moved forward`,
      {
        fromStageId,
        toStageId
      }
    );

  }

}