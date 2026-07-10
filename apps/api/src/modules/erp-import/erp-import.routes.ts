import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { ErpImportService, importSourceConfigs } from "../../core/erp-import/erp-import.service.js";
import { extractWorkbookImport } from "../../core/erp-import/workbook-extractor.js";
import { asyncRoute } from "../../http.js";
import { prisma } from "../../db.js";
import { requirePermission } from "../../security/rbac.js";
import { recordWorkLog } from "../work-logs/work-log.service.js";

export const erpImportRouter = Router();
const erpImport = new ErpImportService();
const workbookUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const previewSchema = z.object({
  factoryId: z.string(),
  fileName: z.string().min(1),
  sourceType: z.enum(["CSV", "EXCEL", "PDF", "IMAGE", "MANUAL"]).default("CSV"),
  importText: z.string().optional(),
  csvText: z.string().optional()
}).refine((input) => Boolean(input.importText ?? input.csvText), {
  message: "importText is required"
});

const workbookPreviewSchema = z.object({
  factoryId: z.string(),
  importKind: z.enum(["AUTO", "DAILY_PRODUCTION", "WIP", "FABRIC_DYEING"]).default("AUTO")
});

const applySchema = z.object({
  uploadId: z.string(),
  factoryId: z.string(),
  acceptedRows: z.array(z.object({
    rowNumber: z.number().int().positive(),
    orderNumber: z.string().min(1),
    buyerName: z.string().min(1),
    productCategory: z.string().min(1),
    orderQuantity: z.number().int().positive(),
    deliveryDate: z.string().datetime(),
    workflowTemplateId: z.string()
  }))
});

const techPackApplySchema = z.object({
  uploadId: z.string(),
  factoryId: z.string(),
  acceptedRows: z.array(z.object({
    rowNumber: z.number().int().positive(),
    orderNumber: z.string().min(1),
    checkpointCode: z.string().min(1),
    status: z.enum(["PENDING", "SUBMITTED", "APPROVED", "REVISION_REQUIRED"]),
    comments: z.string().optional(),
    evidence: z.string().optional(),
    submittedAt: z.string().datetime().optional(),
    approvedAt: z.string().datetime().optional()
  }))
});

const stageMappingSchema = z.object({
  factoryId: z.string(),
  importType: z.string().min(1).default("DAILY_PRODUCTION"),
  sourceColumn: z.string().min(1),
  targetStageKey: z.string().min(1),
  quantityType: z.string().min(1),
  applyMode: z.enum(["snapshot", "incremental"]).default("snapshot"),
  isActive: z.boolean().default(true)
});

const stageMappingUpdateSchema = stageMappingSchema.partial().extend({
  factoryId: z.string()
});

const dailyProductionApplySchema = z.object({
  uploadId: z.string(),
  factoryId: z.string(),
  acceptedRows: z.array(z.object({
    rowNumber: z.number().int().positive(),
    orderNumber: z.string().min(1),
    buyerName: z.string().min(1),
    styleName: z.string().min(1),
    colorName: z.string().min(1),
    description: z.string().optional(),
    orderQuantity: z.number().int().positive(),
    stageCode: z.string().min(1),
    completedQuantity: z.number().int().nonnegative(),
    cuttingTotalQuantity: z.number().int().nonnegative(),
    cuttingToLineBalanceQuantity: z.number().int(),
    lineLoadingQuantity: z.number().int().nonnegative(),
    todayLineOutQuantity: z.number().int().nonnegative(),
    totalLineOutQuantity: z.number().int().nonnegative(),
    lineInBalanceQuantity: z.number().int().nonnegative(),
    rejectedQuantity: z.number().int().nonnegative().default(0),
    reworkQuantity: z.number().int().nonnegative().default(0),
    productionStatus: z.string().optional(),
    rowColorHex: z.string().optional(),
    productionUnitId: z.string().optional(),
    productionUnitCode: z.string().optional(),
    productionUnitName: z.string().optional(),
    deliveryDate: z.string().min(1).optional(),
    orderExists: z.boolean().optional(),
    requiresDeliveryDate: z.boolean().optional(),
    orderAction: z.enum(["CREATE", "UPDATE"]).optional(),
    updateDate: z.string().datetime(),
    notes: z.string().optional()
  }))
});

