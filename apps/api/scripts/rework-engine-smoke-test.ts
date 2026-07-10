import { prisma } from "../src/db.js";
import { InventoryService } from "../src/core/inventory/inventory.service.js";
import { InsufficientInventoryError } from "../src/core/inventory/inventory.errors.js";
import { ReworkEngineService } from "../src/core/rework/rework.service.js";
import { InvalidReworkQuantityError } from "../src/core/rework/rework.errors.js";

const inventory = new InventoryService();
const reworkEngine = new ReworkEngineService();

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

async function ensureReworkStage(workflowTemplateId: string) {
  const existing = await prisma.workflowStage.findFirst({
    where: {
      workflowTemplateId,
      category: "REWORK"
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.workflowStage.create({
    data: {
      workflowTemplateId,
      name: "Rework",
      code: "REWORK",
      kind: "HYBRID",
      category: "REWORK",
      sequence: 999,
      allowsPartial: true,
      allowsRollback: true
    }
  });
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

  const sourceStage = order.workflowTemplate.stages.find((stage) => stage.category !== "REWORK");

  if (!sourceStage) {
    throw new Error("No source stage found for rework test.");
  }

  const reworkStage = await ensureReworkStage(order.workflowTemplateId);

  await inventory.addInventory({
    orderId: order.id,
    workflowStageId: sourceStage.id,
    quantity: 40
  });

  console.log("Testing rework engine with:");
  console.log(`Order: ${order.orderNumber}`);
  console.log(`Source: ${sourceStage.code}`);
  console.log(`Rework: ${reworkStage.code}`);

  await expectError(
    "Reject zero rework quantity",
    () => reworkEngine.createRework({
      orderId: order.id,
      sourceStageId: sourceStage.id,
      quantity: 0,
      reason: "Should fail"
    }),
    InvalidReworkQuantityError
  );

  await expectError(
    "Reject rework greater than available inventory",
    () => reworkEngine.createRework({
      orderId: order.id,
      sourceStageId: sourceStage.id,
      quantity: 999999,
      reason: "Should fail"
    }),
    InsufficientInventoryError
  );

  const result = await reworkEngine.createRework({
    orderId: order.id,
    sourceStageId: sourceStage.id,
    quantity: 15,
    reason: "Inspection rejection",
    department: "Quality",
    severity: "MEDIUM",
    rootCause: "Measurement variation",
    correctiveAction: "Re-check pattern and rework panels",
    createdBy: "rework-engine-smoke-test"
  });

  const finalInventory = await inventory.getOrderInventory(order.id);
  const sourceInventory = finalInventory.find((row) => row.workflowStageId === sourceStage.id);
  const reworkInventory = finalInventory.find((row) => row.workflowStageId === reworkStage.id);

  if (!sourceInventory || sourceInventory.quantity < 25) {
    throw new Error("Source inventory was not preserved correctly after rework transfer.");
  }

  if (!reworkInventory || reworkInventory.quantity < 15) {
    throw new Error("Rework inventory was not increased.");
  }

  const ticket = await prisma.reworkTicket.findUnique({
    where: {
      id: result.ticket.id
    }
  });

  const event = await prisma.event.findFirst({
    where: {
      orderId: order.id,
      source: "rework-engine",
      type: "REWORK_CREATED"
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  if (!ticket) {
    throw new Error("Rework ticket was not created.");
  }

  if (!event) {
    throw new Error("Rework timeline event was not created.");
  }

  console.log("Final inventory:");
  console.table(finalInventory.map((row) => ({
    stage: row.workflowStage.code,
    quantity: row.quantity
  })));

  console.log("Rework ticket:");
  console.table([{
    id: ticket.id,
    sourceStageCode: ticket.sourceStageCode,
    quantity: ticket.quantity,
    department: ticket.department,
    severity: ticket.severity
  }]);

  console.log("Rework engine smoke test passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

