const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const REQUIRED_STAGES = [
  ["LAB_DIP_APPROVAL", "Lab Dip Approval", "MANUAL", "APPROVAL", 1],
  ["FOB_APPROVAL", "FOB Approval", "MANUAL", "APPROVAL", 2],
  ["PO_CONFIRMATION", "PO Confirmation", "MANUAL", "APPROVAL", 3],
  ["KNITTING", "Knitting", "AUTOMATIC", "PRODUCTION", 4],
  ["FABRIC_INSPECTION", "Fabric Inspection", "HYBRID", "INSPECTION", 5],
  ["DYEING", "Dyeing", "AUTOMATIC", "PRODUCTION", 6],
  ["FABRIC_INSPECTION_AFTER_DYEING", "Fabric Inspection After Dyeing", "HYBRID", "INSPECTION", 7],
  ["PANEL_CUTTING", "Panel Cutting", "AUTOMATIC", "PRODUCTION", 8],
  ["STITCHING", "Stitching", "AUTOMATIC", "PRODUCTION", 9],
  ["FINISHING", "Finishing", "AUTOMATIC", "PRODUCTION", 10],
  ["PACKING", "Packing", "AUTOMATIC", "DISPATCH", 11],
  ["DISPATCH", "Dispatch", "HYBRID", "DISPATCH", 12],
  ["REWORK", "Rework", "HYBRID", "REWORK", 999]
];

async function main() {
  const workflows = await prisma.workflowTemplate.findMany({
    where: { isActive: true },
    include: { factory: true }
  });

  if (workflows.length === 0) throw new Error("No active workflows found.");

  for (const workflow of workflows) {
    const stageByCode = new Map();
    for (const [code, name, kind, category, sequence] of REQUIRED_STAGES) {
      const stage = await prisma.workflowStage.upsert({
        where: { workflowTemplateId_code: { workflowTemplateId: workflow.id, code } },
        update: { name, kind, category, sequence, isDispatchStage: code === "DISPATCH" },
        create: { workflowTemplateId: workflow.id, code, name, kind, category, sequence, isDispatchStage: code === "DISPATCH" }
      });
      stageByCode.set(code, stage);
    }

    const orders = await prisma.order.findMany({
      where: { workflowTemplateId: workflow.id },
      include: { stages: true }
    });

    for (const order of orders) {
      const existingCodes = new Set(order.stages.map((stage) => stage.stageCode));
      for (const [code, name] of REQUIRED_STAGES) {
        if (code === "REWORK" || existingCodes.has(code)) continue;
        const workflowStage = stageByCode.get(code);
        await prisma.orderStage.create({
          data: {
            orderId: order.id,
            workflowStageId: workflowStage.id,
            stageCode: code,
            stageName: name,
            plannedQuantity: order.orderQuantity
          }
        });
      }
    }

    console.log(`Repaired workflow "${workflow.name}" for "${workflow.factory.name}".`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
