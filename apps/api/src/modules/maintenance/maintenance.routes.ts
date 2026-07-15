import { Router } from "express";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";

export const maintenanceRouter = Router();

const defaultRetentionDays = 7;

function retentionDays() {
  const value = Number(process.env.DATA_RETENTION_DAYS ?? defaultRetentionDays);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : defaultRetentionDays;
}

function cleanupCutoff() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays());
  return cutoff;
}

function validateCleanupSecret(providedSecret: string) {
  const expectedSecret = process.env.CLEANUP_CRON_SECRET || process.env.REPORT_CRON_SECRET;
  if (process.env.NODE_ENV === "production" && !expectedSecret) {
    return { ok: false, status: 500, error: "CLEANUP_CRON_SECRET or REPORT_CRON_SECRET is not configured" };
  }
  if (expectedSecret && providedSecret !== expectedSecret) {
    return { ok: false, status: 401, error: "Invalid cleanup secret" };
  }
  return { ok: true };
}

maintenanceRouter.post("/cleanup", asyncRoute(async (req, res) => {
  const providedSecret = String(req.headers["x-cleanup-secret"] ?? req.query.secret ?? "");
  const validation = validateCleanupSecret(providedSecret);

  if (!validation.ok) {
    res.status(validation.status ?? 500).json({ error: validation.error ?? "Cleanup validation failed" });
    return;
  }

  const cutoff = cleanupCutoff();

  const [
    expiredSessions,
    expiredPasswordResetTokens,
    oldUploads,
    oldFabricSnapshots,
    oldWipSnapshots,
    oldEvents,
    oldWorkLogs,
    oldResolvedSystemErrors,
    oldClosedIssues
  ] = await prisma.$transaction([
    prisma.authSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { createdAt: { lt: cutoff } }
        ]
      }
    }),
    prisma.passwordResetToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { createdAt: { lt: cutoff } }
        ]
      }
    }),
    prisma.upload.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.fabricDyeingSnapshot.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.wipSnapshot.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.event.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.workLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.systemError.deleteMany({
      where: {
        createdAt: { lt: cutoff },
        resolvedAt: { not: null }
      }
    }),
    prisma.issue.deleteMany({
      where: {
        createdAt: { lt: cutoff },
        status: { in: ["RESOLVED", "CLOSED"] }
      }
    })
  ]);

  res.json({
    ok: true,
    retentionDays: retentionDays(),
    cutoff: cutoff.toISOString(),
    deleted: {
      expiredSessions: expiredSessions.count,
      expiredPasswordResetTokens: expiredPasswordResetTokens.count,
      oldUploads: oldUploads.count,
      oldFabricSnapshots: oldFabricSnapshots.count,
      oldWipSnapshots: oldWipSnapshots.count,
      oldEvents: oldEvents.count,
      oldWorkLogs: oldWorkLogs.count,
      oldResolvedSystemErrors: oldResolvedSystemErrors.count,
      oldClosedIssues: oldClosedIssues.count
    }
  });
}));
