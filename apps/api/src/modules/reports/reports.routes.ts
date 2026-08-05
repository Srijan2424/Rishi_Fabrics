import { Router } from "express";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";
import { requirePermission } from "../../security/rbac.js";
import { DelayService } from "../../core/delay/delay.service.js";
import { ProgressService } from "../../core/progress/progress.service.js";
import { sendEmail } from "../../services/email.js";
import { sendWhatsApp } from "../../services/whatsapp.js";

export const reportsRouter = Router();

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

function resolveMdReportWhatsAppRecipients() {
  return Array.from(new Set(
    String(process.env.MD_REPORT_WHATSAPP_NUMBERS || process.env.ADMIN_REPORT_WHATSAPP_NUMBERS || "")
      .split(",")
      .map((number) => number.trim())
      .filter(Boolean)
  ));
}

function resolveReportChannel(queryChannel: unknown, path: string) {
  return String(path.includes("/whatsapp/") ? "whatsapp" : queryChannel || process.env.REPORT_CHANNEL || process.env.REPORT_DELIVERY_CHANNEL || "email")
    .trim()
    .toLowerCase();
}

function formatWhatsAppReport(lines: string[]) {
  const limit = 1500;
  const findLine = (prefix: string) => lines.find((line) => line.startsWith(prefix));
  const takeSection = (heading: string, count: number) => {
    const index = lines.indexOf(heading);
    if (index === -1) return [];
    return lines
      .slice(index + 1)
      .filter((line) => line.trim().startsWith("- "))
      .slice(0, count);
  };

  const uploadsToday = findLine("Uploads today:");
  const summaryLines = [
    lines[0],
    "",
    findLine("Latest daily production upload:"),
    findLine("Running orders:"),
    findLine("Rows updated today:"),
    findLine("Reduced/corrected quantities today:"),
    uploadsToday,
    uploadsToday === "Uploads today: 0" ? "No files uploaded today." : undefined,
    findLine("Rows missing from latest daily production sheet:"),
    "",
    "Module summary:",
    findLine("- WIP rows uploaded today:"),
    findLine("- Fabric/dyeing rows uploaded today:"),
    findLine("- Sampling styles uploaded today:"),
    "",
    "Top missing styles/orders:",
    ...takeSection("Styles/orders missing from latest daily production sheet:", 3),
    "",
    "Top warnings:",
    ...takeSection("Operational update warnings:", 3),
    "",
    "Top corrections:",
    ...takeSection("Reduced/corrected quantities:", 3),
    "",
    "Open Reports in Rishi Fabrics for the full detailed report."
  ].filter((line): line is string => Boolean(line));

  const text = summaryLines.join("\n");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 90).trimEnd()}\n\nShortened for WhatsApp. Open Reports for details.`;
}

const sendDailyProductionReport = asyncRoute(async (req, res) => {
  const expectedSecret = process.env.REPORT_CRON_SECRET;
  const providedSecret = String(req.headers["x-report-secret"] ?? req.query.secret ?? "");

  if (process.env.NODE_ENV === "production" && !expectedSecret) {
    res.status(500).json({ error: "REPORT_CRON_SECRET is not configured" });
    return;
  }

  if (expectedSecret && providedSecret !== expectedSecret) {
    res.status(401).json({ error: "Invalid report secret" });
    return;
  }

  const factoryId = String(req.query.factoryId ?? req.body?.factoryId ?? "");
  const where = factoryId ? { factoryId } : undefined;
  const today = new Date();
  const { start: since, end: until } = indiaDayRange(today);
  const latestDailyProductionUpload = await prisma.upload.findFirst({
    where: factoryId
      ? { factoryId, sourceType: { startsWith: "DAILY_PRODUCTION" }, status: "APPLIED" }
      : { sourceType: { startsWith: "DAILY_PRODUCTION" }, status: "APPLIED" },
    orderBy: { createdAt: "desc" }
  });
  const latestUploadDayStart = latestDailyProductionUpload ? indiaDayRange(latestDailyProductionUpload.createdAt).start : since;

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
        ? { createdAt: { gte: since, lte: until }, order: { factoryId } }
        : { createdAt: { gte: since, lte: until } },
      include: { order: true },
      orderBy: { createdAt: "desc" },
      take: 100
    }),
    prisma.upload.findMany({
      where: factoryId
        ? { factoryId, createdAt: { gte: since, lte: until } }
        : { createdAt: { gte: since, lte: until } },
      orderBy: { createdAt: "desc" },
      take: 50
    }),
    prisma.fabricDyeingSnapshot.findMany({
      where: factoryId
        ? { factoryId, createdAt: { gte: since, lte: until } }
        : { createdAt: { gte: since, lte: until } },
      orderBy: { createdAt: "desc" },
      take: 100
    }),
    prisma.wipSnapshot.findMany({
      where: factoryId
        ? { factoryId, createdAt: { gte: since, lte: until } }
        : { createdAt: { gte: since, lte: until } },
      orderBy: { createdAt: "desc" },
      take: 100
    }),
    prisma.techPackStyle.findMany({
      where: factoryId
        ? { factoryId, createdAt: { gte: since, lte: until } }
        : { createdAt: { gte: since, lte: until } },
      orderBy: { createdAt: "desc" },
      take: 100
    })
  ]);

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
    ...(uploads.length === 0
      ? ["No files uploaded today."]
      : [
          "Files uploaded today:",
          ...uploads.slice(0, 20).map((upload) => `- ${upload.fileName} (${upload.sourceType}) - ${upload.status}`)
        ]),
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

  const channel = resolveReportChannel(req.query.channel, req.path);

  if (channel === "whatsapp") {
    const whatsappRecipients = resolveMdReportWhatsAppRecipients();
    if (whatsappRecipients.length === 0) {
      res.status(400).json({ error: "MD_REPORT_WHATSAPP_NUMBERS is not configured" });
      return;
    }

    const result = await sendWhatsApp({
      to: whatsappRecipients,
      text: formatWhatsAppReport(reportLines)
    });

    if (!result.ok) {
      res.status(502).json({ error: result.error ?? "WhatsApp report could not be sent", delivered: result.delivered, failed: result.failed });
      return;
    }

    res.json({
      ok: true,
      channel,
      sentTo: whatsappRecipients,
      delivered: result.delivered,
      missingRows: missingRows.length,
      rowsUpdatedToday: updateMovements.length,
      uploadsToday: uploads.length,
      noFilesUploadedToday: uploads.length === 0
    });
    return;
  }

  const recipients = await resolveMdReportRecipients(factoryId || undefined);
  if (recipients.length === 0) {
    res.status(400).json({ error: "No active CEO users found and MD_REPORT_EMAIL/ADMIN_ALERT_EMAIL is not configured" });
    return;
  }

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
    channel,
    sentTo: recipients,
    missingRows: missingRows.length,
    rowsUpdatedToday: updateMovements.length,
    uploadsToday: uploads.length,
    noFilesUploadedToday: uploads.length === 0
  });
});

reportsRouter.get("/daily-production/email/send", sendDailyProductionReport);
reportsRouter.post("/daily-production/email/send", sendDailyProductionReport);
reportsRouter.get("/daily-production/whatsapp/send", sendDailyProductionReport);
reportsRouter.post("/daily-production/whatsapp/send", sendDailyProductionReport);

reportsRouter.use(requirePermission("VIEW_REPORTS"));

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

function indiaDayRange(date: Date) {
  const indiaOffsetMs = 330 * 60 * 1000;
  const shifted = new Date(date.getTime() + indiaOffsetMs);
  shifted.setUTCHours(0, 0, 0, 0);
  const start = new Date(shifted.getTime() - indiaOffsetMs);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

const requiredDailyReportInputs = [
  { key: "dailyProduction", label: "Daily Production", sourcePrefix: "DAILY_PRODUCTION" },
  { key: "wip", label: "WIP", sourcePrefix: "WIP_REPORT" },
  { key: "fabric", label: "Fabric / Dyeing", sourcePrefix: "FABRIC_DYEING" }
];

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function quantityJudgement(input: {
  plannedQuantity: number;
  completedQuantity: number;
  noLatestUpdate?: boolean;
  atRisk?: boolean;
}) {
  const plannedQuantity = Math.max(0, Math.round(Number(input.plannedQuantity || 0)));
  const completedQuantity = Math.max(0, Math.round(Number(input.completedQuantity || 0)));
  const remainingQuantity = Math.max(0, plannedQuantity - completedQuantity);
  const progressPercent = plannedQuantity > 0 ? Math.round((Math.min(completedQuantity, plannedQuantity) / plannedQuantity) * 100) : 0;

  if (plannedQuantity === 0) {
    return {
      plannedQuantity,
      completedQuantity,
      remainingQuantity,
      progressPercent,
      judgement: "NO_PLAN",
      message: "No planned quantity is available for this item."
    };
  }

  if (remainingQuantity === 0) {
    return {
      plannedQuantity,
      completedQuantity,
      remainingQuantity,
      progressPercent,
      judgement: "COMPLETE",
      message: `${completedQuantity} of ${plannedQuantity} completed. No balance remains.`
    };
  }

  if (completedQuantity === 0 || input.noLatestUpdate) {
    return {
      plannedQuantity,
      completedQuantity,
      remainingQuantity,
      progressPercent,
      judgement: "NO_PROGRESS",
      message: `${completedQuantity} of ${plannedQuantity} completed. ${remainingQuantity} still pending and no latest progress is visible.`
    };
  }

  if (input.atRisk || progressPercent < 50) {
    return {
      plannedQuantity,
      completedQuantity,
      remainingQuantity,
      progressPercent,
      judgement: "AT_RISK",
      message: `${completedQuantity} of ${plannedQuantity} completed. ${remainingQuantity} balance needs follow-up.`
    };
  }

  return {
    plannedQuantity,
    completedQuantity,
    remainingQuantity,
    progressPercent,
    judgement: "MOVING_FORWARD",
    message: `${completedQuantity} of ${plannedQuantity} completed. ${remainingQuantity} still pending.`
  };
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

function extractDailyProductionChanges(notes: string | null | undefined) {
  const marker = "Daily production changes:";
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

async function getDailyReportInputStatus(factoryId: string, reportDate: Date) {
  const { start, end } = indiaDayRange(reportDate);
  const uploads = await prisma.upload.findMany({
    where: {
      factoryId,
      status: "APPLIED",
      createdAt: { gte: start, lte: end }
    },
    orderBy: { createdAt: "desc" }
  });

  const inputs = requiredDailyReportInputs.map((input) => {
    const upload = uploads.find((row) => row.sourceType.startsWith(input.sourcePrefix));
    return {
      ...input,
      ready: Boolean(upload),
      upload: upload
        ? {
            id: upload.id,
            fileName: upload.fileName,
            sourceType: upload.sourceType,
            rowsAccepted: upload.rowsAccepted,
            rowsRejected: upload.rowsRejected,
            createdAt: upload.createdAt
          }
        : null
    };
  });

  return {
    reportDate: formatDate(start),
    ready: inputs.every((input) => input.ready),
    inputs,
    missingInputs: inputs.filter((input) => !input.ready).map((input) => input.label),
    uploadIds: inputs.map((input) => input.upload?.id).filter((id): id is string => Boolean(id))
  };
}

function snapshotMetric(snapshot: unknown, path: string, fallback = 0) {
  const value = path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, snapshot);
  return typeof value === "number" ? value : fallback;
}

function dailyReportCsv(report: { reportDate: Date; snapshot: unknown }) {
  const snapshot = report.snapshot as { metrics?: Record<string, unknown>; sections?: Record<string, any> };
  const rows: Record<string, unknown>[] = [
    { section: "Summary", metric: "Running Orders", value: snapshotMetric(snapshot, "metrics.runningOrders") },
    { section: "Summary", metric: "At Risk Orders", value: snapshotMetric(snapshot, "metrics.atRiskOrders") },
    { section: "Summary", metric: "Delayed Orders", value: snapshotMetric(snapshot, "metrics.delayedOrders") },
    { section: "Summary", metric: "Average Order Progress", value: snapshotMetric(snapshot, "metrics.averageOrderProgress") },
    { section: "Summary", metric: "Rejected Rows", value: snapshotMetric(snapshot, "metrics.rejectedRows") }
  ];
  const judgementGroups = snapshot.sections?.departmentJudgements ?? {};
  const dailyProductionChanges = (snapshot.sections?.dailyProductionChanges ?? []) as Record<string, unknown>[];
  for (const row of dailyProductionChanges) {
    rows.push({
      section: "Daily Production Changes",
      metric: row.stageCode ?? "Production movement",
      orderNumber: row.orderNumber,
      buyerName: row.buyerName,
      quantity: row.quantity,
      movementType: row.movementType,
      changes: Array.isArray(row.changes) ? row.changes.join("; ") : "",
      createdAt: row.createdAt
    });
  }
  const judgementRows = [
    ...((judgementGroups.orders?.cutting ?? []) as Record<string, unknown>[]),
    ...((judgementGroups.orders?.stitching ?? []) as Record<string, unknown>[]),
    ...((judgementGroups.fabric ?? []) as Record<string, unknown>[]),
    ...((judgementGroups.sampling ?? []) as Record<string, unknown>[])
  ];

  for (const row of judgementRows) {
    rows.push({
      section: row.department ?? "Judgement",
      metric: row.process ?? "Progress",
      orderNumber: row.orderNumber,
      buyerName: row.buyerName,
      styleName: row.styleName,
      colorName: row.colorName,
      plannedQuantity: row.plannedQuantity,
      completedQuantity: row.completedQuantity,
      remainingQuantity: row.remainingQuantity,
      progressPercent: row.progressPercent,
      judgement: row.judgement,
      message: row.message
    });
  }

  const headers = Array.from(rows.reduce((keys, row) => {
    Object.keys(row).forEach((key) => keys.add(key));
    return keys;
  }, new Set<string>()));
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
}

async function buildReportSummary(factoryId: string, selectedDateInput?: Date) {
  const where = factoryId ? { factoryId } : undefined;
  const selectedDate = selectedDateInput ?? new Date();
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
  const dailyProductionChangeRows = weeklyDailyProductionMovements
    .map((movement) => ({
      id: movement.id,
      orderId: movement.orderId,
      orderNumber: movement.order.orderNumber,
      buyerName: movement.order.buyerName,
      stageCode: movement.toStageCode ?? movement.fromStageCode,
      quantity: movement.quantity,
      movementType: movement.movementType,
      notes: movement.notes,
      createdAt: movement.createdAt,
      changes: extractDailyProductionChanges(movement.notes)
    }))
    .filter((movement) => movement.changes.length > 0)
    .slice(0, 80);
  const orderDepartmentJudgements = allDailyProductionRows
    .map((line) => ({
      id: line.id,
      department: "ORDERS",
      process: "Cutting",
      orderNumber: line.orderNumber,
      buyerName: line.buyerName,
      styleName: line.styleName,
      colorName: line.colorName,
      productionUnitId: line.productionUnitId,
      deliveryDate: line.deliveryDate,
      ...quantityJudgement({
        plannedQuantity: line.orderQuantity,
        completedQuantity: line.cuttingTotalQty,
        noLatestUpdate: line.notReportedInLatestDailyProduction,
        atRisk: line.status === "RUNNING" && line.notReportedInLatestDailyProduction
      })
    }))
    .filter((row) => row.judgement !== "COMPLETE")
    .sort((left, right) => left.progressPercent - right.progressPercent)
    .slice(0, 50);
  const stitchingDepartmentJudgements = allDailyProductionRows
    .map((line) => ({
      id: `${line.id}:stitching`,
      department: "ORDERS",
      process: "Stitching / Line Out",
      orderNumber: line.orderNumber,
      buyerName: line.buyerName,
      styleName: line.styleName,
      colorName: line.colorName,
      productionUnitId: line.productionUnitId,
      deliveryDate: line.deliveryDate,
      ...quantityJudgement({
        plannedQuantity: line.orderQuantity,
        completedQuantity: line.totalLineOutQty,
        noLatestUpdate: line.notReportedInLatestDailyProduction,
        atRisk: line.status === "RUNNING" && line.notReportedInLatestDailyProduction
      })
    }))
    .filter((row) => row.judgement !== "COMPLETE")
    .sort((left, right) => left.progressPercent - right.progressPercent)
    .slice(0, 50);
  const fabricDepartmentJudgements = fabricRows
    .map((row) => ({
      id: row.id,
      department: "FABRIC",
      process: "Dyeing / In-house Receipt",
      buyerName: row.buyerName,
      styleName: row.styleName,
      colorName: row.colorName,
      sourceFileName: row.sourceFileName,
      ...quantityJudgement({
        plannedQuantity: row.fabricSentForDyeingKg,
        completedQuantity: row.inhouseAfterDyeingKg,
        noLatestUpdate: row.createdAt < weekStart,
        atRisk: row.actualShortageFabricBalanceKg > 0
      }),
      shortageKg: row.actualShortageFabricBalanceKg
    }))
    .filter((row) => row.judgement !== "COMPLETE")
    .sort((left, right) => left.progressPercent - right.progressPercent)
    .slice(0, 50);
  const samplingDepartmentJudgements = orders
    .filter((order) => order.samplingApprovals.length > 0)
    .map((order) => {
      const approvedCount = order.samplingApprovals.filter((approval) => approval.status === "APPROVED").length;
      const pendingApprovalLabels = order.samplingApprovals
        .filter((approval) => approval.status !== "APPROVED")
        .map((approval) => approval.label);
      return {
        id: order.id,
        department: "SAMPLING",
        process: "Buyer Approvals",
        orderNumber: order.orderNumber,
        buyerName: order.buyerName,
        styleName: order.productCategory,
        pendingApprovals: pendingApprovalLabels,
        ...quantityJudgement({
          plannedQuantity: order.samplingApprovals.length,
          completedQuantity: approvedCount,
          noLatestUpdate: order.updatedAt < weekStart,
          atRisk: pendingApprovalLabels.length > 0 && order.deliveryDate <= weekEnd
        })
      };
    })
    .filter((row) => row.judgement !== "COMPLETE")
    .sort((left, right) => left.progressPercent - right.progressPercent)
    .slice(0, 50);
  return {
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
        departmentJudgements: {
          cutting: orderDepartmentJudgements,
          stitching: stitchingDepartmentJudgements
        },
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
        pendingRowsDetail: pendingFabricRows.slice(0, 50),
        departmentJudgements: fabricDepartmentJudgements
      },
      uploadHealth: {
        uploadsThisWeek: weeklyUploads.length,
        acceptedRows,
        rejectedRows,
        dailyProductionUpdateAlerts: dailyProductionUpdateRows.length,
        dailyProductionChangeRows: dailyProductionChangeRows.length,
        reducedOrCorrectedQuantities: quantityCorrections.length,
        filesNeedingCorrection: weeklyUploads.filter((upload) => upload.rowsRejected > 0),
        dailyProductionUpdates: dailyProductionUpdateRows.slice(0, 50),
        dailyProductionChanges: dailyProductionChangeRows.slice(0, 50),
        quantityCorrections: quantityCorrections.slice(0, 50),
        missingFromLatestDailyProduction: rowsMissingFromLatestDailyProduction.slice(0, 50)
      },
      productionStatus,
      dailyProduction: allDailyProductionRows.slice(0, 120),
      dailyProductionUpdates: dailyProductionUpdateRows.slice(0, 50),
      dailyProductionChanges: dailyProductionChangeRows.slice(0, 50),
      quantityCorrections: quantityCorrections.slice(0, 50),
      fabricStatus: pendingFabricRows.slice(0, 100),
      wipStatus: weeklyWipRows.slice(0, 100),
      samplingStatus: techPackStyles.slice(0, 100),
      departmentJudgements: {
        orders: {
          cutting: orderDepartmentJudgements,
          stitching: stitchingDepartmentJudgements
        },
        fabric: fabricDepartmentJudgements,
        sampling: samplingDepartmentJudgements
      },
      uploadHealthRows: weeklyUploads.slice(0, 50),
      monthlyHistory: dispatchedOrders
    }
  };
}

reportsRouter.get("/summary", asyncRoute(async (req, res) => {
  const factoryId = String(req.query.factoryId ?? req.authUser?.factoryId ?? "");
  const selectedDate = typeof req.query.week === "string" ? new Date(req.query.week) : new Date();
  res.json(await buildReportSummary(factoryId, selectedDate));
}));

reportsRouter.get("/daily/status", asyncRoute(async (req, res) => {
  const factoryId = String(req.query.factoryId ?? req.authUser?.factoryId ?? "");
  const selectedDate = typeof req.query.date === "string" ? new Date(req.query.date) : new Date();
  res.json(await getDailyReportInputStatus(factoryId, selectedDate));
}));

reportsRouter.get("/daily", asyncRoute(async (req, res) => {
  const factoryId = String(req.query.factoryId ?? req.authUser?.factoryId ?? "");
  const selectedDate = typeof req.query.date === "string" ? new Date(req.query.date) : new Date();
  const [inputStatus, reports] = await Promise.all([
    getDailyReportInputStatus(factoryId, selectedDate),
    prisma.dailyReport.findMany({
      where: factoryId ? { factoryId } : undefined,
      orderBy: { reportDate: "desc" },
      take: 30,
      select: {
        id: true,
        reportDate: true,
        status: true,
        requiredUploadIds: true,
        generatedAt: true,
        generatedBy: true,
        createdAt: true,
        updatedAt: true
      }
    })
  ]);

  res.json({ inputStatus, reports });
}));

reportsRouter.post("/daily/generate", asyncRoute(async (req, res) => {
  const factoryId = String(req.body?.factoryId ?? req.authUser?.factoryId ?? "");
  const selectedDate = req.body?.date ? new Date(String(req.body.date)) : new Date();
  const { start } = indiaDayRange(selectedDate);
  const inputStatus = await getDailyReportInputStatus(factoryId, selectedDate);

  if (!inputStatus.ready) {
    res.status(400).json({
      error: "Daily report is not ready yet. Upload and apply Daily Production, WIP, and Fabric / Dyeing sheets first.",
      inputStatus
    });
    return;
  }

  const snapshot = await buildReportSummary(factoryId, selectedDate);
  const snapshotJson = JSON.parse(JSON.stringify(snapshot));
  const report = await prisma.dailyReport.upsert({
    where: {
      factoryId_reportDate: {
        factoryId,
        reportDate: start
      }
    },
    update: {
      status: "GENERATED",
      requiredUploadIds: inputStatus.uploadIds,
      snapshot: snapshotJson,
      generatedBy: req.authUser?.id,
      generatedAt: new Date()
    },
    create: {
      factoryId,
      reportDate: start,
      status: "GENERATED",
      requiredUploadIds: inputStatus.uploadIds,
      snapshot: snapshotJson,
      generatedBy: req.authUser?.id
    }
  });

  await prisma.event.create({
    data: {
      factoryId,
      type: "REPORT_GENERATED",
      message: `Daily report generated for ${inputStatus.reportDate}.`,
      metadata: { reportId: report.id, reportDate: inputStatus.reportDate, requiredUploadIds: inputStatus.uploadIds },
      createdBy: req.authUser?.id,
      source: "reports"
    }
  });

  res.status(201).json({ report, inputStatus });
}));

reportsRouter.get("/daily/:id/download.csv", asyncRoute(async (req, res) => {
  const factoryId = String(req.query.factoryId ?? req.authUser?.factoryId ?? "");
  const reportId = String(req.params.id);
  const report = await prisma.dailyReport.findFirstOrThrow({
    where: {
      id: reportId,
      ...(factoryId ? { factoryId } : {})
    }
  });

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=\"daily-report-${formatDate(report.reportDate)}.csv\"`);
  res.send(dailyReportCsv(report));
}));

reportsRouter.get("/daily/:id", asyncRoute(async (req, res) => {
  const factoryId = String(req.query.factoryId ?? req.authUser?.factoryId ?? "");
  const reportId = String(req.params.id);
  const report = await prisma.dailyReport.findFirstOrThrow({
    where: {
      id: reportId,
      ...(factoryId ? { factoryId } : {})
    }
  });
  res.json(report);
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