const extractedWorkbookApplySchema = z.object({
  factoryId: z.string(),
  fileName: z.string().min(1),
  workbookKind: z.enum(["WIP", "FABRIC_DYEING"]),
  acceptedRows: z.array(z.object({
    rowNumber: z.number().int().positive(),
    values: z.record(z.string())
  }))
});

function toInt(value: string | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function toFloat(value: string | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}


erpImportRouter.get(
  "/stage-mappings",
  requirePermission("UPLOAD_ERP_FILE"),
  asyncRoute(async (req, res) => {
    const factoryId = String(req.query.factoryId ?? req.authUser?.factoryId ?? "");
    const importType = String(req.query.importType ?? "DAILY_PRODUCTION");

    const mappings = await prisma.importStageMapping.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        importType
      },
      orderBy: [
        { isActive: "desc" },
        { sourceColumn: "asc" }
      ]
    });

    res.json(mappings);
  })
);

erpImportRouter.post(
  "/stage-mappings",
  requirePermission("MANAGE_WORKFLOW"),
  asyncRoute(async (req, res) => {
    const input = stageMappingSchema.parse(req.body);
    const mapping = await prisma.importStageMapping.upsert({
      where: {
        factoryId_importType_sourceColumn: {
          factoryId: input.factoryId,
          importType: input.importType,
          sourceColumn: input.sourceColumn
        }
      },
      update: {
        targetStageKey: input.targetStageKey,
        quantityType: input.quantityType,
        applyMode: input.applyMode,
        isActive: input.isActive
      },
      create: input
    });

    res.status(201).json(mapping);
  })
);

erpImportRouter.patch(
  "/stage-mappings/:id",
  requirePermission("MANAGE_WORKFLOW"),
  asyncRoute(async (req, res) => {
    const input = stageMappingUpdateSchema.parse(req.body);
    const mapping = await prisma.importStageMapping.findUnique({
      where: { id: String(req.params.id) }
    });

    if (!mapping || mapping.factoryId !== input.factoryId) {
      res.status(404).json({ error: "Stage mapping not found" });
      return;
    }

    const updated = await prisma.importStageMapping.update({
      where: { id: mapping.id },
      data: {
        importType: input.importType,
        sourceColumn: input.sourceColumn,
        targetStageKey: input.targetStageKey,
        quantityType: input.quantityType,
        applyMode: input.applyMode,
        isActive: input.isActive
      }
    });

    res.json(updated);
  })
);

erpImportRouter.get(
  "/config",
  requirePermission("UPLOAD_ERP_FILE"),
  asyncRoute(async (_req, res) => {
    res.json({
      sources: importSourceConfigs,
      requiredHeaders: [
        "orderNumber",
        "buyerName",
        "productCategory",
        "orderQuantity",
        "deliveryDate",
        "workflowTemplateId"
      ],
      importTemplates: {
        order: [
          "orderNumber",
          "buyerName",
          "productCategory",
          "orderQuantity",
          "deliveryDate",
          "workflowTemplateId"
        ],
        techPack: [
          "orderNumber",
          "checkpointCode",
          "status",
          "comments",
          "evidence",
          "submittedAt",
          "approvedAt"
        ],
        dailyProduction: [
          "BUYER",
          "STYLE",
          "COLOUR",
          "DESC.",
          "ORDER QTY.",
          "CUTTING TOTAL QTY",
          "LINE LOADING",
          "TODAY LINE OUT",
          "TOTAL LINE OUT",
          " LINE IN BAL",
          "PRODUCTION STATUS",
          "rowColorHex",
          "updateDate",
          "notes"
        ]
      }
    });
  })
);


