const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const stages = [
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

const importStageMappings = [
  ["DAILY_PRODUCTION", "CUTTING TOTAL QTY", "PANEL_CUTTING", "completed_quantity", "snapshot"],
  ["DAILY_PRODUCTION", "CUTTING TO LINE IN BAL", "PANEL_CUTTING", "balance_quantity", "snapshot"],
  ["DAILY_PRODUCTION", "LINE LOADING", "STITCHING", "input_quantity", "snapshot"],
  ["DAILY_PRODUCTION", "TODAY LINE OUT", "STITCHING", "daily_completed_quantity", "increment"],
  ["DAILY_PRODUCTION", "TOTAL LINE OUT", "STITCHING", "completed_quantity", "snapshot"],
  ["DAILY_PRODUCTION", "LINE IN BAL", "STITCHING", "balance_quantity", "snapshot"],
  ["DAILY_PRODUCTION", "DISPATCH DONE", "DISPATCH", "dispatch_quantity", "snapshot"]
];

async function upsertUnit(factoryId, code, name, kind) {
  return prisma.productionUnit.upsert({
    where: { factoryId_code: { factoryId, code } },
    update: { name, kind, isActive: true },
    create: { factoryId, code, name, kind, isActive: true }
  });
}

async function main() {
  if (!process.env.DATABASE_URL?.startsWith("postgres")) {
    throw new Error("DATABASE_URL must be the real production Postgres URL and must start with postgresql:// or postgres://");
  }

  const factory = await prisma.factory.upsert({
    where: { code: "RISHI" },
    update: { name: "Rishi Fabrics" },
    create: {
      name: "Rishi Fabrics",
      code: "RISHI",
      workingDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
      shiftsPerDay: 1,
      workingHoursPerDay: 8
    }
  });

  const workflow = await prisma.workflowTemplate.upsert({
    where: {
      factoryId_name: {
        factoryId: factory.id,
        name: "Default Garment Workflow"
      }
    },
    update: {
      isActive: true,
      description: "Rishi Fabrics production workflow for sampling, fabric, production, and dispatch tracking."
    },
    create: {
      factoryId: factory.id,
      name: "Default Garment Workflow",
      description: "Rishi Fabrics production workflow for sampling, fabric, production, and dispatch tracking.",
      isActive: true
    }
  });

  const stageRecords = [];
  for (const [code, name, kind, category, sequence] of stages) {
    const stage = await prisma.workflowStage.upsert({
      where: {
        workflowTemplateId_code: {
          workflowTemplateId: workflow.id,
          code
        }
      },
      update: {
        name,
        kind,
        category,
        sequence,
        isDispatchStage: code === "DISPATCH"
      },
      create: {
        workflowTemplateId: workflow.id,
        code,
        name,
        kind,
        category,
        sequence,
        isDispatchStage: code === "DISPATCH"
      }
    });
    stageRecords.push(stage);
  }

  for (let index = 0; index < stageRecords.length - 2; index += 1) {
    const fromStage = stageRecords[index];
    const toStage = stageRecords[index + 1];
    const existing = await prisma.workflowTransition.findFirst({
      where: {
        workflowTemplateId: workflow.id,
        fromStageId: fromStage.id,
        toStageId: toStage.id,
        transitionType: "FORWARD"
      }
    });
    if (!existing) {
      await prisma.workflowTransition.create({
        data: {
          workflowTemplateId: workflow.id,
          fromStageId: fromStage.id,
          toStageId: toStage.id,
          transitionType: "FORWARD"
        }
      });
    }
  }

  for (const [importType, sourceColumn, targetStageKey, quantityType, applyMode] of importStageMappings) {
    await prisma.importStageMapping.upsert({
      where: {
        factoryId_importType_sourceColumn: {
          factoryId: factory.id,
          importType,
          sourceColumn
        }
      },
      update: { targetStageKey, quantityType, applyMode, isActive: true },
      create: { factoryId: factory.id, importType, sourceColumn, targetStageKey, quantityType, applyMode, isActive: true }
    });
  }

  const unitOne = await upsertUnit(factory.id, "UNIT_I", "Unit I", "GARMENT_PRODUCTION");
  const unitTwo = await upsertUnit(factory.id, "UNIT_II", "Unit II", "GARMENT_PRODUCTION");
  const pendingUnit = await upsertUnit(factory.id, "PENDING_PRODUCTION", "Pending Production", "HOLDING");
  const dispatchUnit = await upsertUnit(factory.id, "DISPATCH_DONE", "Dispatch Done", "DISPATCH");

  const colorMappings = [
    ["FF92D050", "Green - Running Production", "RUNNING PROD.", unitOne.id],
    ["FF00B0F0", "Blue - 2nd Unit", "2ND UNIT", unitTwo.id],
    ["FFFF0000", "Red - Pending Production", "PENDING PROD.", pendingUnit.id],
    ["FFFFFF00", "Yellow - Dispatch Done", "DISPATCH DONE", dispatchUnit.id]
  ];

  for (const [colorHex, label, productionStatus, productionUnitId] of colorMappings) {
    await prisma.unitColorMapping.upsert({
      where: { factoryId_colorHex: { factoryId: factory.id, colorHex } },
      update: { label, productionStatus, productionUnitId, isActive: true },
      create: { factoryId: factory.id, colorHex, label, productionStatus, productionUnitId, isActive: true }
    });
  }

  const activeWorkflows = await prisma.workflowTemplate.findMany({
    where: { factoryId: factory.id, isActive: true },
    include: { stages: { orderBy: { sequence: "asc" } } },
    orderBy: { createdAt: "asc" }
  });

  console.log(`Production import config ready for ${factory.name} (${factory.id}).`);
  for (const activeWorkflow of activeWorkflows) {
    console.log(`- ${activeWorkflow.name}: ${activeWorkflow.stages.map((stage) => stage.code).join(", ")}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
