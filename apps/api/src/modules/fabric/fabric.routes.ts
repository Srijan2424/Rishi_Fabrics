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

function normalizeGroupValue(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function groupFabricRows(rows: any[]) {
  const grouped = new Map<string, any>();

  for (const row of rows) {
    const key = [
      normalizeGroupValue(row.buyerName),
      normalizeGroupValue(row.styleName),
      normalizeGroupValue(row.fabricDescription),
      normalizeGroupValue(row.colorName)
    ].join("|");
    const current = grouped.get(key);

    if (!current) {
      grouped.set(key, {
        ...row,
        id: row.id,
        sourceIds: [row.id],
        sourceRowCount: 1,
        sourceFileNames: [row.sourceFileName],
        dyeingParties: row.dyeingParty ? [row.dyeingParty] : [],
        statuses: row.status ? [row.status] : []
      });
      continue;
    }

    current.id = `${current.id},${row.id}`;
    current.sourceIds.push(row.id);
    current.sourceRowCount += 1;
    current.sourceFileNames = Array.from(new Set([...current.sourceFileNames, row.sourceFileName]));
    current.dyeingParties = Array.from(new Set([...current.dyeingParties, row.dyeingParty].filter(Boolean)));
    current.statuses = Array.from(new Set([...current.statuses, row.status].filter(Boolean)));
    current.sourceFileName = current.sourceFileNames.join(", ");
    current.dyeingParty = current.dyeingParties.join(", ") || null;
    current.status = current.statuses.join(", ") || null;
    current.rowNumber = Math.min(current.rowNumber, row.rowNumber);
    current.orderQuantity += row.orderQuantity;
    current.actualCutQuantity += row.actualCutQuantity;
    current.stitchOutQuantity += row.stitchOutQuantity;
    current.gsm = current.gsm || row.gsm;
    current.bodyAverage = current.bodyAverage || row.bodyAverage;
    current.greigeBookingKg += row.greigeBookingKg;
    current.pendingExtraFabricForDyeingKg += row.pendingExtraFabricForDyeingKg;
    current.fabricSentForDyeingKg += row.fabricSentForDyeingKg;
    current.actualShortageFabricBalanceKg += row.actualShortageFabricBalanceKg;
    current.inhouseAfterDyeingKg += row.inhouseAfterDyeingKg;
    current.shortagePercent = current.greigeBookingKg > 0
      ? Math.round((current.actualShortageFabricBalanceKg / current.greigeBookingKg) * 10000) / 100
      : current.shortagePercent + row.shortagePercent;
    current.createdAt = current.createdAt > row.createdAt ? current.createdAt : row.createdAt;
    current.updatedAt = current.updatedAt > row.updatedAt ? current.updatedAt : row.updatedAt;
  }

  return Array.from(grouped.values());
}

fabricRouter.get(
  "/snapshots",
  requirePermission("VIEW_ORDER"),
  asyncRoute(async (req, res) => {
    const factoryId = String(req.query.factoryId ?? req.authUser?.factoryId ?? "");
    await removeFabricSummaryRows(factoryId);

    const latestFabricUpload = await prisma.upload.findFirst({
      where: {
        ...(factoryId ? { factoryId } : {}),
        sourceType: { startsWith: "FABRIC_DYEING" },
        status: "APPLIED"
      },
      orderBy: { createdAt: "desc" }
    });

    const rows = await prisma.fabricDyeingSnapshot.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(latestFabricUpload ? { uploadId: latestFabricUpload.id } : {})
      },
      orderBy: { createdAt: "desc" },
      take: 1000
    });

    res.json(groupFabricRows(rows.filter((row) => !isFabricComplete(row))).slice(0, 500));
  })
);

fabricRouter.delete(
  "/snapshots/:id",
  requirePermission("UPLOAD_ERP_FILE"),
  asyncRoute(async (req, res) => {
    const factoryId = String(req.authUser?.factoryId ?? "");
    const ids = String(req.params.id)
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const result = await prisma.fabricDyeingSnapshot.deleteMany({
      where: {
        id: { in: ids },
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