erpImportRouter.post(
  "/preview-workbook",
  requirePermission("UPLOAD_ERP_FILE"),
  workbookUpload.single("file"),
  asyncRoute(async (req, res) => {
    const input = workbookPreviewSchema.parse(req.body);

    if (!req.file) {
      res.status(400).json({ error: "Excel file is required." });
      return;
    }

    if (!req.file.originalname.toLowerCase().endsWith(".xlsx")) {
      res.status(400).json({ error: "Only .xlsx workbooks are supported for direct Excel extraction." });
      return;
    }

    const extraction = await extractWorkbookImport(req.file.buffer);

    if (input.importKind !== "AUTO" && extraction.workbookKind !== input.importKind) {
      res.status(400).json({
        error: `Workbook type mismatch. Expected ${input.importKind}, detected ${extraction.workbookKind}.`,
        workbookExtraction: extraction
      });
      return;
    }

    if (extraction.workbookKind === "DAILY_PRODUCTION") {
      const preview = await erpImport.previewDailyProductionImport({
        factoryId: input.factoryId,
        fileName: req.file.originalname,
        sourceType: "EXCEL",
        importText: extraction.extractedText ?? "",
        createdBy: req.authUser?.id
      });

      res.status(201).json({
        ...preview,
        workbookExtraction: {
          workbookKind: extraction.workbookKind,
          sheetName: extraction.sheetName,
          updateDate: extraction.updateDate,
          rowsExtracted: extraction.acceptedRows.length,
          rowsRejectedDuringExtraction: extraction.rejectedRows.length,
          sampleRows: extraction.acceptedRows.slice(0, 5).map((row) => ({
            rowNumber: row.rowNumber,
            ...row.values
          })),
          warnings: extraction.warnings
        }
      });
      return;
    }

    res.status(200).json({
      status: extraction.rejectedRows.length > 0 ? "PREVIEW_HAS_ERRORS" : "EXTRACTED_ONLY",
      message: `${extraction.workbookKind} workbook extracted. Save it to its separate module when the preview looks correct.`,
      acceptedRows: extraction.acceptedRows.map((row) => ({
        rowNumber: row.rowNumber,
        values: row.values
      })),
      rejectedRows: extraction.rejectedRows,
      workbookExtraction: extraction
    });
  })
);

erpImportRouter.post(
  "/apply-extracted-workbook",
  requirePermission("APPROVE_IMPORT"),
  asyncRoute(async (req, res) => {
    const input = extractedWorkbookApplySchema.parse(req.body);
    const upload = await prisma.upload.create({
      data: {
        factoryId: input.factoryId,
        fileName: input.fileName,
        sourceType: input.workbookKind,
        status: "APPLIED",
        rowsReceived: input.acceptedRows.length,
        rowsAccepted: input.acceptedRows.length,
        rowsRejected: 0,
        errors: []
      }
    });

    if (input.workbookKind === "WIP") {
      await prisma.wipSnapshot.createMany({
        data: input.acceptedRows.map((row) => ({
          factoryId: input.factoryId,
          uploadId: upload.id,
          sourceFileName: input.fileName,
          rowNumber: row.rowNumber,
          unitCode: row.values.unitCode ?? "",
          unitName: row.values.unitName ?? "",
          styleName: row.values.styleName ?? "",
          colorName: row.values.colorName || null,
          quantity: toInt(row.values.quantity),
          comments: row.values.comments || null
        }))
      });
    } else {
      await prisma.fabricDyeingSnapshot.createMany({
        data: input.acceptedRows.map((row) => ({
          factoryId: input.factoryId,
          uploadId: upload.id,
          sourceFileName: input.fileName,
          rowNumber: row.rowNumber,
          buyerName: row.values.buyerName ?? "",
          styleName: row.values.styleName ?? "",
          colorName: row.values.colorName ?? "",
          fabricDescription: row.values.fabricDescription || null,
          orderQuantity: toInt(row.values.orderQuantity),
          actualCutQuantity: toInt(row.values.actualCutQuantity),
          stitchOutQuantity: toInt(row.values.stitchOutQuantity),
          gsm: toFloat(row.values.gsm),
          bodyAverage: toFloat(row.values.bodyAverage),
          greigeBookingKg: toFloat(row.values.greigeBookingKg),
          pendingExtraFabricForDyeingKg: toFloat(row.values.pendingExtraFabricForDyeingKg),
          fabricSentForDyeingKg: toFloat(row.values.fabricSentForDyeingKg),
          lotNumber: row.values.lotNumber || null,
          actualShortageFabricBalanceKg: toFloat(row.values.actualShortageFabricBalanceKg),
          inhouseAfterDyeingKg: toFloat(row.values.inhouseAfterDyeingKg),
          shortagePercent: toFloat(row.values.shortagePercent),
          status: row.values.status || null,
          dyeingParty: row.values.dyeingParty || null,
          snapshotDate: row.values.updateDate ? new Date(row.values.updateDate) : null
        }))
      });
    }

    await recordWorkLog({ factoryId: input.factoryId, userId: req.authUser?.id, module: input.workbookKind === "WIP" ? "IMPORTS" : "FABRIC", action: input.workbookKind + " workbook applied", itemType: "upload", itemId: upload.id, itemLabel: input.fileName, metadata: { rowsAccepted: input.acceptedRows.length } });

    res.status(201).json({
      success: true,
      uploadId: upload.id,
      savedRows: input.acceptedRows.length,
      module: input.workbookKind === "WIP" ? "WIP" : "FABRIC"
    });
  })
);

