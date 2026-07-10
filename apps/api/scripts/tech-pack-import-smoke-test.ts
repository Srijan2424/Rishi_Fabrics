import { PrismaClient } from "@prisma/client";
import { ErpImportService } from "../src/core/erp-import/erp-import.service.js";

const prisma = new PrismaClient();
const erpImport = new ErpImportService(prisma);

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
      orderNumber: "TP-SMOKE-1001"
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
      }
    });
  }

  return prisma.order.create({
    data: {
      factoryId,
      workflowTemplateId: workflow.id,
      orderNumber: "TP-SMOKE-1001",
      buyerName: "Smoke Buyer",
      productCategory: "Sampling Tee",
      orderQuantity: 100,
      deliveryDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      currentStageCode: "LAB_DIP_APPROVAL",
      stages: {
        create: workflowStages.map((stage) => ({
          workflowStageId: stage.id,
          stageCode: stage.code,
          stageName: stage.name,
          plannedQuantity: 100
        }))
      }
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

  const importText = [
    "orderNumber,checkpointCode,status,comments,evidence,approvedAt",
    `${order.orderNumber},LAB_DIP_APPROVAL,APPROVED,Buyer approved lab dip from tech pack smoke test,Approval reference TP-001,${new Date().toISOString()}`
  ].join("\n");

  const preview = await erpImport.previewTechPackImport({
    factoryId: factory.id,
    fileName: "tech-pack-smoke.csv",
    sourceType: "CSV",
    importText,
    createdBy: "tech-pack-smoke-test"
  });

  console.log("Tech pack preview:");
  console.table({
    status: preview.status,
    rowsReceived: preview.rowsReceived,
    rowsAccepted: preview.acceptedRows.length,
    rowsRejected: preview.rejectedRows.length
  });

  if (preview.status !== "PREVIEW_READY") {
    console.dir(preview.rejectedRows, { depth: null });
    throw new Error("Tech pack preview should be ready.");
  }

  const applied = await erpImport.applyTechPackImport({
    uploadId: preview.uploadId,
    factoryId: factory.id,
    acceptedRows: preview.acceptedRows,
    approvedBy: "tech-pack-smoke-test"
  });

  const approval = await prisma.samplingApproval.findUnique({
    where: {
      orderId_checkpointCode: {
        orderId: order.id,
        checkpointCode: "LAB_DIP_APPROVAL"
      }
    }
  });

  if (!applied.success || !approval || approval.status !== "APPROVED") {
    throw new Error("Tech pack import did not mark LAB_DIP_APPROVAL as approved.");
  }

  console.log("Updated approval:");
  console.table({
    checkpointCode: approval.checkpointCode,
    status: approval.status,
    evidence: approval.evidence
  });
  console.log("Tech pack import smoke test passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
