import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/security/password.js";

const prisma = new PrismaClient();

type SeedStage = {
  id: string;
  code: string;
  name: string;
};

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Local seed is disabled in production. Use db:seed:prod-admin instead.");
  }

  const factory = await prisma.factory.upsert({
    where: { code: "RISHI" },
    update: {},
    create: {
      name: "Rishi Fabrics",
      code: "RISHI",
      workingDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
      shiftsPerDay: 1,
      workingHoursPerDay: 8
    }
  });

  const defaultPasswordHash = await hashPassword("Factory@2026");
  const users = [
    ["admin@rishifabrics.local", "Srijan Chopra", "ADMIN"],
    ["md@rishifabrics.local", "Managing Director", "CEO"],
    ["erp@rishifabrics.local", "ERP Manager", "ERP_MANAGER"],
    ["merchant@rishifabrics.local", "Merchant User", "MERCHANT"]
  ] as const;

  for (const [email, name, role] of users) {
    await prisma.user.upsert({
      where: { email },
      update: {
        factoryId: factory.id,
        name,
        role,
        isActive: true,
        status: "ACTIVE",
        requestedRole: null,
        approvedAt: new Date(),
        passwordHash: defaultPasswordHash,
        passwordChangedAt: new Date()
      },
      create: {
        factoryId: factory.id,
        email,
        name,
        role,
        status: "ACTIVE",
        approvedAt: new Date(),
        passwordHash: defaultPasswordHash,
        passwordChangedAt: new Date()
      }
    });
  }

  const unitOne = await prisma.productionUnit.upsert({
    where: {
      factoryId_code: {
        factoryId: factory.id,
        code: "UNIT_I"
      }
    },
    update: {},
    create: {
      factoryId: factory.id,
      code: "UNIT_I",
      name: "Unit-I",
      kind: "GARMENT_PRODUCTION"
    }
  });

  const unitTwo = await prisma.productionUnit.upsert({
    where: {
      factoryId_code: {
        factoryId: factory.id,
        code: "UNIT_II"
      }
    },
    update: {},
    create: {
      factoryId: factory.id,
      code: "UNIT_II",
      name: "Unit-II",
      kind: "GARMENT_PRODUCTION"
    }
  });

  const pendingUnit = await prisma.productionUnit.upsert({
    where: {
      factoryId_code: {
        factoryId: factory.id,
        code: "PENDING_PRODUCTION"
      }
    },
    update: {},
    create: {
      factoryId: factory.id,
      code: "PENDING_PRODUCTION",
      name: "Pending Production",
      kind: "HOLDING"
    }
  });

  const dispatchUnit = await prisma.productionUnit.upsert({
    where: {
      factoryId_code: {
        factoryId: factory.id,
        code: "DISPATCH_DONE"
      }
    },
    update: {},
    create: {
      factoryId: factory.id,
      code: "DISPATCH_DONE",
      name: "Dispatch Done",
      kind: "DISPATCH"
    }
  });

  const colorMappings = [
    ["FF92D050", "Green - Running Production", "RUNNING PROD.", unitOne.id],
    ["FF00B0F0", "Blue - 2nd Unit", "2ND UNIT", unitTwo.id],
    ["FFFF0000", "Red - Pending Production", "PENDING PROD.", pendingUnit.id],
    ["FFFFFF00", "Yellow - Dispatch Done", "DISPATCH DONE", dispatchUnit.id]
  ] as const;

  for (const [colorHex, label, productionStatus, productionUnitId] of colorMappings) {
    await prisma.unitColorMapping.upsert({
      where: {
        factoryId_colorHex: {
          factoryId: factory.id,
          colorHex
        }
      },
      update: {
        label,
        productionStatus,
        productionUnitId,
        isActive: true
      },
      create: {
        factoryId: factory.id,
        colorHex,
        label,
        productionStatus,
        productionUnitId
      }
    });
  }



  const stageMappings = [
    ["DAILY_PRODUCTION", "CUTTING TOTAL QTY", "PANEL_CUTTING", "completed_quantity", "snapshot"],
    ["DAILY_PRODUCTION", "LINE LOADING", "STITCHING", "input_quantity", "snapshot"],
    ["DAILY_PRODUCTION", "TOTAL LINE OUT", "STITCHING", "completed_quantity", "snapshot"],
    ["DAILY_PRODUCTION", "DISPATCH DONE", "DISPATCH", "dispatch_quantity", "snapshot"]
  ] as const;

  for (const [importType, sourceColumn, targetStageKey, quantityType, applyMode] of stageMappings) {
    await prisma.importStageMapping.upsert({
      where: {
        factoryId_importType_sourceColumn: {
          factoryId: factory.id,
          importType,
          sourceColumn
        }
      },
      update: {
        targetStageKey,
        quantityType,
        applyMode,
        isActive: true
      },
      create: {
        factoryId: factory.id,
        importType,
        sourceColumn,
        targetStageKey,
        quantityType,
        applyMode
      }
    });
  }

  const workflow = await prisma.workflowTemplate.upsert({
    where: {
      factoryId_name: {
        factoryId: factory.id,
        name: "Garment Manufacturing"
      }
    },
    update: {},
    create: {
      factoryId: factory.id,
      name: "Garment Manufacturing",
      description: "Default garment workflow for Phase 1."
    }
  });

  const stages = [
    ["LAB_DIP_APPROVAL", "Lab Dip Approval", "MANUAL", "APPROVAL"],
    ["FOB_APPROVAL", "FOB Approval", "MANUAL", "APPROVAL"],
    ["PO_CONFIRMATION", "PO Confirmation", "MANUAL", "APPROVAL"],

    ["KNITTING", "Knitting", "AUTOMATIC", "PRODUCTION"],
    ["FABRIC_INSPECTION", "Fabric Inspection", "HYBRID", "INSPECTION"],
    ["DYEING", "Dyeing", "AUTOMATIC", "PRODUCTION"],
    ["PANEL_CUTTING", "Panel Cutting", "AUTOMATIC", "PRODUCTION"],
    ["STITCHING", "Stitching", "AUTOMATIC", "PRODUCTION"],
    ["FINISHING", "Finishing", "AUTOMATIC", "PRODUCTION"],

    ["PACKING", "Packing", "AUTOMATIC", "DISPATCH"],
    ["DISPATCH", "Dispatch", "HYBRID", "DISPATCH"]
  ] as const;

  for (const [index, stage] of stages.entries()) {
    const [code, name, kind, category] = stage;
    await prisma.workflowStage.upsert({
      where: {
        workflowTemplateId_code: {
          workflowTemplateId: workflow.id,
          code
        }
      },
      update: {},
      create: {
        workflowTemplateId: workflow.id,
        code,
        name,
        kind,
        category,
        sequence: index + 1,
        isDispatchStage: code === "DISPATCH"
      }
    });
  }

  const existingOrder = await prisma.order.findFirst({
    where: {
      factoryId: factory.id,
      orderNumber: "ORD-1001"
    }
  });

  if (!existingOrder) {
    const order = await prisma.order.create({
      data: {
        factoryId: factory.id,
        workflowTemplateId: workflow.id,
        orderNumber: "ORD-1001",
        buyerName: "Acme Retail",
        productCategory: "T-Shirts",
        orderQuantity: 10000,
        deliveryDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 21),
        currentStageCode: "LAB_DIP_APPROVAL",
        events: {
          create: {
            factoryId: factory.id,
            type: "ORDER_CREATED",
            message: "Order ORD-1001 created from seed data."
          }
        }
      }
    });

    const workflowStages = await prisma.workflowStage.findMany({
      where: { workflowTemplateId: workflow.id },
      orderBy: { sequence: "asc" }
    });

    await prisma.orderStage.createMany({
      data: workflowStages.map((stage: SeedStage) => ({
        orderId: order.id,
        workflowStageId: stage.id,
        stageCode: stage.code,
        stageName: stage.name,
        plannedQuantity: order.orderQuantity
      }))
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