erpImportRouter.get(
  "/uploads",
  requirePermission("UPLOAD_ERP_FILE"),
  asyncRoute(async (req, res) => {
    const factoryId = String(req.query.factoryId ?? "");

    const uploads = await prisma.upload.findMany({
      where: factoryId ? { factoryId } : undefined,
      orderBy: {
        createdAt: "desc"
      },
      take: 100
    });

    res.json(uploads);
  })
);

erpImportRouter.get(
  "/uploads/:id",
  requirePermission("UPLOAD_ERP_FILE"),
  asyncRoute(async (req, res) => {
    const uploadId = String(req.params.id);
    const upload = await prisma.upload.findUnique({
      where: {
        id: uploadId
      }
    });

    if (!upload) {
      res.status(404).json({ error: "Upload not found" });
      return;
    }

    const events = await prisma.event.findMany({
      where: {
        factoryId: upload.factoryId,
        source: "erp-import-engine"
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    res.json({
      ...upload,
      auditEvents: events.filter((event) => {
        const metadata = event.metadata as { uploadId?: string };
        return metadata.uploadId === uploadId;
      })
    });
  })
);

erpImportRouter.post(
  "/preview",
  requirePermission("UPLOAD_ERP_FILE"),
  asyncRoute(async (req, res) => {
    const input = previewSchema.parse(req.body);
    const result = await erpImport.previewOrderCsv({
      ...input,
      importText: input.importText ?? input.csvText ?? "",
      createdBy: req.authUser?.id
    });

    res.status(201).json(result);
  })
);

erpImportRouter.post(
  "/apply",
  requirePermission("APPROVE_IMPORT"),
  asyncRoute(async (req, res) => {
    const input = applySchema.parse(req.body);
    const result = await erpImport.applyOrderImport({
      ...input,
      approvedBy: req.authUser?.id
    });
    await recordWorkLog({ factoryId: input.factoryId, userId: req.authUser?.id, module: "ORDERS", action: "Order import applied", itemType: "upload", itemId: input.uploadId, itemLabel: input.uploadId, metadata: result as any });

    res.status(201).json(result);
  })
);

erpImportRouter.post(
  "/preview-tech-pack",
  requirePermission("UPLOAD_ERP_FILE"),
  asyncRoute(async (req, res) => {
    const input = previewSchema.parse(req.body);
    const result = await erpImport.previewTechPackImport({
      ...input,
      importText: input.importText ?? input.csvText ?? "",
      createdBy: req.authUser?.id
    });

    res.status(201).json(result);
  })
);

erpImportRouter.post(
  "/apply-tech-pack",
  requirePermission("APPROVE_IMPORT"),
  asyncRoute(async (req, res) => {
    const input = techPackApplySchema.parse(req.body);
    const result = await erpImport.applyTechPackImport({
      ...input,
      approvedBy: req.authUser?.id
    });
    await recordWorkLog({ factoryId: input.factoryId, userId: req.authUser?.id, module: "SAMPLING", action: "Tech pack import applied", itemType: "upload", itemId: input.uploadId, itemLabel: input.uploadId, metadata: result as any });

    res.status(201).json(result);
  })
);

erpImportRouter.post(
  "/preview-daily-production",
  requirePermission("UPLOAD_ERP_FILE"),
  asyncRoute(async (req, res) => {
    const input = previewSchema.parse(req.body);
    const result = await erpImport.previewDailyProductionImport({
      ...input,
      importText: input.importText ?? input.csvText ?? "",
      createdBy: req.authUser?.id
    });

    res.status(201).json(result);
  })
);

erpImportRouter.post(
  "/apply-daily-production",
  requirePermission("APPROVE_IMPORT"),
  asyncRoute(async (req, res) => {
    const input = dailyProductionApplySchema.parse(req.body);
    const result = await erpImport.applyDailyProductionImport({
      ...input,
      approvedBy: req.authUser?.id
    });
    await recordWorkLog({ factoryId: input.factoryId, userId: req.authUser?.id, module: "ORDERS", action: "Daily production applied", itemType: "upload", itemId: input.uploadId, itemLabel: input.uploadId, metadata: result as any });

    res.status(201).json(result);
  })
);
