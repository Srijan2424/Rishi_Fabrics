import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";
import { requirePermission } from "../../security/rbac.js";
import { sendEmail } from "../../services/email.js";
import { recordWorkLog } from "../work-logs/work-log.service.js";

export const issuesRouter = Router();

const issueSchema = z.object({
  title: z.string().min(2).max(180),
  description: z.string().max(4000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).default("OPEN"),
  module: z.enum(["SAMPLING", "ORDERS", "FABRIC", "IMPORTS", "REPORTS", "ISSUES", "SYSTEM"]).default("SYSTEM"),
  linkedType: z.string().max(80).optional(),
  linkedId: z.string().max(120).optional(),
  assignedToId: z.string().optional()
});
const issuePatchSchema = issueSchema.partial();
const commentSchema = z.object({ body: z.string().min(1).max(3000) });

async function notifyAdminIssueCreated(input: { factoryId: string; issue: { id: string; title: string; module: string; priority: string; description: string | null }; createdById?: string }) {
  const [creator, admin] = await Promise.all([
    input.createdById ? prisma.user.findUnique({ where: { id: input.createdById }, select: { name: true, email: true } }) : null,
    prisma.user.findFirst({ where: { factoryId: input.factoryId, role: "ADMIN", status: "ACTIVE", isActive: true }, select: { email: true } })
  ]);
  const to = process.env.ADMIN_ALERT_EMAIL || admin?.email;
  const subject = "Rishi Fabrics issue reported";
  const issueUrl = process.env.WEB_ORIGIN ? `${process.env.WEB_ORIGIN.replace(/\/$/, "")}/monitoring?issue=${encodeURIComponent(input.issue.id)}` : "";
  const body = [
    "A new issue ticket was reported.",
    "",
    "Issue: " + input.issue.title,
    "Module: " + input.issue.module,
    "Priority: " + input.issue.priority,
    "Reported by: " + (creator ? creator.name + " <" + creator.email + ">" : "Unknown user"),
    "Ticket ID: " + input.issue.id,
    issueUrl ? "Open in Monitoring: " + issueUrl : "",
    "",
    input.issue.description || "No description provided."
  ].filter(Boolean).join("\n");

  if (to) {
    const result = await sendEmail({ to, subject, text: body });
    if (!result.ok) {
      console.info(`[admin-email-alert] Email not sent for ticket ${input.issue.id}: ${result.error ?? "unknown error"}`);
    }
  } else {
    console.info("[admin-email-alert] ADMIN_ALERT_EMAIL is not configured. Ticket " + input.issue.id + " was still saved.");
  }
}

issuesRouter.get("/", requirePermission("MANAGE_ISSUES"), asyncRoute(async (req, res) => {
  const factoryId = String(req.query.factoryId ?? req.authUser?.factoryId ?? "");
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const issues = await prisma.issue.findMany({
    where: { ...(factoryId ? { factoryId } : {}), ...(status ? { status: status as any } : {}) },
    include: { assignedTo: { select: { id: true, name: true, email: true } }, createdBy: { select: { id: true, name: true, email: true } }, comments: { include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 3 } },
    orderBy: { updatedAt: "desc" },
    take: 200
  });
  res.json(issues);
}));

issuesRouter.post("/", asyncRoute(async (req, res) => {
  const input = issueSchema.parse(req.body);
  const factoryId = req.authUser?.factoryId;
  if (!factoryId) {
    res.status(400).json({ error: "Factory context is required" });
    return;
  }
  const issue = await prisma.issue.create({ data: { ...input, status: "OPEN", factoryId, createdById: req.authUser?.id } });
  await prisma.event.create({ data: { factoryId, type: "ISSUE_CREATED", message: "Issue created: " + issue.title, metadata: { issueId: issue.id, priority: issue.priority, module: issue.module, linkedType: issue.linkedType, linkedId: issue.linkedId }, createdBy: req.authUser?.id, source: "issues" } });
  await recordWorkLog({ factoryId, userId: req.authUser?.id, module: "ISSUES", action: "Issue created", itemType: "issue", itemId: issue.id, itemLabel: issue.title, metadata: { priority: issue.priority, module: issue.module } });
  await notifyAdminIssueCreated({ factoryId, issue, createdById: req.authUser?.id });
  res.status(201).json(issue);
}));

issuesRouter.patch("/:id", requirePermission("MANAGE_ISSUES"), asyncRoute(async (req, res) => {
  const input = issuePatchSchema.parse(req.body);
  const issue = await prisma.issue.update({ where: { id: String(req.params.id) }, data: { ...input, resolvedAt: input.status === "RESOLVED" ? new Date() : undefined, closedAt: input.status === "CLOSED" ? new Date() : undefined } });
  if (req.authUser?.factoryId) {
    await prisma.event.create({ data: { factoryId: req.authUser.factoryId, type: "ISSUE_UPDATED", message: "Issue updated: " + issue.title, metadata: { issueId: issue.id, status: issue.status, priority: issue.priority }, createdBy: req.authUser.id, source: "issues" } });
    await recordWorkLog({ factoryId: req.authUser.factoryId, userId: req.authUser.id, module: "ISSUES", action: "Issue updated", itemType: "issue", itemId: issue.id, itemLabel: issue.title, notes: issue.status, metadata: { status: issue.status, priority: issue.priority } });
  }
  res.json(issue);
}));

issuesRouter.post("/:id/comments", requirePermission("MANAGE_ISSUES"), asyncRoute(async (req, res) => {
  const input = commentSchema.parse(req.body);
  const comment = await prisma.issueComment.create({ data: { issueId: String(req.params.id), userId: req.authUser?.id, body: input.body } });
  res.status(201).json(comment);
}));
