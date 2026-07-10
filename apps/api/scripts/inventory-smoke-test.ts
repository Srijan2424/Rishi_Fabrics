import { prisma } from "../src/db.js";
import { InventoryService } from "../src/core/inventory/inventory.service.js";

const inventory = new InventoryService();

async function main() {
  const order = await prisma.order.findFirst({
    include: {
      workflowTemplate: {
        include: {
          stages: {
            orderBy: {
              sequence: "asc"
            }
          }
        }
      }
    }
  });

  if (!order) {
    throw new Error("No order found. Run npm run db:seed first.");
  }

  const [fromStage, toStage] = order.workflowTemplate.stages;

  if (!fromStage || !toStage) {
    throw new Error("Order workflow needs at least two stages for inventory transfer test.");
  }

  console.log("Testing inventory engine with:");
  console.log(`Order: ${order.orderNumber}`);
  console.log(`From: ${fromStage.code}`);
  console.log(`To: ${toStage.code}`);

  await inventory.addInventory({
    orderId: order.id,
    workflowStageId: fromStage.id,
    quantity: 100
  });

  const before = await inventory.getOrderInventory(order.id);

  await inventory.transferInventory({
    orderId: order.id,
    fromStageId: fromStage.id,
    toStageId: toStage.id,
    quantity: 25,
    movementType: "FORWARD",
    notes: "Inventory smoke test",
    createdBy: "inventory-smoke-test",
    source: "test-script"
  });

  const after = await inventory.getOrderInventory(order.id);

  const movement = await prisma.materialMovement.findFirst({
    where: {
      orderId: order.id,
      notes: "Inventory smoke test"
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  const event = await prisma.event.findFirst({
    where: {
      orderId: order.id,
      source: "test-script"
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  if (!movement) {
    throw new Error("Inventory transfer did not create MaterialMovement.");
  }

  if (!event) {
    throw new Error("Inventory transfer did not create timeline Event.");
  }

  console.log("Before inventory:");
  console.table(before.map((row) => ({
    stage: row.workflowStage.code,
    quantity: row.quantity
  })));

  console.log("After inventory:");
  console.table(after.map((row) => ({
    stage: row.workflowStage.code,
    quantity: row.quantity
  })));

  console.log("Inventory smoke test passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

