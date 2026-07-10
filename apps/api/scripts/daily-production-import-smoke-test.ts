import { PrismaClient } from "@prisma/client";
import { ErpImportService } from "../src/core/erp-import/erp-import.service.js";

const prisma = new PrismaClient();
const erpImport = new ErpImportService(prisma);

const samplingCheckpoints = [
  "LAB_DIP_APPROVAL",
  "FOB_APPROVAL",
  "PO",
  "FABRIC_CUTTING_SWATCH",
  "SIZE_RATIO",
  "TRIMS_CARD",
  "PP_COMMENTS",
  "PP_SEALER_GARMENT",
  "SIZE_SET_APPROVAL"
];

async function approveSamplingForSmokeTest(orderId: string) {
  for (const checkpointCode of samplingCheckpoints) {
    await prisma.samplingApproval.upsert({
      where: {
        orderId_checkpointCode: {
          orderId,
          checkpointCode
        }
      },
      update: {
        status: "APPROVED",
        approvedAt: new Date(),
        updatedBy: "daily-production-smoke-test"
      },
      create: {
        orderId,
        checkpointCode,
        label: checkpointCode.replace(/_/g, " "),
        owner: "Merchant",
        timeframe: "Smoke test",
        evidence: "Smoke test approval",
        status: "APPROVED",
        approvedAt: new Date(),
        updatedBy: "daily-production-smoke-test"
      }
    });
  }
}

async function getOrCreateSmokeOrder(factoryId: string) {
  const workflow = await prisma.workflowTemplate.findFirst({
    where: {
      factoryId,
      isActive: true
    }
  });

  if (!workflow) {
    throw new Error("Active workflow not found. Run npm run db:seed first.");
  }

  const workflowStages = await prisma.workflowStage.findMany({
    where: {
      workflowTemplateId: workflow.id
    },
    orderBy: {
      sequence: "asc"
    }
  });

  if (workflowStages.length === 0) {
    throw new Error("Workflow has no stages. Run npm run db:seed first.");
  }

  const existing = await prisma.order.findFirst({
    where: {
      factoryId,
      orderNumber: "DP-SMOKE-1001"
    },
    include: {
      stages: true
    }
  });

  if (existing) {
    return prisma.order.update({
      where: {
        id: existing.id
      },
      data: {
        status: "RUNNING",
        currentStageCode: "LAB_DIP_APPROVAL"
      },
      include: {
        stages: true
      }
    });
  }

  return prisma.order.create({
    data: {
      factoryId,
      workflowTemplateId: workflow.id,
      orderNumber: "DP-SMOKE-1001",
      buyerName: "Smoke Buyer",
      productCategory: "Production Tee",
      orderQuantity: 200,
      deliveryDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      currentStageCode: "LAB_DIP_APPROVAL",
      stages: {
        create: workflowStages.map((stage) => ({
          workflowStageId: stage.id,
          stageCode: stage.code,
          stageName: stage.name,
          plannedQuantity: 200
        }))
      }
    },
    include: {
      stages: true
    }
  });
}

async function main() {
  const factory = await prisma.factory.findFirst({
    where: {
      code: "DEMO"
    }
  });

  if (!factory) {
    throw new Error("Seed factory DEMO not found. Run npm run db:seed first.");
  }

  const order = await getOrCreateSmokeOrder(factory.id);

  await approveSamplingForSmokeTest(order.id);

  const productionStage = order.stages.find((stage) => stage.stageCode === "STITCHING");

  if (!productionStage) {
    throw new Error("STITCHING stage not found on DP-SMOKE-1001.");
  }

  const nextCompletedQuantity = Math.min(productionStage.plannedQuantity, productionStage.completedQuantity + 25);

  if (nextCompletedQuantity === productionStage.completedQuantity) {
    console.log("STITCHING is already fully complete; smoke test will verify current cumulative quantity.");
  }

  const importText = [
    "orderNumber,BUYER,STYLE,COLOUR,DESC.,ORDER QTY.,CUTTING TOTAL QTY,CUTTING TO LINE IN BAL,LINE LOADING,TODAY LINE OUT,TOTAL LINE OUT, LINE IN BAL,PRODUCTION STATUS,rowColorHex,updateDate,notes",
    `${order.orderNumber},Smoke Buyer,Production Tee,BLACK,T-SHIRT,200,${nextCompletedQuantity},-2,${nextCompletedQuantity},25,${nextCompletedQuantity},${Math.max(0, 200 - nextCompletedQuantity)},RUNNING PROD.,FF92D050,${new Date().toISOString()},Daily production smoke update`
  ].join("\n");

  const preview = await erpImport.previewDailyProductionImport({
    factoryId: factory.id,
    fileName: "daily-production-smoke.csv",
    sourceType: "CSV",
    importText,
    createdBy: "daily-production-smoke-test"
  });

  console.log("Daily production preview:");
  console.table({
    status: preview.status,
    rowsReceived: preview.rowsReceived,
    rowsAccepted: preview.acceptedRows.length,
    rowsRejected: preview.rejectedRows.length
  });

  if (preview.status !== "PREVIEW_READY") {
    console.dir(preview.rejectedRows, { depth: null });
    throw new Error("Daily production preview should be ready.");
  }

  const applied = await erpImport.applyDailyProductionImport({
    uploadId: preview.uploadId,
    factoryId: factory.id,
    acceptedRows: preview.acceptedRows,
    approvedBy: "daily-production-smoke-test"
  });

  const updatedStage = await prisma.orderStage.findUnique({
    where: {
      id: productionStage.id
    }
  });

  const inventory = await prisma.stageInventory.findFirst({
    where: {
      orderId: order.id,
      workflowStageId: productionStage.workflowStageId
    }
  });

  const orderLine = await prisma.orderLine.findFirst({
    where: {
      orderId: order.id,
      colorName: "BLACK"
    },
    include: {
      productionUnit: true
    }
  });

  if (!applied.success || !updatedStage || updatedStage.completedQuantity !== nextCompletedQuantity) {
    throw new Error("Daily production import did not update KNITTING completed quantity.");
  }

  if (!inventory || inventory.quantity !== nextCompletedQuantity) {
    throw new Error("Daily production import did not update KNITTING inventory quantity.");
  }

  if (!orderLine || orderLine.productionUnit?.code !== "UNIT_I" || orderLine.rowColorHex !== "FF92D050") {
    throw new Error("Daily production import did not map the row color to Unit-I order-line tracking.");
  }

  if (orderLine.cuttingToLineBal !== -2) {
    throw new Error("Daily production import did not preserve negative cutting-to-line balance.");
  }

  console.log("Updated production state:");
  console.table({
    orderNumber: order.orderNumber,
    stageCode: updatedStage.stageCode,
    completedQuantity: updatedStage.completedQuantity,
    inventoryQuantity: inventory.quantity,
    colorName: orderLine.colorName,
    productionUnit: orderLine.productionUnit?.name,
    rowColorHex: orderLine.rowColorHex,
    cuttingToLineBalance: orderLine.cuttingToLineBal
  });
  console.log("Daily production import smoke test passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
