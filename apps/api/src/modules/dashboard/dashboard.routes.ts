import { Router } from "express";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";
import { requirePermission } from "../../security/rbac.js";
import { ProgressService } from "../../core/progress/progress.service.js";
import { DelayService } from "../../core/delay/delay.service.js";

export const dashboardRouter = Router();
const progressService = new ProgressService();
const delayService = new DelayService();

dashboardRouter.get("/control-tower", requirePermission("VIEW_DASHBOARD"), asyncRoute(async (req, res) => {
  const factoryId = String(req.query.factoryId ?? req.authUser?.factoryId ?? "");
  const where = factoryId ? { factoryId } : undefined;
  const now = new Date();
  const nextSevenDays = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7);

  const [
    ordersRunning,
    dispatchedOrders,
    upcomingDeliveries,
    recentEvents,
    orders,
    stageInventories,
    openReworkTickets,
    uploadSummary
  ] =
    await Promise.all([
      prisma.order.count({ where: { ...where, status: "RUNNING" } }),
      prisma.order.count({ where: { ...where, status: "DISPATCHED" } }),
      prisma.order.findMany({
        where: {
          ...where,
          status: { not: "DISPATCHED" },
          deliveryDate: { gte: now, lte: nextSevenDays }
        },
        orderBy: { deliveryDate: "asc" },
        take: 10
      }),
      prisma.event.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 20
      }),
      prisma.order.findMany({
        where,
        include: {
          stages: true,
          reworkTickets: true,
          inventories: {
            include: {
              workflowStage: true
            }
          }
        },
        orderBy: { deliveryDate: "asc" },
        take: 25
      }),
      prisma.stageInventory.findMany({
        where: {
          quantity: { gt: 0 },
          ...(factoryId ? { order: { factoryId } } : {})
        },
        include: {
          workflowStage: true
        }
      }),
      prisma.reworkTicket.findMany({
        where: {
          closedAt: null,
          ...(factoryId ? { order: { factoryId } } : {})
        },
        include: {
          order: true
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 20
      }),
      prisma.upload.groupBy({
        by: ["status"],
        where,
        _count: {
          _all: true
        },
        _sum: {
          rowsAccepted: true,
          rowsRejected: true
        }
      })
    ]);

  const stageInventorySummary = stageInventories
    .reduce<Array<{
      stageCode: string;
      stageName: string;
      category: string;
      quantity: number;
    }>>((summary, inventory) => {
      const existing = summary.find((item) => item.stageCode === inventory.workflowStage.code);

      if (existing) {
        existing.quantity += inventory.quantity;
        return summary;
      }

      summary.push({
        stageCode: inventory.workflowStage.code,
        stageName: inventory.workflowStage.name,
        category: inventory.workflowStage.category,
        quantity: inventory.quantity
      });

      return summary;
    }, [])
    .sort((left, right) => right.quantity - left.quantity);

  const totalInventoryQuantity = stageInventorySummary.reduce((sum, stage) => sum + stage.quantity, 0);
  const totalReworkQuantity = openReworkTickets.reduce((sum, ticket) => sum + ticket.quantity, 0);
  const importsPending = uploadSummary
    .filter((upload) => upload.status !== "APPLIED")
    .reduce((sum, upload) => sum + upload._count._all, 0);

  const progressReports = await Promise.all(
    orders.map((order) => progressService.getOrderProgress(order.id))
  );
  const progressByOrderId = new Map(
    progressReports.map((report) => [report.orderId, report])
  );
  const delayReports = await Promise.all(
    orders.map((order) => delayService.getOrderDelay(order.id, now))
  );
  const delayByOrderId = new Map(
    delayReports.map((report) => [report.orderId, report])
  );
  const ordersDelayed = delayReports.filter((report) => report.status === "DELAYED").length;
  const ordersAtRisk = delayReports.filter((report) => report.status === "AT_RISK").length;

  const orderJourneyStatus = orders.map((order) => {
    const progress = progressByOrderId.get(order.id);
    const delay = delayByOrderId.get(order.id);
    const completed = progress?.stageProgress.reduce((sum, stage) => sum + stage.completedQuantity, 0) ?? 0;
    const reworkQuantity = progress?.materialAccountability.openReworkQuantity ?? 0;
    const activeInventory = progress?.stageProgress
      .filter((stage) => stage.activeQuantity > 0)
      .map((stage) => ({
        stageCode: stage.stageCode,
        stageName: stage.stageName,
        quantity: stage.activeQuantity
      })) ?? [];
    const progressPercent = progress?.overallProgressPercent ?? 0;

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      buyerName: order.buyerName,
      productCategory: order.productCategory,
      orderQuantity: order.orderQuantity,
      currentStageCode: order.currentStageCode,
      deliveryDate: order.deliveryDate,
      status: order.status,
      completedAcrossStages: completed,
      reworkQuantity,
      progressPercent,
      activeInventory,
      pipelineProgress: progress?.pipelineProgress ?? [],
      materialAccountability: progress?.materialAccountability,
      delayStatus: delay?.status ?? "ON_TRACK",
      delayReason: delay?.reason ?? "Delay status not calculated.",
      expectedStageCode: delay?.expectedStageCode ?? null,
      expectedStageName: delay?.expectedStageName ?? null,
      plannedProgressPercent: delay?.plannedProgressPercent ?? 0,
      progressDeficitPercent: delay?.progressDeficitPercent ?? 0,
      daysRemaining: delay?.daysRemaining ?? 0,
      samplingDelay: delay?.samplingDelay,
      lineDelayReports: delay?.lineDelayReports ?? [],
      unitDelaySummary: delay?.unitDelaySummary ?? []
    };
  });

  res.json({
    metrics: {
      ordersRunning,
      ordersDelayed,
      ordersAtRisk,
      upcomingDeliveries: upcomingDeliveries.length,
      dispatchedOrders,
      totalInventoryQuantity,
      totalReworkQuantity,
      importsPending
    },
    upcomingDeliveries,
    orderJourneyStatus,
    stageInventorySummary,
    reworkSummary: openReworkTickets.map((ticket) => ({
      id: ticket.id,
      orderNumber: ticket.order.orderNumber,
      sourceStageCode: ticket.sourceStageCode,
      quantity: ticket.quantity,
      severity: ticket.severity,
      department: ticket.department,
      reason: ticket.reason,
      createdAt: ticket.createdAt
    })),
    importSummary: uploadSummary.map((upload) => ({
      status: upload.status,
      count: upload._count._all,
      rowsAccepted: upload._sum.rowsAccepted ?? 0,
      rowsRejected: upload._sum.rowsRejected ?? 0
    })),
    recentEvents
  });
}));
