import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";
import { requirePermission } from "../../security/rbac.js";

export const monitoringRouter = Router();

const clientErrorSchema = z.object({
  message: z.string().min(1).max(1000),
  stack: z.string().max(8000).optional(),
  route: z.string().max(500).optional(),
  source: z.string().max(120).default("web-client"),
  metadata: z.record(z.unknown()).default({})
});

function severityFromPriority(priority: string) {
  if (priority === "CRITICAL") return "CRITICAL";
  if (priority === "HIGH") return "HIGH";
  return "MEDIUM";
}

function failedUploadAction(upload: { rowsRejected: number }) {
  return upload.rowsRejected > 0
    ? "Open the upload detail, review rejected rows, correct the source file, and upload again."
    : "No action required.";
}

monitoringRouter.post("/client-errors", asyncRoute(async (req, res) => {
  const input = clientErrorSchema.parse(req.body);
  const factoryId = req.authUser?.factoryId;
  if (!factoryId) {
    res.status(400).json({ error: "Factory context is required" });
    return;
  }
  const error = await prisma.systemError.create({
    data: { factoryId, source: input.source, message: input.message, stack: input.stack, route: input.route, userId: req.authUser?.id, metadata: input.metadata as any }
  });
  await prisma.event.create({
    data: { factoryId, type: "SYSTEM_ERROR_CAPTURED", message: input.message, metadata: { source: input.source, route: input.route }, createdBy: req.authUser?.id, source: "monitoring" }
  });
  res.status(201).json(error);
}));

monitoringRouter.get("/summary", requirePermission("VIEW_MONITORING"), asyncRoute(async (req, res) => {
  const factoryId = String(req.query.factoryId ?? req.authUser?.factoryId ?? "");
  const where = factoryId ? { factoryId } : undefined;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [recentErrors, failedUploads, openIssues, recentEvents] = await Promise.all([
    prisma.systemError.findMany({ where: where ? { ...where, resolvedAt: null } : { resolvedAt: null }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.upload.findMany({ where: factoryId ? { factoryId, rowsRejected: { gt: 0 } } : { rowsRejected: { gt: 0 } }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.issue.findMany({ where: where ? { ...where, status: { in: ["OPEN", "IN_PROGRESS"] } } : { status: { in: ["OPEN", "IN_PROGRESS"] } }, include: { assignedTo: { select: { name: true, email: true } }, createdBy: { select: { name: true, email: true } } }, orderBy: [{ priority: "desc" }, { createdAt: "desc" }], take: 50 }),
    prisma.event.findMany({ where: where ? { ...where, createdAt: { gte: since } } : { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 80 })
  ]);

  const diagnostics = [
    ...recentErrors.map((error) => ({
      id: error.id,
      severity: error.severity || "ERROR",
      status: "OPEN",
      where: error.route || error.source || "Website",
      what: error.message,
      how: "Check the route/module shown here, reproduce the action, and review the captured stack trace in Monitoring.",
      source: error.source,
      createdAt: error.createdAt
    })),
    ...failedUploads.map((upload) => ({
      id: upload.id,
      severity: upload.rowsRejected > 10 ? "HIGH" : "MEDIUM",
      status: "OPEN",
      where: "Imports / " + upload.sourceType,
      what: upload.rowsRejected + " row(s) rejected in " + upload.fileName + ".",
      how: failedUploadAction(upload),
      source: "upload",
      createdAt: upload.createdAt
    })),
    ...openIssues.map((issue) => ({
      id: issue.id,
      severity: severityFromPriority(issue.priority),
      status: issue.status,
      where: issue.linkedType ? issue.module + " / " + issue.linkedType : issue.module,
      what: issue.title,
      how: issue.description || "Assign an owner, reproduce the issue, and update the status after the fix is verified.",
      source: "issue",
      createdAt: issue.createdAt
    }))
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({
    health: {
      ok: diagnostics.length === 0,
      checkedAt: new Date().toISOString(),
      api: "ONLINE",
      database: "ONLINE",
      sentryConfigured: Boolean(process.env.SENTRY_DSN)
    },
    metrics: {
      activeProblems: diagnostics.length,
      unresolvedErrors: recentErrors.length,
      failedUploads: failedUploads.length,
      openIssues: openIssues.length,
      recentSystemEvents: recentEvents.length
    },
    diagnostics,
    recentErrors,
    failedUploads,
    openIssues,
    recentEvents
  });
}));
