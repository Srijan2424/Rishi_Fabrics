import { prisma } from "../src/db.js";
import { DelayService } from "../src/core/delay/delay.service.js";

const delay = new DelayService();
const now = new Date();

function daysFromNow(days: number) {
  return new Date(now.getTime() + days * 1000 * 60 * 60 * 24);
}

async function createDelayTestOrder(input: {
  orderNumber: string;
  createdAt: Date;
  deliveryDate: Date;
}) {
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

  const firstStage = workflow.stages[0];

  if (!firstStage) {
    throw new Error("Workflow has no stages.");
  }

  return prisma.order.create({
    data: {
      factoryId: factory.id,
      workflowTemplateId: workflow.id,
      orderNumber: input.orderNumber,
      buyerName: "Delay Test Buyer",
      productCategory: "T-Shirts",
      orderQuantity: 100,
      deliveryDate: input.deliveryDate,
      createdAt: input.createdAt,
      currentStageCode: firstStage.code,
      stages: {
        create: workflow.stages.map((stage) => ({
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
  const suffix = Date.now();
  const delayedOrder = await createDelayTestOrder({
    orderNumber: `DELAYED-${suffix}`,
    createdAt: daysFromNow(-20),
    deliveryDate: daysFromNow(-1)
  });
  const atRiskOrder = await createDelayTestOrder({
    orderNumber: `RISK-${suffix}`,
    createdAt: now,
    deliveryDate: daysFromNow(2)
  });
  const onTrackOrder = await createDelayTestOrder({
    orderNumber: `TRACK-${suffix}`,
    createdAt: now,
    deliveryDate: daysFromNow(30)
  });
  const lineRiskOrder = await createDelayTestOrder({
    orderNumber: `LINE-RISK-${suffix}`,
    createdAt: daysFromNow(-10),
    deliveryDate: daysFromNow(10)
  });
  const units = await prisma.productionUnit.findMany({
    where: {
      factoryId: lineRiskOrder.factoryId,
      code: {
        in: ["UNIT_I", "UNIT_II"]
      }
    }
  });
  const unitOne = units.find((unit) => unit.code === "UNIT_I");
  const unitTwo = units.find((unit) => unit.code === "UNIT_II");

  await prisma.orderLine.createMany({
    data: [
      {
        orderId: lineRiskOrder.id,
        productionUnitId: unitOne?.id,
        buyerName: "Delay Test Buyer",
        styleName: "Risk Style",
        colorName: "BLACK",
        orderQuantity: 100,
        cuttingTotalQty: 0,
        lineLoadingQty: 0,
        totalLineOutQty: 0,
        lineInBalanceQty: 100,
        productionStatus: "RUNNING PROD.",
        rowColorHex: "FF92D050",
        lastUpdatedAt: now
      },
      {
        orderId: lineRiskOrder.id,
        productionUnitId: unitTwo?.id,
        buyerName: "Delay Test Buyer",
        styleName: "Track Style",
        colorName: "WHITE",
        orderQuantity: 100,
        cuttingTotalQty: 100,
        lineLoadingQty: 100,
        totalLineOutQty: 100,
        lineInBalanceQty: 0,
        productionStatus: "2ND UNIT",
        rowColorHex: "FF00B0F0",
        lastUpdatedAt: now
      }
    ]
  });

  const delayedReport = await delay.getOrderDelay(delayedOrder.id, now);
  const atRiskReport = await delay.getOrderDelay(atRiskOrder.id, now);
  const onTrackReport = await delay.getOrderDelay(onTrackOrder.id, now);
  const lineRiskReport = await delay.getOrderDelay(lineRiskOrder.id, now);

  if (delayedReport.status !== "DELAYED") {
    throw new Error(`Expected delayed order to be DELAYED, got ${delayedReport.status}`);
  }

  if (atRiskReport.status !== "AT_RISK") {
    throw new Error(`Expected near-delivery order to be AT_RISK, got ${atRiskReport.status}`);
  }

  if (onTrackReport.status !== "ON_TRACK") {
    throw new Error(`Expected fresh future order to be ON_TRACK, got ${onTrackReport.status}`);
  }

  if (lineRiskReport.lineDelayReports.length !== 2) {
    throw new Error("Expected line risk order to include two style/color delay reports.");
  }

  const delayedLine = lineRiskReport.lineDelayReports.find((line) => line.colorName === "BLACK");
  const onTrackLine = lineRiskReport.lineDelayReports.find((line) => line.colorName === "WHITE");

  if (delayedLine?.status !== "DELAYED") {
    throw new Error(`Expected BLACK line to be DELAYED, got ${delayedLine?.status}`);
  }

  if (onTrackLine?.status !== "ON_TRACK") {
    throw new Error(`Expected WHITE line to be ON_TRACK, got ${onTrackLine?.status}`);
  }

  if (!lineRiskReport.unitDelaySummary.some((unit) => unit.productionUnitCode === "UNIT_I" && unit.status === "DELAYED")) {
    throw new Error("Expected Unit-I summary to be delayed.");
  }

  const factoryDelays = await delay.getFactoryDelays(delayedOrder.factoryId, now);

  if (factoryDelays.delayed < 1 || factoryDelays.atRisk < 1 || factoryDelays.onTrack < 1) {
    throw new Error("Factory delay summary did not include expected statuses.");
  }

  console.log("Delay reports:");
  console.table([
    {
      order: delayedReport.orderNumber,
      status: delayedReport.status,
      reason: delayedReport.reason,
      planned: delayedReport.plannedProgressPercent,
      actual: delayedReport.actualProgressPercent
    },
    {
      order: atRiskReport.orderNumber,
      status: atRiskReport.status,
      reason: atRiskReport.reason,
      planned: atRiskReport.plannedProgressPercent,
      actual: atRiskReport.actualProgressPercent
    },
    {
      order: onTrackReport.orderNumber,
      status: onTrackReport.status,
      reason: onTrackReport.reason,
      planned: onTrackReport.plannedProgressPercent,
      actual: onTrackReport.actualProgressPercent
    },
    {
      order: lineRiskReport.orderNumber,
      status: lineRiskReport.status,
      reason: lineRiskReport.reason,
      planned: lineRiskReport.plannedProgressPercent,
      actual: lineRiskReport.actualProgressPercent,
      lines: lineRiskReport.lineDelayReports.length
    }
  ]);

  console.log("Delay engine smoke test passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
