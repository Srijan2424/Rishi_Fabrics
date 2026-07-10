import { prisma } from "../src/db.js";
import { InventoryService } from "../src/core/inventory/inventory.service.js";
import { WorkflowEngineService } from "../src/core/workflow-engine/workflow-engine.service.js";
import { InvalidTransitionError } from "../src/core/workflow-engine/workflow-engine.errors.js";

const inventory = new InventoryService();
const workflowEngine = new WorkflowEngineService();

async function expectInvalidTransition(name: string, action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      console.log(`PASS: ${name}`);
      return;
    }

    throw new Error(`${name} failed with wrong error: ${error instanceof Error ? error.name : String(error)}`);
  }

  throw new Error(`${name} did not throw InvalidTransitionError`);
}

async function ensureTransition(input: {
  workflowTemplateId: string;
  fromStageId: string;
  toStageId: string;
  transitionType: "FORWARD" | "ROLLBACK";
}) {
  const existing = await prisma.workflowTransition.findFirst({
    where: input
  });

  if (!existing) {
    await prisma.workflowTransition.create({
      data: input
    });
  }
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

  const [stageA, stageB, stageC] = order.workflowTemplate.stages;

  if (!stageA || !stageB || !stageC) {
    throw new Error("Workflow needs at least three stages for workflow-engine test.");
  }

  await ensureTransition({
    workflowTemplateId: order.workflowTemplateId,
    fromStageId: stageA.id,
    toStageId: stageB.id,
    transitionType: "FORWARD"
  });

  await ensureTransition({
    workflowTemplateId: order.workflowTemplateId,
    fromStageId: stageB.id,
    toStageId: stageA.id,
    transitionType: "ROLLBACK"
  });

  await inventory.addInventory({
    orderId: order.id,
    workflowStageId: stageA.id,
    quantity: 50
  });

  console.log("Testing workflow engine with:");
  console.log(`Order: ${order.orderNumber}`);
  console.log(`Forward: ${stageA.code} -> ${stageB.code}`);
  console.log(`Invalid: ${stageA.code} -> ${stageC.code}`);
  console.log(`Rollback: ${stageB.code} -> ${stageA.code}`);

  await workflowEngine.moveForward({
    orderId: order.id,
    fromStageId: stageA.id,
    toStageId: stageB.id,
    quantity: 20,
    notes: "Workflow engine forward smoke test",
    createdBy: "workflow-engine-smoke-test"
  });

  const afterForward = await inventory.getOrderInventory(order.id);
  const stageBAfterForward = afterForward.find((row) => row.workflowStageId === stageB.id);
  const orderAfterForward = await prisma.order.findUniqueOrThrow({
    where: {
      id: order.id
    }
  });

  if (!stageBAfterForward || stageBAfterForward.quantity < 20) {
    throw new Error("Forward transition did not move inventory to destination stage.");
  }

  if (orderAfterForward.currentStageCode !== stageB.code) {
    throw new Error("Forward transition did not update order current stage.");
  }

  await expectInvalidTransition(
    "Reject invalid transition",
    () => workflowEngine.moveForward({
      orderId: order.id,
      fromStageId: stageA.id,
      toStageId: stageC.id,
      quantity: 1,
      notes: "This should fail"
    })
  );

  await workflowEngine.rollback({
    orderId: order.id,
    fromStageId: stageB.id,
    toStageId: stageA.id,
    quantity: 5,
    notes: "Workflow engine rollback smoke test",
    createdBy: "workflow-engine-smoke-test"
  });

  const movement = await prisma.materialMovement.findFirst({
    where: {
      orderId: order.id,
      notes: "Workflow engine forward smoke test"
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  const event = await prisma.event.findFirst({
    where: {
      orderId: order.id,
      source: "workflow-engine"
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  if (!movement) {
    throw new Error("Workflow Engine did not create MaterialMovement through Inventory Engine.");
  }

  if (!event) {
    throw new Error("Workflow Engine did not create Event through Inventory Engine.");
  }

  const finalInventory = await inventory.getOrderInventory(order.id);

  console.log("Final inventory:");
  console.table(finalInventory.map((row) => ({
    stage: row.workflowStage.code,
    quantity: row.quantity
  })));

  console.log("Workflow engine smoke test passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
