import { prisma } from "../src/db.js";
import { InventoryService } from "../src/core/inventory/inventory.service.js";
import { InsufficientInventoryError, InventoryNotFoundError, InvalidInventoryQuantityError } from "../src/core/inventory/inventory.errors.js";

const inventory = new InventoryService();

async function expectError(name: string, action: () => Promise<unknown>, ErrorClass: new () => Error) {
  try {
    await action();
  } catch (error) {
    if (error instanceof ErrorClass) {
      console.log(`PASS: ${name}`);
      return;
    }

    throw new Error(`${name} failed with wrong error: ${error instanceof Error ? error.name : String(error)}`);
  }

  throw new Error(`${name} did not throw an error`);
}

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
    throw new Error("Order workflow needs at least two stages.");
  }

  await inventory.addInventory({
    orderId: order.id,
    workflowStageId: fromStage.id,
    quantity: 10
  });

  await expectError(
    "Reject zero quantity",
    () => inventory.transferInventory({
      orderId: order.id,
      fromStageId: fromStage.id,
      toStageId: toStage.id,
      quantity: 0
    }),
    InvalidInventoryQuantityError
  );

  await expectError(
    "Reject negative quantity",
    () => inventory.transferInventory({
      orderId: order.id,
      fromStageId: fromStage.id,
      toStageId: toStage.id,
      quantity: -5
    }),
    InvalidInventoryQuantityError
  );

  await expectError(
    "Reject more than available quantity",
    () => inventory.transferInventory({
      orderId: order.id,
      fromStageId: fromStage.id,
      toStageId: toStage.id,
      quantity: 999999
    }),
    InsufficientInventoryError
  );

  await expectError(
    "Reject missing source inventory",
    () => inventory.transferInventory({
      orderId: order.id,
      fromStageId: "missing-stage-id",
      toStageId: toStage.id,
      quantity: 1
    }),
    InventoryNotFoundError
  );

  console.log("Inventory negative tests passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

