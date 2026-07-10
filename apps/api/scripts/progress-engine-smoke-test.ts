import { prisma } from "../src/db.js";
import { InventoryService } from "../src/core/inventory/inventory.service.js";
import { ProgressService } from "../src/core/progress/progress.service.js";

const inventory = new InventoryService();
const progress = new ProgressService();

async function main() {
  const factory = await prisma.factory.findFirst();
  const workflow = await prisma.workflowTemplate.findFirst({
    include: {
      stages: {
        orderBy: {
          sequence: "asc"
        }
      }
    }
  });

  if (!factory || !workflow) {
    throw new Error("Factory/workflow missing. Run npm run db:seed first.");
  }

  const [stageA, stageB, stageC] = workflow.stages;

  if (!stageA || !stageB || !stageC) {
    throw new Error("Workflow needs at least three stages for progress-engine test.");
  }

  const orderNumber = `PROGRESS-${Date.now()}`;
  const orderQuantity = 100;

  const order = await prisma.order.create({
    data: {
      factoryId: factory.id,
      workflowTemplateId: workflow.id,
      orderNumber,
      buyerName: "Progress Test Buyer",
      productCategory: "T-Shirts",
      orderQuantity,
      deliveryDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      currentStageCode: stageC.code,
      stages: {
        create: workflow.stages.map((stage) => ({
          workflowStageId: stage.id,
          stageCode: stage.code,
          stageName: stage.name,
          plannedQuantity: orderQuantity
        }))
      }
    }
  });

  await inventory.addInventory({
    orderId: order.id,
    workflowStageId: stageA.id,
    quantity: orderQuantity
  });

  await inventory.transferInventory({
    orderId: order.id,
    fromStageId: stageA.id,
    toStageId: stageB.id,
    quantity: 40,
    movementType: "FORWARD",
    notes: "Progress engine test stage A to B",
    source: "progress-engine-smoke-test"
  });

  await inventory.transferInventory({
    orderId: order.id,
    fromStageId: stageB.id,
    toStageId: stageC.id,
    quantity: 10,
    movementType: "FORWARD",
    notes: "Progress engine test stage B to C",
    source: "progress-engine-smoke-test"
  });

  await prisma.orderStage.updateMany({
    where: {
      orderId: order.id,
      stageCode: stageA.code
    },
    data: {
      completedQuantity: 40
    }
  });

  await prisma.orderStage.updateMany({
    where: {
      orderId: order.id,
      stageCode: stageB.code
    },
    data: {
      inputQuantity: 40,
      completedQuantity: 10
    }
  });

  const report = await progress.getOrderProgress(order.id);

  if (report.overallProgressPercent <= 0 || report.overallProgressPercent >= 100) {
    throw new Error(`Expected partial overall progress, got ${report.overallProgressPercent}`);
  }

  if (!report.materialAccountability.isBalanced) {
    throw new Error(`Expected balanced material, got ${JSON.stringify(report.materialAccountability)}`);
  }

  if (report.materialAccountability.activeInventoryQuantity !== orderQuantity) {
    throw new Error("Progress engine did not account for all active inventory.");
  }

  const activeStages = report.stageProgress.filter((stage) => stage.activeQuantity > 0);

  if (activeStages.length !== 3) {
    throw new Error(`Expected active inventory in three stages, got ${activeStages.length}`);
  }

  const hasPipelineProgress = report.pipelineProgress.some((pipeline) => pipeline.progressPercent > 0);

  if (!hasPipelineProgress) {
    throw new Error("Expected at least one pipeline to show progress.");
  }

  const factoryProgress = await progress.getFactoryProgress(factory.id);
  const foundOrder = factoryProgress.orders.some((row) => row.orderId === order.id);

  if (!foundOrder) {
    throw new Error("Factory progress did not include progress test order.");
  }

  console.log("Progress report:");
  console.table([{
    orderNumber: report.orderNumber,
    progress: report.overallProgressPercent,
    activeInventory: report.materialAccountability.activeInventoryQuantity,
    missing: report.materialAccountability.missingQuantity,
    overage: report.materialAccountability.overageQuantity
  }]);

  console.log("Active stage progress:");
  console.table(activeStages.map((stage) => ({
    stage: stage.stageCode,
    pipeline: stage.pipeline,
    activeQuantity: stage.activeQuantity,
    positionPercent: stage.positionPercent
  })));

  console.log("Progress engine smoke test passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
