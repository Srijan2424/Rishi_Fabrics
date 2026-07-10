import { Router } from "express";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";
import { requirePermission } from "../../security/rbac.js";

export const historyRouter = Router();

const samplingStageCodes = new Set([
  "INQUIRY",
  "DEVELOPMENT",
  "SAMPLE_CREATION",
  "SAMPLE_APPROVAL",
  "ORDER_CONFIRMATION",
  "LAB_DIP_APPROVAL",
  "FOB_APPROVAL",
  "PO_CONFIRMATION"
]);

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date: Date) {
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function groupByMonth<T extends { completedAt: string }>(rows: T[]) {
  const groups = new Map<string, { month: string; label: string; rows: T[] }>();

  for (const row of rows) {
    const date = new Date(row.completedAt);
    const key = monthKey(date);
    if (!groups.has(key)) groups.set(key, { month: key, label: monthLabel(date), rows: [] });
    groups.get(key)!.rows.push(row);
  }

  return [...groups.values()].sort((left, right) => right.month.localeCompare(left.month));
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

historyRouter.get(
  "/sampling",
  requirePermission("VIEW_SAMPLING"),
  asyncRoute(async (req, res) => {
    const factoryId = String(req.query.factoryId ?? req.authUser?.factoryId ?? "");
    const orders = await prisma.order.findMany({
      where: factoryId ? { factoryId } : undefined,
      include: {
        samplingApprovals: true
      },
      orderBy: { updatedAt: "desc" },
      take: 500
    });

    const rows = orders
      .filter((order) => order.samplingApprovals.length > 0)
      .filter((order) => order.samplingApprovals.every((approval) => approval.status === "APPROVED"))
      .map((order) => {
        const completedAt = order.samplingApprovals
          .map((approval) => approval.approvedAt ?? approval.updatedAt)
          .sort((left, right) => right.getTime() - left.getTime())[0] ?? order.updatedAt;

        return {
          id: order.id,
          orderNumber: order.orderNumber,
          buyerName: order.buyerName,
          productCategory: order.productCategory,
          orderQuantity: order.orderQuantity,
          status: order.currentStageCode && samplingStageCodes.has(order.currentStageCode) ? "SAMPLING_APPROVED" : "MOVED_TO_PRODUCTION",
          completedAt: completedAt.toISOString()
        };
      });

    res.json({ groups: groupByMonth(rows) });
  })
);

historyRouter.get(
  "/fabric",
  requirePermission("VIEW_ORDER"),
  asyncRoute(async (req, res) => {
    const factoryId = String(req.query.factoryId ?? req.authUser?.factoryId ?? "");
    const snapshots = await prisma.fabricDyeingSnapshot.findMany({
      where: factoryId ? { factoryId } : undefined,
      orderBy: { createdAt: "desc" },
      take: 1000
    });

    const rows = snapshots
      .filter(isFabricComplete)
      .map((row) => ({
        id: row.id,
        buyerName: row.buyerName,
        styleName: row.styleName,
        colorName: row.colorName,
        orderQuantity: row.orderQuantity,
        status: row.status ?? "COMPLETED",
        dyeingParty: row.dyeingParty,
        fabricSentForDyeingKg: row.fabricSentForDyeingKg,
        inhouseAfterDyeingKg: row.inhouseAfterDyeingKg,
        completedAt: (row.snapshotDate ?? row.createdAt).toISOString()
      }));

    res.json({ groups: groupByMonth(rows) });
  })
);

historyRouter.get(
  "/production",
  requirePermission("VIEW_ORDER"),
  asyncRoute(async (req, res) => {
    const factoryId = String(req.query.factoryId ?? req.authUser?.factoryId ?? "");
    const orders = await prisma.order.findMany({
      where: factoryId ? { factoryId } : undefined,
      include: {
        orderLines: true,
        materialMovements: { orderBy: { createdAt: "desc" }, take: 20 }
      },
      orderBy: { updatedAt: "desc" },
      take: 500
    });

    const rows = orders
      .filter((order) => (
        order.status === "DISPATCHED" ||
        order.currentStageCode === "DISPATCH" ||
        order.orderLines.some((line) => String(line.productionStatus ?? "").toUpperCase().includes("DISPATCH"))
      ))
      .map((order) => {
        const dispatchMovement = order.materialMovements.find((movement) => movement.movementType === "DISPATCH");
        return {
          id: order.id,
          orderNumber: order.orderNumber,
          buyerName: order.buyerName,
          productCategory: order.productCategory,
          orderQuantity: order.orderQuantity,
          status: order.status,
          completedAt: (dispatchMovement?.createdAt ?? order.updatedAt).toISOString()
        };
      });

    res.json({ groups: groupByMonth(rows) });
  })
);
