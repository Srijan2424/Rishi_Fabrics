import { Router } from "express";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";
import { requirePermission } from "../../security/rbac.js";
import { DelayService } from "../../core/delay/delay.service.js";
import { ProgressService } from "../../core/progress/progress.service.js";
import { sendEmail } from "../../services/email.js";

export const reportsRouter = Router();
reportsRouter.use(requirePermission("VIEW_REPORTS"));

const progressService = new ProgressService();
const delayService = new DelayService();

async function resolveMdReportRecipients(factoryId?: string) {
  const managingUsers = await prisma.user.findMany({
    where: {
      role: "CEO",
      status: "ACTIVE",
      isActive: true,
      ...(factoryId ? { factoryId } : {})
    },
    select: {
      email: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  const roleEmails = managingUsers.map((user) => user.email).filter(Boolean);
  if (roleEmails.length > 0) return Array.from(new Set(roleEmails));

  return Array.from(new Set(
    String(process.env.MD_REPORT_EMAIL || process.env.ADMIN_ALERT_EMAIL || "")
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean)
  ));
}

reportsRouter.post("/daily-production/email/send", asyncRoute(async (req, res) => {
  const expectedSecret = process.env.REPORT_CRON_SECRET;
  const providedSecret = String(req.headers["x-report-secret"] ?? req.query.secret ?? "");

  if (expectedSecret && providedSecret !== expectedSecret) {
    res.status(401).json({ error: "Invalid report secret" });
    return;
  }

  const factoryId = String(req.query.factoryId ?? req.body?.factoryId ?? "");
  const where = factoryId ? { factoryId } : undefined;
  const today = new Date();
  const since = dayStart(today);
  const latestDailyProductionUpload = await prisma.upload.findFirst({
    where: factoryId
      ? { factoryId, sourceType: { startsWith: "DAILY_PRODUCTION" }, status: "APPLIED" }
      : { sourceType: { startsWith: "DAILY_PRODUCTION" }, status: "APPLIED" },
    orderBy: { createdAt: "desc" }
  });
  const latestUploadDayStart = latestDailyProductionUpload ? dayStart(latestDailyProductionUpload.createdAt) : since;

  const [orders, missingRows, updateMovements, uploads, fabricRowsToday, wipRowsToday, samplingStylesToday] = await Promise.all([
    prisma.order.findMany({ where, include: { orderLines: true }, orderBy: { updatedAt: "desc" }, take: 500 }),
    prisma.orderLine.findMany({
      where: {
        lastUpdatedAt: { lt: latestUploadDayStart },
        order: factoryId ? { factoryId, status: { not: "DISPATCHED" } } : { status: { not: "DISPATCHED" } }
      },
      include: { order: true },
      orderBy: { lastUpdatedAt: "asc" },
      take: 100
    }),
    prisma.materialMovement.findMany({
      where: factoryId
        ? { createdAt: { gte: since }, order: { factoryId } }
        : { createdAt: { gte: since } },
      include: { order: true },
      orderBy: { createdAt: "desc" },
      take: 100
    }),
    prisma.upload.findMany({
      where: factoryId
        ? { factoryId, createdAt: { gte: since } }
        : { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 50
    }),
    prisma.fabricDyeingSnapshot.findMany({
      where: factoryId
        ? { factoryId, createdAt: { gte: since } }
        : { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 100
    }),
    prisma.wipSnapshot.findMany({
      where: factoryId
        ? { factoryId, createdAt: { gte: since } }
        : { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 100
    }),
    prisma.techPackStyle.findMany({
      where: factoryId
        ? { factoryId, createdAt: { gte: since } }
        : { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 100
    })
  ]);

  const recipients = await resolveMdReportRecipients(factoryId || undefined);
  if (recipients.length === 0) {
    res.status(400).json({ error: "No active CEO users found and MD_REPORT_EMAIL/ADMIN_ALERT_EMAIL is not configured" });
    return;
  }

  const dailyProductionCorrections = updateMovements.filter((movement) => (
    movement.movementType === "ROLLBACK" ||
    String(movement.notes ?? "").includes("Daily production correction")
  ));

  const reportLines = [
    `Rishi Fabrics Daily Production Report - ${formatDate(today)}`,
    "",
    `Latest daily production upload: ${latestDailyProductionUpload?.fileName ?? "No applied upload found"}`,
    `Running orders: ${orders.filter((order) => order.status === "RUNNING").length}`,
    `Rows updated today: ${updateMovements.length}`,
    `Reduced/corrected quantities today: ${dailyProductionCorrections.length}`,
    `Uploads today: ${uploads.length}`,
    `Rows missing from latest daily production sheet: ${missingRows.length}`,
    "",
    "Module summary:",
    `- WIP rows uploaded today: ${wipRowsToday.length}`,
    `- Fabric/dyeing rows uploaded today: ${fabricRowsToday.length}`,
    `- Sampling styles uploaded today: ${samplingStylesToday.length}`,
    "",
    "Styles/orders missing from latest daily production sheet:",
    ...(missingRows.length > 0
      ? missingRows.slice(0, 30).map((line) => `- ${line.order.orderNumber} / ${line.styleName} / ${line.colorName}; last seen ${formatDate(line.lastUpdatedAt)}`)
      : ["- None"]),
    "",
    "Operational update warnings:",
    ...(updateMovements.flatMap((movement) => extractDailyProductionUpdates(movement.notes)).length > 0
      ? updateMovements
          .filter((movement) => extractDailyProductionUpdates(movement.notes).length > 0)
          .slice(0, 30)
          .map((movement) => `- ${movement.order.orderNumber}: ${extractDailyProductionUpdates(movement.notes).join("; ")}`)
      : ["- None"]),
    "",
    "Reduced/corrected quantities:",
    ...(dailyProductionCorrections.length > 0
      ? dailyProductionCorrections
          .slice(0, 30)
          .map((movement) => `- ${movement.order.orderNumber}: ${movement.quantity} pcs corrected at ${movement.toStageCode ?? movement.fromStageCode ?? "stage"}; ${movement.notes ?? "No note"}`)
      : ["- None"])
  ];

  const result = await sendEmail({
    to: recipients,
    subject: `Rishi Fabrics Daily Production Report - ${formatDate(today)}`,
    text: reportLines.join("\n")
  });

  if (!result.ok) {
    res.status(502).json({ error: result.error ?? "Email could not be sent" });
    return;
  }

  res.json({
    ok: true,
    sentTo: recipients,
    missingRows: missingRows.length,
    rowsUpdatedToday: updateMovements.length,
    uploadsToday: uploads.length
  });
}));

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

function startOfWeek(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  const day = value.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  value.setDate(value.getDate() + diff);
  return value;
}

function endOfWeek(start: Date) {
  const value = new Date(start);
  value.setDate(value.getDate() + 6);
  value.setHours(23, 59, 59, 999);
  return value;
}

function dayStart(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function extractDailyProductionUpdates(notes: string | null | undefined) {
  const marker = "Daily production updates:";
  const text = String(notes ?? "");
  const index = text.indexOf(marker);
  if (index === -1) return [];
  return text
    .slice(index + marker.length)
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isFabricComplete(row: { status: string | null; fabricSentForDyeingKg: number; inhouseAfterDyeingKg: number }) {
  const status = String(row.status ?? "").toUpperCase();
  return status.includes("COMPLETE") || status.includes("DONE") || status.includes("RECEIVED") || status.includes("INHOUSE") || status.includes("IN-HOUSE") || (row.fabricSentForDyeingKg > 0 && row.inhouseAfterDyeingKg >= row.fabricSentForDyeingKg);
}

function groupStageProgress(progressReports: Awaited<ReturnType<ProgressService["getOrderProgress"]>>[]) {
  const grouped = new Map<string, { stageCode: string; stageName: string; plannedQuantity: number; activeQuantity: number; completedQuantity: number; progressPercent: number; rows: number }>();

  for (const report of progressReports) {
    for (const stage of report.stageProgress) {
      const key = stage.stageCode;
      const current = grouped.get(key) ?? { stageCode: stage.stageCode, stageName: stage.stageName, plannedQuantity: 0, activeQuantity: 0, completedQuantity: 0, progressPercent: 0, rows: 0 };
      current.plannedQuantity += stage.plannedQuantity;
      current.activeQuantity += stage.activeQuantity;
      current.completedQuantity += stage.completedQuantity;
      current.progressPercent += stage.stageCompletionPercent;
      current.rows += 1;
      grouped.set(key, current);
    }
  }

  return Array.from(grouped.values()).map((stage) => ({
    ...stage,
    progressPercent: stage.rows > 0 ? Math.round(stage.progressPercent / stage.rows) : 0
  }));
}

function groupPipelineProgress(progressReports: Awaited<ReturnType<ProgressService["getOrderProgress"]>>[]) {
  const pipelines = ["SAMPLING", "FABRIC", "GARMENT"];
  return pipelines.map((pipeline) => {
    const rows = progressReports.flatMap((report) => report.pipelineProgress.filter((row) => row.pipeline === pipeline));
    return {
      pipeline,
      plannedQuantity: sum(rows.map((row) => row.plannedQuantity)),
      activeQuantity: sum(rows.map((row) => row.activeQuantity)),
      completedQuantity: sum(rows.map((row) => row.completedQuantity)),
      progressPercent: average(rows.map((row) => row.progressPercent))
    };
  });
}

reportsRouter.get("/summary", asyncRoute(async (req, res) => {
  const factoryId = String(req.query.factoryId ?? req.authUser?.factoryId ?? "");
  const where = factoryId ? { factoryId } : undefined;
  const selectedDate = typeof req.query.week === "string" ? new Date(req.query.week) : new Date();
  const weekStart = startOfWeek(Number.isNaN(selectedDate.getTime()) ? new Date() : selectedDate);
  const weekEnd = endOfWeek(weekStart);
  const weekWhere = factoryId ? { factoryId, createdAt: { gte: weekStart, lte: weekEnd } } : { createdAt: { gte: weekStart, lte: weekEnd } };

  const [orders, uploads, weeklyUploads, fabricRows, weeklyFabricRows, wipRows, weeklyWipRows, techPackStyles, weeklyTechPackStyles, weeklyDailyProductionMovements] = await Promise.all([
    prisma.order.findMany({ where, include: { stages: true, samplingApprovals: true, orderLines: true }, orderBy: { updatedAt: "desc" }, take: 500 }),
    prisma.upload.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.upload.findMany({ where: weekWhere, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.fabricDyeingSnapshot.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.fabricDyeingSnapshot.findMany({ where: weekWhere, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.wipSnapshot.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.wipSnapshot.findMany({ where: weekWhere, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.techPackStyle.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.techPackStyle.findMany({ where: weekWhere, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.materialMovement.findMany({
      where: factoryId
        ? { createdAt: { gte: weekStart, lte: weekEnd }, order: { factoryId } }
        : { createdAt: { gte: weekStart, lte: weekEnd } },
      include: { order: true },
      orderBy: { createdAt: "desc" },
      take: 500
    })
  ]);

  const progressReports = await Promise.all(orders.map((order) => progressService.getOrderProgress(order.id)));
  const delayReports = await Promise.all(orders.map((order) => delayService.getOrderDelay(order.id)));
  const progressByOrderId = new Map(progressReports.map((report) => [report.orderId, report]));
  const delayByOrderId = new Map(delayReports.map((report) => [report.orderId, report]));

  const dispatchedOrders = orders.filter((order) => order.status === "DISPATCHED");
  const dispatchedThisWeek = dispatchedOrders.filter((order) => order.updatedAt >= weekStart && order.updatedAt <= weekEnd);
  const runningOrders = orders.filter((order) => order.status === "RUNNING");
  const pendingFabricRows = fabricRows.filter((row) => !isFabricComplete(row));
  const completedFabricRows = fabricRows.filter((row) => isFabricComplete(row));
  const rejectedRows = weeklyUploads.reduce((total, upload) => total + upload.rowsRejected, 0);
  const acceptedRows = weeklyUploads.reduce((total, upload) => total + upload.rowsAccepted, 0);
  const latestDailyProductionUpload = uploads.find((upload) => upload.sourceType.startsWith("DAILY_PRODUCTION") && upload.status === "APPLIED");
  const latestDailyProductionDayStart = latestDailyProductionUpload ? dayStart(latestDailyProductionUpload.createdAt) : null;
  const pendingApprovals = orders.flatMap((order) => order.samplingApprovals).filter((approval) => approval.status !== "APPROVED");
  const approvedSamplingOrders = orders.filter((order) => order.samplingApprovals.length > 0 && order.samplingApprovals.every((approval) => approval.status === "APPROVED"));
  const riskOrders = orders
    .map((order) => ({ order, delay: delayByOrderId.get(order.id), progress: progressByOrderId.get(order.id) }))
    .filter((row) => row.delay?.status === "DELAYED" || row.delay?.status === "AT_RISK")
    .map((row) => ({
      id: row.order.id,
      orderNumber: row.order.orderNumber,
      buyerName: row.order.buyerName,
      status: row.delay?.status,
      reason: row.delay?.reason,
      progressPercent: row.progress?.overallProgressPercent ?? 0,
      plannedProgressPercent: row.delay?.plannedProgressPercent ?? 0,
      deliveryDate: row.order.deliveryDate
    }))
    .slice(0, 20);

  const productionStatus = orders.slice(0, 80).map((order) => {
    const progress = progressByOrderId.get(order.id);
    const delay = delayByOrderId.get(order.id);
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      buyerName: order.buyerName,
      productCategory: order.productCategory,
      orderQuantity: order.orderQuantity,
      status: order.status,
      currentStageCode: order.currentStageCode,
      deliveryDate: order.deliveryDate,
      progressPercent: progress?.overallProgressPercent ?? 0,
      delayStatus: delay?.status ?? "ON_TRACK",
      delayReason: delay?.reason ?? "Progress not calculated."
    };
  });

  const stageProgress = groupStageProgress(progressReports);
  const pipelineProgress = groupPipelineProgress(progressReports);
  const updateAlertsByOrderId = new Map<string, string[]>();
  const quantityCorrections = weeklyDailyProductionMovements
    .filter((movement) => movement.movementType === "ROLLBACK" || String(movement.notes ?? "").includes("Daily production correction"))
    .map((movement) => ({
      id: movement.id,
      orderId: movement.orderId,
      orderNumber: movement.order.orderNumber,
      stageCode: movement.toStageCode ?? movement.fromStageCode,
      quantity: movement.quantity,
      notes: movement.notes,
      createdAt: movement.createdAt
    }));

  for (const movement of weeklyDailyProductionMovements) {
    const alerts = [
      ...extractDailyProductionUpdates(movement.notes),
      ...(movement.movementType === "ROLLBACK" || String(movement.notes ?? "").includes("Daily production correction")
        ? [`Corrected/reduced quantity: ${movement.quantity} pcs at ${movement.toStageCode ?? movement.fromStageCode ?? "stage"}`]
        : [])
    ];
    if (alerts.length > 0) {
      updateAlertsByOrderId.set(movement.orderId, [
        ...(updateAlertsByOrderId.get(movement.orderId) ?? []),
        ...alerts
      ]);
    }
  }

  const allDailyProductionRows = orders.flatMap((order) => order.orderLines.map((line) => ({
    orderNumber: order.orderNumber,
    deliveryDate: order.deliveryDate,
    status: order.status,
    currentStageCode: order.currentStageCode,
    notReportedInLatestDailyProduction: Boolean(latestDailyProductionDayStart && line.lastUpdatedAt < latestDailyProductionDayStart && order.status !== "DISPATCHED"),
    updateAlerts: updateAlertsByOrderId.get(order.id) ?? [],
    ...line
  })));
  const rowsMissingFromLatestDailyProduction = allDailyProductionRows.filter((row) => row.notReportedInLatestDailyProduction);
  const dailyProductionUpdateRows = allDailyProductionRows.filter((row) => row.updateAlerts.length > 0);

  res.json({
    generatedAt: new Date().toISOString(),
    week: {
      label: "Rishi Fabrics Weekly Production Report",
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString()
    },
    metrics: {
      runningOrders: runningOrders.length,
      delayedOrders: delayReports.filter((report) => report.status === "DELAYED").length,
      atRiskOrders: delayReports.filter((report) => report.status === "AT_RISK").length,
      dispatchedOrders: dispatchedOrders.length,
      dispatchedThisWeek: dispatchedThisWeek.length,
      samplingStyles: techPackStyles.length,
      samplingStylesThisWeek: weeklyTechPackStyles.length,
      pendingSamplingApprovals: pendingApprovals.length,
      completedSamplingOrders: approvedSamplingOrders.length,
      pendingFabricRows: pendingFabricRows.length,
      completedFabricRows: completedFabricRows.length,
      weeklyFabricRows: weeklyFabricRows.length,
      wipRows: wipRows.length,
      weeklyWipRows: weeklyWipRows.length,
      uploadsThisWeek: weeklyUploads.length,
      acceptedRows,
      rejectedRows,
      dailyProductionUpdateAlerts: dailyProductionUpdateRows.length,
      reducedOrCorrectedQuantities: quantityCorrections.length,
      rowsMissingFromLatestDailyProduction: rowsMissingFromLatestDailyProduction.length,
      averageOrderProgress: average(progressReports.map((report) => report.overallProgressPercent))
    },
    template: [
      "Executive Summary",
      "Sampling Progress",
      "Production / Orders Progress",
      "Fabric / Dyeing Progress",
      "Upload Health",
      "MD Action Points"
    ],
    sections: {
      executiveSummary: {
        totalRunningOrders: runningOrders.length,
        ordersDelayed: delayReports.filter((report) => report.status === "DELAYED").length,
        ordersAtRisk: delayReports.filter((report) => report.status === "AT_RISK").length,
        averageOrderProgress: average(progressReports.map((report) => report.overallProgressPercent)),
        rejectedRowsThisWeek: rejectedRows
      },
      samplingProgress: {
        totalStyles: techPackStyles.length,
        uploadedThisWeek: weeklyTechPackStyles.length,
        pendingApprovals: pendingApprovals.length,
        completedOrders: approvedSamplingOrders.length,
        recentStyles: weeklyTechPackStyles.slice(0, 25)
      },
      productionProgress: {
        runningOrders: runningOrders.length,
        dispatchedThisWeek: dispatchedThisWeek.length,
        averageProgressPercent: average(progressReports.map((report) => report.overallProgressPercent)),
        pipelineProgress,
        stageProgress,
        riskOrders,
        rowsMissingFromLatestDailyProduction: rowsMissingFromLatestDailyProduction.length,
        missingFromLatestDailyProduction: rowsMissingFromLatestDailyProduction.slice(0, 50)
      },
      fabricProgress: {
        totalRows: fabricRows.length,
        rowsThisWeek: weeklyFabricRows.length,
        pendingRows: pendingFabricRows.length,
        completedRows: completedFabricRows.length,
        sentForDyeingKg: Math.round(sum(fabricRows.map((row) => row.fabricSentForDyeingKg))),
        inhouseAfterDyeingKg: Math.round(sum(fabricRows.map((row) => row.inhouseAfterDyeingKg))),
        shortageKg: Math.round(sum(fabricRows.map((row) => row.actualShortageFabricBalanceKg))),
        pendingRowsDetail: pendingFabricRows.slice(0, 50)
      },
      uploadHealth: {
        uploadsThisWeek: weeklyUploads.length,
        acceptedRows,
        rejectedRows,
        dailyProductionUpdateAlerts: dailyProductionUpdateRows.length,
        reducedOrCorrectedQuantities: quantityCorrections.length,
        filesNeedingCorrection: weeklyUploads.filter((upload) => upload.rowsRejected > 0),
        dailyProductionUpdates: dailyProductionUpdateRows.slice(0, 50),
        quantityCorrections: quantityCorrections.slice(0, 50),
        missingFromLatestDailyProduction: rowsMissingFromLatestDailyProduction.slice(0, 50)
      },
      productionStatus,
      dailyProduction: allDailyProductionRows.slice(0, 120),
      dailyProductionUpdates: dailyProductionUpdateRows.slice(0, 50),
      quantityCorrections: quantityCorrections.slice(0, 50),
      fabricStatus: pendingFabricRows.slice(0, 100),
      wipStatus: weeklyWipRows.slice(0, 100),
      samplingStatus: techPackStyles.slice(0, 100),
      uploadHealthRows: weeklyUploads.slice(0, 50),
      monthlyHistory: dispatchedOrders
    }
  });
}));

reportsRouter.get("/:kind.csv", asyncRoute(async (req, res) => {
  const factoryId = String(req.query.factoryId ?? req.authUser?.factoryId ?? "");
  const kind = req.params.kind;
  let rows: Record<string, unknown>[] = [];

  if (kind === "uploads") {
    rows = await prisma.upload.findMany({ where: factoryId ? { factoryId } : undefined, orderBy: { createdAt: "desc" }, take: 500 }) as Record<string, unknown>[];
  } else if (kind === "fabric") {
    rows = await prisma.fabricDyeingSnapshot.findMany({ where: factoryId ? { factoryId } : undefined, orderBy: { createdAt: "desc" }, take: 500 }) as Record<string, unknown>[];
  } else {
    rows = await prisma.order.findMany({ where: factoryId ? { factoryId } : undefined, orderBy: { updatedAt: "desc" }, take: 500 }) as Record<string, unknown>[];
  }

  const headerSet = rows.reduce((keys, row) => { Object.keys(row).forEach((key) => keys.add(key)); return keys; }, new Set<string>());
  const headers = Array.from(headerSet);
  const body = [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="' + kind + '.csv"');
  res.send(body);
}));
