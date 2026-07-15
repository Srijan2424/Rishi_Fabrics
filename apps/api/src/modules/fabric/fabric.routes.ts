import { Router } from "express";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";
import { requirePermission } from "../../security/rbac.js";

export const fabricRouter = Router();

fabricRouter.get(
  "/snapshots",
  requirePermission("VIEW_ORDER"),
  asyncRoute(async (req, res) => {
    const factoryId = String(req.query.factoryId ?? req.authUser?.factoryId ?? "");
    const rows = await prisma.fabricDyeingSnapshot.findMany({
      where: factoryId ? { factoryId } : undefined,
      orderBy: { createdAt: "desc" },
      take: 500
    });

    // Every row present in the fabric sheet is operationally important.
    // Do not hide rows only because fabric is marked in-house or numerically complete.
    res.json(rows);
  })
);

fabricRouter.delete(
  "/snapshots/:id",
  requirePermission("UPLOAD_ERP_FILE"),
  asyncRoute(async (req, res) => {
    const factoryId = String(req.authUser?.factoryId ?? "");
    const id = String(req.params.id);
    const result = await prisma.fabricDyeingSnapshot.deleteMany({
      where: {
        id,
        ...(factoryId ? { factoryId } : {})
      }
    });

    if (result.count === 0) {
      res.status(404).json({ error: "Fabric row not found" });
      return;
    }

    res.json({ success: true, deletedRows: result.count });
  })
);
