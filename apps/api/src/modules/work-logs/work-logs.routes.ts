import { Router } from "express";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";
import { requirePermission } from "../../security/rbac.js";

export const workLogsRouter = Router();

workLogsRouter.get("/", requirePermission("VIEW_WORK_LOGS"), asyncRoute(async (req, res) => {
  const factoryId = String(req.query.factoryId ?? req.authUser?.factoryId ?? "");
  const rows = await prisma.workLog.findMany({
    where: factoryId ? { factoryId } : undefined,
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
    orderBy: { createdAt: "desc" },
    take: 500
  });
  res.json(rows);
}));
