import { Router } from "express";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";
import { requirePermission } from "../../security/rbac.js";

export const fabricRouter = Router();

function isFabricComplete(row: {
  status: string | null;
  fabricSentForDyeingKg: number;
  inhouseAfterDyeingKg: number;
}) {
  const status = String(row.status ?? "").toUpperCase();
  return (
    status.includes("COMPLETE") ||
    status.includes("DONE") ||
    status.includes("RECEIVED") ||
    status.includes("INHOUSE") ||
    status.includes("IN-HOUSE") ||
    (row.fabricSentForDyeingKg > 0 && row.inhouseAfterDyeingKg >= row.fabricSentForDyeingKg)
  );
}

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

    res.json(rows.filter((row) => !isFabricComplete(row)));
  })
);
