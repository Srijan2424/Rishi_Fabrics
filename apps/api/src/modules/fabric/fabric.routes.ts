import { Router } from "express";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";
import { requirePermission } from "../../security/rbac.js";

export const fabricRouter = Router();

async function removeFabricSummaryRows(factoryId: string) {
  const where = {
    ...(factoryId ? { factoryId } : {}),
    OR: [
      { buyerName: { contains: "GRAND TOTAL" } },
      { styleName: { contains: "GRAND TOTAL" } },
      { colorName: { contains: "GRAND TOTAL" } },
      { fabricDescription: { contains: "GRAND TOTAL" } },
      { status: { contains: "GRAND TOTAL" } },
      { dyeingParty: { contains: "GRAND TOTAL" } }
    ]
  };

  await prisma.fabricDyeingSnapshot.deleteMany({ where });
}

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
    await removeFabricSummaryRows(factoryId);

    const rows = await prisma.fabricDyeingSnapshot.findMany({
      where: factoryId ? { factoryId } : undefined,
      orderBy: { createdAt: "desc" },
      take: 1000
    });

    res.json(rows.filter((row) => !isFabricComplete(row)).slice(0, 500));
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
