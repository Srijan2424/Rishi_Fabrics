import { prisma } from "../../db.js";
import { TimelineService } from "../timeline/timeline.service.js";
import {
  ApplyOrderImportInput,
  ApplyDailyProductionImportInput,
  ApplyTechPackImportInput,
  ImportSourceConfig,
  ImportSourceType,
  ImportPreviewResult,
  ImportPreviewResultForRows,
  ParsedDailyProductionImportRow,
  ParsedOrderImportRow,
  ParsedTechPackImportRow,
  PreviewOrderImportInput,
  PreviewTypedImportInput,
  RejectedImportRow
} from "./erp-import.types.js";
import { ImportApplyError } from "./erp-import.errors.js";
import { InventoryService } from "../inventory/inventory.service.js";

const requiredHeaders = [
  "orderNumber",
  "buyerName",
  "productCategory",
  "orderQuantity",
  "deliveryDate",
  "workflowTemplateId"
];

export const importSourceConfigs: ImportSourceConfig[] = [
  {
    sourceType: "CSV",
    label: "CSV",
    extensions: [".csv"],
    enabled: true,
    parserMode: "NATIVE_TABLE_TEXT",
    requiresExtraction: false,
    extractionHint: "Upload or paste CSV rows with the required headers."
  },
  {
    sourceType: "MANUAL",
    label: "Manual Paste / TSV",
    extensions: [".tsv", ".txt"],
    enabled: true,
    parserMode: "NATIVE_TABLE_TEXT",
    requiresExtraction: false,
    extractionHint: "Paste rows copied from a spreadsheet. Comma or tab separated rows are accepted."
  },
  {
    sourceType: "EXCEL",
    label: "Excel",
    extensions: [".xlsx", ".xls"],
    enabled: true,
    parserMode: "EXTRACTED_TABLE_TEXT",
    requiresExtraction: true,
    extractionHint: "Export the worksheet as CSV or paste the worksheet rows into Import Data."
  },
  {
    sourceType: "PDF",
    label: "PDF",
    extensions: [".pdf"],
    enabled: true,
    parserMode: "EXTRACTED_TABLE_TEXT",
    requiresExtraction: true,
    extractionHint: "Extract the order table from the PDF, then paste the rows for validation."
  },
  {
    sourceType: "IMAGE",
    label: "Image / Scan",
    extensions: [".png", ".jpg", ".jpeg", ".webp"],
    enabled: true,
    parserMode: "EXTRACTED_TABLE_TEXT",
    requiresExtraction: true,
    extractionHint: "Run OCR on the image or scan, then paste the extracted table rows for validation."
  }
];
const maxRowsPerImport = 1000;
const maxOrderQuantity = 1_000_000;

const techPackRequiredHeaders = [
  "orderNumber",
  "checkpointCode",
  "status"
];

const dailyProductionRequiredHeaders = [
  "orderNumber",
  "buyerName",
  "styleName",
  "colorName",
  "completedQuantity",
  "totalLineOutQuantity"
];

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

const samplingCheckpoints = [
  {
    checkpointCode: "LAB_DIP_APPROVAL",
    label: "Lab Dip Approval by Buyer",
    owner: "Merchant",
    timeframe: "Variable",
    evidence: "Buyer approval comment or shade confirmation"
  },
  {
    checkpointCode: "FOB_APPROVAL",
    label: "FOB Approval by Buyer",
    owner: "Merchant",
    timeframe: "Variable",
    evidence: "Buyer approval or revised costing confirmation"
  },
  {
    checkpointCode: "PO",
    label: "P.O",
    owner: "Merchant",
    timeframe: "Required before production lock",
    evidence: "Purchase order reference"
  },
  {
    checkpointCode: "FABRIC_CUTTING_SWATCH",
    label: "Fabric Cutting Swatch",
    owner: "Sampling / Fabric",
    timeframe: "Internal",
    evidence: "Swatch cutting status"
  },
  {
    checkpointCode: "SIZE_RATIO",
    label: "Size Ratio",
    owner: "Merchant",
    timeframe: "Qty in pcs",
    evidence: "Ratio quantity confirmation"
  },
  {
    checkpointCode: "TRIMS_CARD",
    label: "Trims Card with Trims",
    owner: "Merchant / Store",
    timeframe: "Internal",
    evidence: "Trim card image or checklist"
  },
  {
    checkpointCode: "PP_COMMENTS",
    label: "P.P Comments from Buyer Side",
    owner: "Merchant",
    timeframe: "Variable",
    evidence: "Buyer comments and revision notes"
  },
  {
    checkpointCode: "PP_SEALER_GARMENT",
    label: "PP Sealer Garment",
    owner: "Sampling",
    timeframe: "Before bulk approval",
    evidence: "Sealer garment approval"
  },
  {
    checkpointCode: "SIZE_SET_APPROVAL",
    label: "Size Set Approval",
    owner: "Merchant / Buyer",
    timeframe: "Variable, domestic only",
    evidence: "Domestic size set approval"
  }
];

const samplingCheckpointByCode = new Map(
  samplingCheckpoints.map((checkpoint) => [checkpoint.checkpointCode, checkpoint])
);

const samplingStatuses = new Set([
  "PENDING",
  "SUBMITTED",
  "APPROVED",
  "REVISION_REQUIRED"
]);

const dailyProductionAliases: Record<string, string[]> = {
  orderNumber: ["orderNumber", "ORDER NUMBER", "ORDER NO", "ORDER"],
  buyerName: ["buyerName", "BUYER"],
  styleName: ["styleName", "STYLE"],
  colorName: ["colorName", "COLOUR", "COLOR"],
  description: ["description", "DESC.", "DESC", "DESCRIPTION"],
  orderQuantity: ["orderQuantity", "ORDER QTY.", "ORDER QTY", "ORDER QUANTITY"],
  cuttingTotalQuantity: ["cuttingTotalQuantity", "CUTTING TOTAL QTY", "CUTTING"],
  cuttingToLineBalanceQuantity: ["cuttingToLineBalanceQuantity", "CUTTING TO LINE IN BAL"],
  lineLoadingQuantity: ["lineLoadingQuantity", "LINE LOADING"],
  todayLineOutQuantity: ["todayLineOutQuantity", "TODAY LINE OUT"],
  totalLineOutQuantity: ["totalLineOutQuantity", "TOTAL LINE OUT"],
  lineInBalanceQuantity: ["lineInBalanceQuantity", " LINE IN BAL", "LINE IN BAL"],
  productionStatus: ["productionStatus", "PRODUCTION STATUS"],
  stageCode: ["stageCode", "STAGE CODE", "STAGE"],
  completedQuantity: ["completedQuantity", "COMPLETED QUANTITY"],
  rejectedQuantity: ["rejectedQuantity", "REJECTED QUANTITY", "REJECTION", "REJECTED"],
  reworkQuantity: ["reworkQuantity", "REWORK QUANTITY", "REWORK"],
  updateDate: ["updateDate", "UPDATE DATE", "DATE"],
  notes: ["notes", "NOTES", "REMARKS"],
  rowColorHex: ["rowColorHex", "ROW COLOR", "ROW COLOR HEX", "COLOR HEX", "COLOUR HEX"]
};

export class ErpImportService {
  constructor(
    private readonly db = prisma,
    private readonly timeline = new TimelineService(db)
  ) {}

  private parseDelimited(importText: string, sourceType: ImportSourceType) {
    const delimiter = sourceType === "MANUAL" && importText.includes("\t") ? "\t" : ",";
    const lines = importText
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);

    if (lines.length === 0) {
      return {
        headers: [],
        rows: []
      };
    }

    const parseLine = (line: string) => {
      const values: string[] = [];
      let current = "";
      let inQuotes = false;

      for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        const nextCharacter = line[index + 1];

        if (character === "\"" && nextCharacter === "\"") {
          current += "\"";
          index += 1;
          continue;
        }

        if (character === "\"") {
          inQuotes = !inQuotes;
          continue;
        }

        if (character === delimiter && !inQuotes) {
          values.push(current.trim());
          current = "";
          continue;
        }

        current += character;
      }

      values.push(current.trim());
      return values;
    };

    const headers = parseLine(lines[0]).map((header) => header.trim());

    const rows = lines.slice(1).map((line, index) => {
      const values = parseLine(line);
      const row: Record<string, string> = {};

      headers.forEach((header, headerIndex) => {
        row[header] = values[headerIndex] ?? "";
      });

      return {
        rowNumber: index + 2,
        row
      };
    });

    return {
      headers,
      rows
    };
  }

  private validateHeaders(headers: string[]) {
    return requiredHeaders.filter((header) => !headers.includes(header));
  }

  private validateRequiredHeaders(headers: string[], required: string[]) {
    return required.filter((header) => !headers.includes(header));
  }

  private getRowValue(row: Record<string, string>, fieldName: keyof typeof dailyProductionAliases) {
    const aliases = dailyProductionAliases[fieldName];

    for (const alias of aliases) {
      const value = row[alias];

      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return String(value).trim();
      }
    }

    return "";
  }

  private normalizeColorHex(value: string) {
    return value.replace("#", "").trim().toUpperCase();
  }

  private makeOrderNumberFromDpr(row: {
    buyerName: string;
    styleName: string;
    colorName: string;
  }) {
    return [row.buyerName, row.styleName, row.colorName]
      .join("-")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
  }

  private inferStageCode(row: {
    stageCode: string;
    totalLineOutQuantity: number;
    lineLoadingQuantity: number;
    cuttingTotalQuantity: number;
    productionStatus?: string;
  }) {
    if (row.stageCode) {
      return row.stageCode;
    }

    if (row.productionStatus?.toUpperCase().includes("DISPATCH")) {
      return "DISPATCH";
    }

    if (row.totalLineOutQuantity > 0 || row.lineLoadingQuantity > 0) {
      return "STITCHING";
    }

    if (row.cuttingTotalQuantity > 0) {
      return "PANEL_CUTTING";
    }

    return "PANEL_CUTTING";
  }

  private inferCompletedQuantity(row: {
    completedQuantity: number | null;
    totalLineOutQuantity: number;
    lineLoadingQuantity: number;
    cuttingTotalQuantity: number;
  }) {
    if (row.completedQuantity !== null) {
      return row.completedQuantity;
    }

    if (row.totalLineOutQuantity > 0) {
      return row.totalLineOutQuantity;
    }

    if (row.lineLoadingQuantity > 0) {
      return row.lineLoadingQuantity;
    }

    return row.cuttingTotalQuantity;
  }

  private async resolveUnitMapping(input: {
    factoryId: string;
    rowColorHex?: string;
    productionStatus?: string;
    db?: any;
  }) {
    const db = input.db ?? this.db;
    const rowColorHex = input.rowColorHex ? this.normalizeColorHex(input.rowColorHex) : "";

    if (rowColorHex) {
      return db.unitColorMapping.findFirst({
        where: {
          factoryId: input.factoryId,
          colorHex: rowColorHex,
          isActive: true
        },
        include: {
          productionUnit: true
        }
      });
    }

    if (input.productionStatus) {
      return db.unitColorMapping.findFirst({
        where: {
          factoryId: input.factoryId,
          productionStatus: {
            equals: input.productionStatus,
            mode: "insensitive"
          },
          isActive: true
        },
        include: {
          productionUnit: true
        }
      });
    }

    return null;
  }

  private async createUploadPreview<TAcceptedRow>(input: PreviewTypedImportInput & {
    importKind: "TECH_PACK" | "DAILY_PRODUCTION";
    rowsReceived: number;
    acceptedRows: TAcceptedRow[];
    rejectedRows: RejectedImportRow[];
  }): Promise<ImportPreviewResultForRows<TAcceptedRow>> {
    const sourceConfig = importSourceConfigs.find((config) => config.sourceType === input.sourceType);
    const status = input.rejectedRows.length > 0 ? "PREVIEW_HAS_ERRORS" : "PREVIEW_READY";
    const upload = await this.db.upload.create({
      data: {
        factoryId: input.factoryId,
        fileName: input.fileName,
        sourceType: `${input.importKind}:${input.sourceType}`,
        status,
        rowsReceived: input.rowsReceived,
        rowsAccepted: input.acceptedRows.length,
        rowsRejected: input.rejectedRows.length,
        errors: JSON.parse(JSON.stringify(input.rejectedRows))
      }
    });

    await this.timeline.createEvent({
      factoryId: input.factoryId,
      type: "IMPORT_CREATED",
      message: `${input.importKind} import preview created for ${input.fileName}.`,
      metadata: {
        uploadId: upload.id,
        importKind: input.importKind,
        sourceType: input.sourceType,
        parserMode: sourceConfig?.parserMode,
        requiresExtraction: sourceConfig?.requiresExtraction,
        rowsReceived: input.rowsReceived,
        rowsAccepted: input.acceptedRows.length,
        rowsRejected: input.rejectedRows.length,
        status
      },
      createdBy: input.createdBy,
      source: "erp-import-engine"
    });

    return {
      uploadId: upload.id,
      status,
      rowsReceived: input.rowsReceived,
      acceptedRows: input.acceptedRows,
      rejectedRows: input.rejectedRows
    };
  }

  private validateRow(rowNumber: number, row: Record<string, string>) {
    const errors: string[] = [];
    const quantity = Number(row.orderQuantity);
    const deliveryDate = new Date(row.deliveryDate);

    if (!row.orderNumber) errors.push("orderNumber is required");
    if (!row.buyerName) errors.push("buyerName is required");
    if (!row.productCategory) errors.push("productCategory is required");
    if (!row.workflowTemplateId) errors.push("workflowTemplateId is required");
    if (row.orderNumber && row.orderNumber.length > 80) errors.push("orderNumber must be 80 characters or less");
    if (row.buyerName && row.buyerName.length > 120) errors.push("buyerName must be 120 characters or less");
    if (row.productCategory && row.productCategory.length > 80) errors.push("productCategory must be 80 characters or less");
    if (!Number.isInteger(quantity) || quantity <= 0) errors.push("orderQuantity must be a positive integer");
    if (Number.isInteger(quantity) && quantity > maxOrderQuantity) errors.push(`orderQuantity cannot exceed ${maxOrderQuantity}`);
    if (Number.isNaN(deliveryDate.getTime())) errors.push("deliveryDate must be valid");
    if (!Number.isNaN(deliveryDate.getTime()) && deliveryDate < new Date("2020-01-01")) {
      errors.push("deliveryDate is too old for a new order import");
    }

    if (errors.length > 0) {
      return {
        accepted: null,
        rejected: {
          rowNumber,
          row,
          errors
        }
      };
    }

    return {
      accepted: {
        rowNumber,
        orderNumber: row.orderNumber,
        buyerName: row.buyerName,
        productCategory: row.productCategory,
        orderQuantity: quantity,
        deliveryDate: deliveryDate.toISOString(),
        workflowTemplateId: row.workflowTemplateId
      },
      rejected: null
    };
  }

  private validateTechPackRow(rowNumber: number, row: Record<string, string>) {
    const errors: string[] = [];
    const status = row.status?.trim().toUpperCase();
    const checkpoint = samplingCheckpointByCode.get(row.checkpointCode);
    const submittedAt = row.submittedAt ? new Date(row.submittedAt) : null;
    const approvedAt = row.approvedAt ? new Date(row.approvedAt) : null;

    if (!row.orderNumber) errors.push("orderNumber is required");
    if (!row.checkpointCode) errors.push("checkpointCode is required");
    if (row.checkpointCode && !checkpoint) errors.push(`Unknown sampling checkpoint: ${row.checkpointCode}`);
    if (!status) errors.push("status is required");
    if (status && !samplingStatuses.has(status)) errors.push(`Invalid sampling status: ${row.status}`);
    if (row.comments && row.comments.length > 500) errors.push("comments must be 500 characters or less");
    if (row.evidence && row.evidence.length > 500) errors.push("evidence must be 500 characters or less");
    if (submittedAt && Number.isNaN(submittedAt.getTime())) errors.push("submittedAt must be a valid date");
    if (approvedAt && Number.isNaN(approvedAt.getTime())) errors.push("approvedAt must be a valid date");

    if (errors.length > 0 || !checkpoint || !status || !samplingStatuses.has(status)) {
      return {
        accepted: null,
        rejected: {
          rowNumber,
          row,
          errors
        }
      };
    }

    return {
      accepted: {
        rowNumber,
        orderNumber: row.orderNumber,
        checkpointCode: checkpoint.checkpointCode,
        status: status as ParsedTechPackImportRow["status"],
        comments: row.comments || undefined,
        evidence: row.evidence || checkpoint.evidence,
        submittedAt: submittedAt && !Number.isNaN(submittedAt.getTime()) ? submittedAt.toISOString() : undefined,
        approvedAt: approvedAt && !Number.isNaN(approvedAt.getTime()) ? approvedAt.toISOString() : undefined
      },
      rejected: null
    };
  }

  private normalizeDailyProductionInteger(input: {
    label: string;
    rawValue: string;
    fallback: number;
    allowNegative?: boolean;
    updates: string[];
  }) {
    const rawValue = input.rawValue.trim();
    if (!rawValue) return input.fallback;

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      input.updates.push(`${input.label} was not a valid number (${rawValue}); used ${input.fallback}.`);
      return input.fallback;
    }

    const integerValue = Number.isInteger(parsed) ? parsed : Math.round(parsed);
    if (!Number.isInteger(parsed)) {
      input.updates.push(`${input.label} was not an integer (${rawValue}); rounded to ${integerValue}.`);
    }

    if (!input.allowNegative && integerValue < 0) {
      input.updates.push(`${input.label} was negative (${integerValue}); used 0.`);
      return 0;
    }

    if (input.allowNegative && integerValue < 0) {
      input.updates.push(`${input.label} is negative (${integerValue}); treated as a balance/shortage signal.`);
    }

    return integerValue;
  }

  private buildDailyProductionNotes(rawNotes: string, updates: string[]) {
    let notes = rawNotes.trim();
    if (notes.length > 500) {
      updates.push("notes exceeded 500 characters and were trimmed.");
      notes = notes.slice(0, 500);
    }

    const updateText = updates.length > 0 ? `Daily production updates: ${updates.join("; ")}` : "";
    return [notes, updateText].filter(Boolean).join(notes && updateText ? " | " : "") || undefined;
  }

  private validateDailyProductionRow(rowNumber: number, row: Record<string, string>) {
    const errors: string[] = [];
    const updates: string[] = [];
    const buyerName = this.getRowValue(row, "buyerName");
    const styleName = this.getRowValue(row, "styleName");
    const colorName = this.getRowValue(row, "colorName");
    const description = this.getRowValue(row, "description");
    const productionStatus = this.getRowValue(row, "productionStatus");
    const rowColorHex = this.getRowValue(row, "rowColorHex");
    const orderQuantity = Number(this.getRowValue(row, "orderQuantity") || 0);

    const cuttingTotalQuantity = this.normalizeDailyProductionInteger({ label: "cuttingTotalQuantity", rawValue: this.getRowValue(row, "cuttingTotalQuantity"), fallback: 0, updates });
    const cuttingToLineBalanceQuantity = this.normalizeDailyProductionInteger({ label: "cuttingToLineBalanceQuantity", rawValue: this.getRowValue(row, "cuttingToLineBalanceQuantity"), fallback: 0, allowNegative: true, updates });
    const lineLoadingQuantity = this.normalizeDailyProductionInteger({ label: "lineLoadingQuantity", rawValue: this.getRowValue(row, "lineLoadingQuantity"), fallback: 0, updates });
    const todayLineOutQuantity = this.normalizeDailyProductionInteger({ label: "todayLineOutQuantity", rawValue: this.getRowValue(row, "todayLineOutQuantity"), fallback: 0, updates });
    const totalLineOutQuantity = this.normalizeDailyProductionInteger({ label: "totalLineOutQuantity", rawValue: this.getRowValue(row, "totalLineOutQuantity"), fallback: 0, updates });
    const lineInBalanceQuantity = this.normalizeDailyProductionInteger({ label: "lineInBalanceQuantity", rawValue: this.getRowValue(row, "lineInBalanceQuantity"), fallback: 0, allowNegative: true, updates });
    const rejectedQuantity = this.normalizeDailyProductionInteger({ label: "rejectedQuantity", rawValue: this.getRowValue(row, "rejectedQuantity"), fallback: 0, updates });
    const reworkQuantity = this.normalizeDailyProductionInteger({ label: "reworkQuantity", rawValue: this.getRowValue(row, "reworkQuantity"), fallback: 0, updates });

    const completedFallback = this.inferCompletedQuantity({
      completedQuantity: null,
      totalLineOutQuantity,
      lineLoadingQuantity,
      cuttingTotalQuantity
    });
    const completedQuantity = this.normalizeDailyProductionInteger({
      label: "completedQuantity",
      rawValue: this.getRowValue(row, "completedQuantity"),
      fallback: completedFallback,
      updates
    });

    let updateDate = this.getRowValue(row, "updateDate") ? new Date(this.getRowValue(row, "updateDate")) : new Date();
    if (Number.isNaN(updateDate.getTime())) {
      updates.push(`updateDate was invalid (${this.getRowValue(row, "updateDate")}); upload time used.`);
      updateDate = new Date();
    }

    const stageCode = this.inferStageCode({
      stageCode: this.getRowValue(row, "stageCode"),
      totalLineOutQuantity,
      lineLoadingQuantity,
      cuttingTotalQuantity,
      productionStatus
    });
    const orderNumber = this.getRowValue(row, "orderNumber") || this.makeOrderNumberFromDpr({
      buyerName,
      styleName,
      colorName
    });

    if (!orderNumber) errors.push("orderNumber is required when buyerName/styleName/colorName are not present");
    if (!buyerName) errors.push("buyerName/BUYER is required");
    if (!styleName) errors.push("styleName/STYLE is required");
    if (!colorName) errors.push("colorName/COLOUR is required");
    if (!Number.isInteger(orderQuantity) || orderQuantity <= 0) errors.push("orderQuantity/ORDER QTY. must be a positive integer");
    if (!stageCode) errors.push("stageCode could not be inferred");

    if (errors.length > 0) {
      return {
        accepted: null,
        rejected: {
          rowNumber,
          row,
          errors
        }
      };
    }

    return {
      accepted: {
        rowNumber,
        orderNumber,
        buyerName,
        styleName,
        colorName,
        description: description || undefined,
        orderQuantity,
        stageCode,
        completedQuantity,
        cuttingTotalQuantity,
        cuttingToLineBalanceQuantity,
        lineLoadingQuantity,
        todayLineOutQuantity,
        totalLineOutQuantity,
        lineInBalanceQuantity,
        rejectedQuantity,
        reworkQuantity,
        productionStatus: productionStatus || undefined,
        rowColorHex: rowColorHex ? this.normalizeColorHex(rowColorHex) : undefined,
        updateDate: updateDate.toISOString(),
        notes: this.buildDailyProductionNotes(this.getRowValue(row, "notes"), updates)
      },
      rejected: null
    };
  }

  private async ensureSamplingApprovals(orderId: string, db: any = this.db) {
    for (const checkpoint of samplingCheckpoints) {
      await db.samplingApproval.upsert({
        where: {
          orderId_checkpointCode: {
            orderId,
            checkpointCode: checkpoint.checkpointCode
          }
        },
        update: {},
        create: {
          orderId,
          ...checkpoint
        }
      });
    }

    return db.samplingApproval.findMany({
      where: {
        orderId
      },
      orderBy: {
        createdAt: "asc"
      }
    });
  }

  private async getFirstProductionStage(workflowTemplateId: string, db: any = this.db) {
    return db.workflowStage.findFirst({
      where: {
        workflowTemplateId,
        category: {
          in: ["PRODUCTION", "INSPECTION", "DISPATCH"]
        }
      },
      orderBy: {
        sequence: "asc"
      }
    });
  }

  private getDefaultDailyProductionDeliveryDate() {
    const date = new Date();
    date.setDate(date.getDate() + 60);
    return date;
  }

  private async getDefaultWorkflowTemplate(factoryId: string, db: any = this.db) {
    return db.workflowTemplate.findFirst({
      where: {
        factoryId,
        isActive: true
      },
      orderBy: {
        createdAt: "asc"
      },
      include: {
        stages: {
          orderBy: {
            sequence: "asc"
          }
        }
      }
    });
  }

  async previewOrderCsv(input: Omit<PreviewOrderImportInput, "importText"> & {
    importText?: string;
    csvText?: string;
  }): Promise<ImportPreviewResult> {
    return this.previewOrderImport({
      ...input,
      importText: input.importText ?? input.csvText ?? ""
    });
  }

  async previewOrderImport(input: PreviewOrderImportInput): Promise<ImportPreviewResult> {
    const factory = await this.db.factory.findUnique({
      where: {
        id: input.factoryId
      }
    });

    if (!factory) {
      throw new ImportApplyError("Factory not found");
    }

    const sourceConfig = importSourceConfigs.find((config) => config.sourceType === input.sourceType);

    if (!sourceConfig?.enabled) {
      throw new ImportApplyError(`Import source is not enabled: ${input.sourceType}`);
    }

    const { headers, rows } = this.parseDelimited(input.importText, input.sourceType);
    const missingHeaders = this.validateHeaders(headers);
    const acceptedRows: ParsedOrderImportRow[] = [];
    const rejectedRows: RejectedImportRow[] = [];

    if (missingHeaders.length > 0) {
      rejectedRows.push({
        rowNumber: 1,
        row: {},
        errors: [
          `Missing required headers: ${missingHeaders.join(", ")}`,
          sourceConfig.requiresExtraction ? sourceConfig.extractionHint : "Check the uploaded table format."
        ]
      });
    }

    if (rows.length > maxRowsPerImport) {
      rejectedRows.push({
        rowNumber: 1,
        row: {},
        errors: [`Import contains ${rows.length} rows. Maximum allowed is ${maxRowsPerImport}.`]
      });
    }

    const duplicateInFile = new Set<string>();

    for (const parsed of rows.slice(0, maxRowsPerImport)) {
      const result = this.validateRow(parsed.rowNumber, parsed.row);

      if (result.rejected) {
        rejectedRows.push(result.rejected);
        continue;
      }

      const accepted = result.accepted;

      if (!accepted) {
        continue;
      }

      if (duplicateInFile.has(accepted.orderNumber)) {
        rejectedRows.push({
          rowNumber: parsed.rowNumber,
          row: parsed.row,
          errors: [`Duplicate orderNumber in file: ${accepted.orderNumber}`]
        });
        continue;
      }

      duplicateInFile.add(accepted.orderNumber);

      const [existingOrder, workflow] = await Promise.all([
        this.db.order.findFirst({
          where: {
            factoryId: input.factoryId,
            orderNumber: accepted.orderNumber
          }
        }),
        this.db.workflowTemplate.findFirst({
          where: {
            id: accepted.workflowTemplateId,
            factoryId: input.factoryId,
            isActive: true
          }
        })
      ]);

      if (existingOrder) {
        rejectedRows.push({
          rowNumber: parsed.rowNumber,
          row: parsed.row,
          errors: [`Order already exists: ${accepted.orderNumber}`]
        });
        continue;
      }

      if (!workflow) {
        rejectedRows.push({
          rowNumber: parsed.rowNumber,
          row: parsed.row,
          errors: [`Workflow not found for factory: ${accepted.workflowTemplateId}`]
        });
        continue;
      }

      acceptedRows.push(accepted);
    }

    const status = rejectedRows.length > 0 ? "PREVIEW_HAS_ERRORS" : "PREVIEW_READY";

    const upload = await this.db.upload.create({
      data: {
        factoryId: input.factoryId,
        fileName: input.fileName,
        sourceType: input.sourceType,
        status,
        rowsReceived: rows.length,
        rowsAccepted: acceptedRows.length,
        rowsRejected: rejectedRows.length,
        errors: JSON.parse(JSON.stringify(rejectedRows))
      }
    });

    await this.timeline.createEvent({
      factoryId: input.factoryId,
      type: "IMPORT_CREATED",
      message: `Import preview created for ${input.fileName}.`,
      metadata: {
        uploadId: upload.id,
        sourceType: input.sourceType,
        parserMode: sourceConfig.parserMode,
        requiresExtraction: sourceConfig.requiresExtraction,
        rowsReceived: rows.length,
        rowsAccepted: acceptedRows.length,
        rowsRejected: rejectedRows.length,
        status
      },
      createdBy: input.createdBy,
      source: "erp-import-engine"
    });

    return {
      uploadId: upload.id,
      status,
      rowsReceived: rows.length,
      acceptedRows,
      rejectedRows
    };
  }

  async previewTechPackImport(input: PreviewTypedImportInput): Promise<ImportPreviewResultForRows<ParsedTechPackImportRow>> {
    const factory = await this.db.factory.findUnique({
      where: {
        id: input.factoryId
      }
    });

    if (!factory) {
      throw new ImportApplyError("Factory not found");
    }

    const sourceConfig = importSourceConfigs.find((config) => config.sourceType === input.sourceType);

    if (!sourceConfig?.enabled) {
      throw new ImportApplyError(`Import source is not enabled: ${input.sourceType}`);
    }

    const { headers, rows } = this.parseDelimited(input.importText, input.sourceType);
    const missingHeaders = this.validateRequiredHeaders(headers, techPackRequiredHeaders);
    const acceptedRows: ParsedTechPackImportRow[] = [];
    const rejectedRows: RejectedImportRow[] = [];

    if (missingHeaders.length > 0) {
      rejectedRows.push({
        rowNumber: 1,
        row: {},
        errors: [`Missing required headers: ${missingHeaders.join(", ")}`]
      });
    }

    if (rows.length > maxRowsPerImport) {
      rejectedRows.push({
        rowNumber: 1,
        row: {},
        errors: [`Import contains ${rows.length} rows. Maximum allowed is ${maxRowsPerImport}.`]
      });
    }

    for (const parsed of rows.slice(0, maxRowsPerImport)) {
      const result = this.validateTechPackRow(parsed.rowNumber, parsed.row);

      if (result.rejected) {
        rejectedRows.push(result.rejected);
        continue;
      }

      const accepted = result.accepted;

      if (!accepted) {
        continue;
      }

      const order = await this.db.order.findFirst({
        where: {
          factoryId: input.factoryId,
          orderNumber: accepted.orderNumber
        }
      });

      if (!order) {
        rejectedRows.push({
          rowNumber: parsed.rowNumber,
          row: parsed.row,
          errors: [`Order not found: ${accepted.orderNumber}`]
        });
        continue;
      }

      if (order.currentStageCode && !samplingStageCodes.has(order.currentStageCode)) {
        rejectedRows.push({
          rowNumber: parsed.rowNumber,
          row: parsed.row,
          errors: [`Order is not in sampling: ${accepted.orderNumber}`]
        });
        continue;
      }

      acceptedRows.push(accepted);
    }

    return this.createUploadPreview({
      ...input,
      importKind: "TECH_PACK",
      rowsReceived: rows.length,
      acceptedRows,
      rejectedRows
    });
  }

  async previewDailyProductionImport(input: PreviewTypedImportInput): Promise<ImportPreviewResultForRows<ParsedDailyProductionImportRow>> {
    const factory = await this.db.factory.findUnique({
      where: {
        id: input.factoryId
      }
    });

    if (!factory) {
      throw new ImportApplyError("Factory not found");
    }

    const sourceConfig = importSourceConfigs.find((config) => config.sourceType === input.sourceType);

    if (!sourceConfig?.enabled) {
      throw new ImportApplyError(`Import source is not enabled: ${input.sourceType}`);
    }

    const { headers, rows } = this.parseDelimited(input.importText, input.sourceType);
    const hasOrderNumber = headers.some((header) => dailyProductionAliases.orderNumber.includes(header));
    const hasBuyerStyleColor = (["buyerName", "styleName", "colorName"] as Array<keyof typeof dailyProductionAliases>).every((field) =>
      headers.some((header) => dailyProductionAliases[field].includes(header))
    );
    const hasCompletedQuantity = headers.some((header) =>
      [
        ...dailyProductionAliases.completedQuantity,
        ...dailyProductionAliases.totalLineOutQuantity,
        ...dailyProductionAliases.lineLoadingQuantity,
        ...dailyProductionAliases.cuttingTotalQuantity
      ].includes(header)
    );
    const missingHeaders = [
      !hasOrderNumber && !hasBuyerStyleColor ? "orderNumber or BUYER+STYLE+COLOUR" : "",
      !hasCompletedQuantity ? "completedQuantity or TOTAL LINE OUT / LINE LOADING / CUTTING TOTAL QTY" : ""
    ].filter(Boolean);
    const acceptedRows: ParsedDailyProductionImportRow[] = [];
    const rejectedRows: RejectedImportRow[] = [];

    if (missingHeaders.length > 0) {
      rejectedRows.push({
        rowNumber: 1,
        row: {},
        errors: [`Missing required headers: ${missingHeaders.join(", ")}`]
      });
    }

    if (rows.length > maxRowsPerImport) {
      rejectedRows.push({
        rowNumber: 1,
        row: {},
        errors: [`Import contains ${rows.length} rows. Maximum allowed is ${maxRowsPerImport}.`]
      });
    }

    for (const parsed of rows.slice(0, maxRowsPerImport)) {
      const result = this.validateDailyProductionRow(parsed.rowNumber, parsed.row);

      if (result.rejected) {
        rejectedRows.push(result.rejected);
        continue;
      }

      const accepted = result.accepted as ParsedDailyProductionImportRow | null;

      if (!accepted) {
        continue;
      }

      const order = await this.db.order.findFirst({
        where: {
          factoryId: input.factoryId,
          orderNumber: accepted.orderNumber
        },
        include: {
          stages: true
        }
      });

      const workflow = order ? null : await this.getDefaultWorkflowTemplate(input.factoryId);
      const stages = order?.stages ?? workflow?.stages ?? [];
      const orderStage = stages.find((stage: any) => (stage.stageCode ?? stage.code) === accepted.stageCode);

      if (!orderStage) {
        rejectedRows.push({
          rowNumber: parsed.rowNumber,
          row: parsed.row,
          errors: [order
            ? `Stage ${accepted.stageCode} does not exist on order ${accepted.orderNumber}`
            : `Stage ${accepted.stageCode} does not exist in the default active workflow for new order ${accepted.orderNumber}`]
        });
        continue;
      }

      const mapping = await this.resolveUnitMapping({
        factoryId: input.factoryId,
        rowColorHex: accepted.rowColorHex,
        productionStatus: accepted.productionStatus
      });

      if ((accepted.rowColorHex || accepted.productionStatus) && !mapping) {
        rejectedRows.push({
          rowNumber: parsed.rowNumber,
          row: parsed.row,
          errors: [
            `No active unit color mapping found for ${accepted.rowColorHex || accepted.productionStatus}`,
            "Configure this Excel color/status before applying daily production."
          ]
        });
        continue;
      }

      accepted.productionUnitId = mapping?.productionUnitId ?? undefined;
      accepted.productionUnitCode = mapping?.productionUnit?.code ?? undefined;
      accepted.productionUnitName = mapping?.productionUnit?.name ?? undefined;

      if (order && accepted.completedQuantity < orderStage.completedQuantity) {
        rejectedRows.push({
          rowNumber: parsed.rowNumber,
          row: parsed.row,
          errors: [
            `completedQuantity ${accepted.completedQuantity} is lower than current recorded quantity ${orderStage.completedQuantity}`,
            "Use a correction workflow instead of silently reducing production from an import."
          ]
        });
        continue;
      }

      accepted.deliveryDate = (order?.deliveryDate ?? this.getDefaultDailyProductionDeliveryDate()).toISOString();
      accepted.orderExists = Boolean(order);
      accepted.requiresDeliveryDate = false;
      accepted.orderAction = order ? "UPDATE" : "CREATE";
      if (!order) {
        accepted.notes = [
          accepted.notes,
          "New order detected. Delivery date defaulted to 60 days from upload and can be edited later."
        ].filter(Boolean).join(" ");
      }

      acceptedRows.push(accepted);
    }

    return this.createUploadPreview({
      ...input,
      importKind: "DAILY_PRODUCTION",
      rowsReceived: rows.length,
      acceptedRows,
      rejectedRows
    });
  }

  async applyOrderImport(input: ApplyOrderImportInput) {
    const upload = await this.db.upload.findUnique({
      where: {
        id: input.uploadId
      }
    });

    if (!upload) {
      throw new ImportApplyError("Upload not found");
    }

    if (upload.factoryId !== input.factoryId) {
      throw new ImportApplyError("Upload does not belong to this factory");
    }

    if (upload.status !== "PREVIEW_READY") {
      throw new ImportApplyError(`Upload is not ready to apply. Current status: ${upload.status}`);
    }

    if (upload.rowsRejected > 0) {
      await this.db.upload.update({
        where: {
          id: upload.id
        },
        data: {
          status: "REJECTED"
        }
      });

      throw new ImportApplyError("Cannot apply import with rejected rows");
    }

    if (upload.rowsAccepted !== input.acceptedRows.length) {
      throw new ImportApplyError("Accepted row count does not match preview");
    }

    const createdOrders = await this.db.$transaction(async (tx: any) => {
      const orders = [];
      const orderNumbers = new Set<string>();

      for (const row of input.acceptedRows) {
        if (orderNumbers.has(row.orderNumber)) {
          throw new ImportApplyError(`Duplicate orderNumber in apply payload: ${row.orderNumber}`);
        }

        orderNumbers.add(row.orderNumber);

        const existingOrder = await tx.order.findFirst({
          where: {
            factoryId: input.factoryId,
            orderNumber: row.orderNumber
          }
        });

        if (existingOrder) {
          throw new ImportApplyError(`Order already exists: ${row.orderNumber}`);
        }

        const workflowStages = await tx.workflowStage.findMany({
          where: {
            workflowTemplateId: row.workflowTemplateId
          },
          orderBy: {
            sequence: "asc"
          }
        });

        if (workflowStages.length === 0) {
          throw new ImportApplyError(`Workflow has no stages: ${row.workflowTemplateId}`);
        }

        const order = await tx.order.create({
          data: {
            factoryId: input.factoryId,
            workflowTemplateId: row.workflowTemplateId,
            orderNumber: row.orderNumber,
            buyerName: row.buyerName,
            productCategory: row.productCategory,
            orderQuantity: row.orderQuantity,
            deliveryDate: new Date(row.deliveryDate),
            currentStageCode: workflowStages[0].code,
            stages: {
              create: workflowStages.map((stage: { id: string; code: string; name: string }) => ({
                workflowStageId: stage.id,
                stageCode: stage.code,
                stageName: stage.name,
                plannedQuantity: row.orderQuantity
              }))
            }
          }
        });

        await new TimelineService(tx).createEvent({
          factoryId: input.factoryId,
          orderId: order.id,
          type: "ORDER_CREATED",
          message: `Order ${order.orderNumber} created from ERP import.`,
          metadata: {
            uploadId: input.uploadId,
            rowNumber: row.rowNumber
          },
          createdBy: input.approvedBy,
          source: "erp-import-engine"
        });

        orders.push(order);
      }

      await tx.upload.update({
        where: {
          id: input.uploadId
        },
        data: {
          status: "APPLIED"
        }
      });

      await new TimelineService(tx).createEvent({
        factoryId: input.factoryId,
        type: "IMPORT_APPROVED",
        message: `Import ${input.uploadId} applied.`,
        metadata: {
          uploadId: input.uploadId,
          createdOrders: orders.length
        },
        createdBy: input.approvedBy,
        source: "erp-import-engine"
      });

      return orders;
    });

    return {
      success: true,
      createdOrders
    };
  }

  private async assertUploadReady(uploadId: string, factoryId: string, expectedKind: "TECH_PACK" | "DAILY_PRODUCTION") {
    const upload = await this.db.upload.findUnique({
      where: {
        id: uploadId
      }
    });

    if (!upload) {
      throw new ImportApplyError("Upload not found");
    }

    if (upload.factoryId !== factoryId) {
      throw new ImportApplyError("Upload does not belong to this factory");
    }

    if (!upload.sourceType.startsWith(`${expectedKind}:`)) {
      throw new ImportApplyError(`Upload is not a ${expectedKind} import`);
    }

    if (upload.status !== "PREVIEW_READY") {
      throw new ImportApplyError(`Upload is not ready to apply. Current status: ${upload.status}`);
    }

    if (upload.rowsRejected > 0) {
      await this.db.upload.update({
        where: {
          id: upload.id
        },
        data: {
          status: "REJECTED"
        }
      });

      throw new ImportApplyError("Cannot apply import with rejected rows");
    }

    return upload;
  }

  async applyTechPackImport(input: ApplyTechPackImportInput) {
    const upload = await this.assertUploadReady(input.uploadId, input.factoryId, "TECH_PACK");

    if (upload.rowsAccepted !== input.acceptedRows.length) {
      throw new ImportApplyError("Accepted row count does not match preview");
    }

    const updatedApprovals = await this.db.$transaction(async (tx: any) => {
      const approvals = [];

      for (const row of input.acceptedRows) {
        const order = await tx.order.findFirst({
          where: {
            factoryId: input.factoryId,
            orderNumber: row.orderNumber
          }
        });

        if (!order) {
          throw new ImportApplyError(`Order not found: ${row.orderNumber}`);
        }

        const checkpoint = samplingCheckpointByCode.get(row.checkpointCode);

        if (!checkpoint) {
          throw new ImportApplyError(`Unknown sampling checkpoint: ${row.checkpointCode}`);
        }

        await this.ensureSamplingApprovals(order.id, tx);

        const approvedAt = row.status === "APPROVED"
          ? new Date(row.approvedAt ?? Date.now())
          : null;
        const submittedAt = row.status === "SUBMITTED" || row.status === "APPROVED"
          ? new Date(row.submittedAt ?? row.approvedAt ?? Date.now())
          : null;

        const updated = await tx.samplingApproval.update({
          where: {
            orderId_checkpointCode: {
              orderId: order.id,
              checkpointCode: row.checkpointCode
            }
          },
          data: {
            status: row.status,
            comments: row.comments,
            evidence: row.evidence ?? checkpoint.evidence,
            submittedAt,
            approvedAt,
            updatedBy: input.approvedBy
          }
        });

        await new TimelineService(tx).createEvent({
          factoryId: input.factoryId,
          orderId: order.id,
          type: "ORDER_UPDATED",
          message: `${updated.label} marked ${updated.status} from tech pack import for ${order.orderNumber}.`,
          metadata: {
            uploadId: input.uploadId,
            rowNumber: row.rowNumber,
            checkpointCode: row.checkpointCode,
            status: row.status
          },
          createdBy: input.approvedBy,
          source: "tech-pack-import-engine"
        });

        approvals.push(updated);
      }

      await tx.upload.update({
        where: {
          id: input.uploadId
        },
        data: {
          status: "APPLIED"
        }
      });

      await new TimelineService(tx).createEvent({
        factoryId: input.factoryId,
        type: "IMPORT_APPROVED",
        message: `Tech pack import ${input.uploadId} applied.`,
        metadata: {
          uploadId: input.uploadId,
          updatedApprovals: approvals.length
        },
        createdBy: input.approvedBy,
        source: "tech-pack-import-engine"
      });

      return approvals;
    });

    return {
      success: true,
      updatedApprovals
    };
  }

  async applyDailyProductionImport(input: ApplyDailyProductionImportInput) {
    const upload = await this.assertUploadReady(input.uploadId, input.factoryId, "DAILY_PRODUCTION");

    if (upload.rowsAccepted !== input.acceptedRows.length) {
      throw new ImportApplyError("Accepted row count does not match preview");
    }

    const updatedStages = await this.db.$transaction(async (tx: any) => {
      const stages = [];

      for (const row of input.acceptedRows) {
        let order = await tx.order.findFirst({
          where: {
            factoryId: input.factoryId,
            orderNumber: row.orderNumber
          },
          include: {
            stages: true,
            samplingApprovals: true
          }
        });

        if (!order) {
          const deliveryDate = row.deliveryDate
            ? new Date(row.deliveryDate)
            : this.getDefaultDailyProductionDeliveryDate();

          if (Number.isNaN(deliveryDate.getTime())) {
            throw new ImportApplyError(`Invalid delivery date for order ${row.orderNumber}`);
          }

          const workflow = await this.getDefaultWorkflowTemplate(input.factoryId, tx);

          if (!workflow || workflow.stages.length === 0) {
            throw new ImportApplyError("No active workflow template is configured for new daily production orders");
          }

          const stageExists = workflow.stages.some((stage: any) => stage.code === row.stageCode);

          if (!stageExists) {
            throw new ImportApplyError(`Stage ${row.stageCode} does not exist in the default active workflow`);
          }

          order = await tx.order.create({
            data: {
              factoryId: input.factoryId,
              workflowTemplateId: workflow.id,
              orderNumber: row.orderNumber,
              buyerName: row.buyerName,
              productCategory: row.description || row.styleName,
              orderQuantity: row.orderQuantity,
              deliveryDate,
              currentStageCode: row.stageCode,
              stages: {
                create: workflow.stages.map((stage: any) => ({
                  workflowStageId: stage.id,
                  stageCode: stage.code,
                  stageName: stage.name,
                  plannedQuantity: row.orderQuantity
                }))
              }
            },
            include: {
              stages: true,
              samplingApprovals: true
            }
          });
        } else if (row.deliveryDate) {
          const deliveryDate = new Date(row.deliveryDate);

          if (Number.isNaN(deliveryDate.getTime())) {
            throw new ImportApplyError(`Invalid delivery date for order ${row.orderNumber}`);
          }

          if (deliveryDate.getTime() !== order.deliveryDate.getTime()) {
            order = await tx.order.update({
              where: {
                id: order.id
              },
              data: {
                deliveryDate
              },
              include: {
                stages: true,
                samplingApprovals: true
              }
            });
          }
        }

        const orderStage = order.stages.find((stage: any) => stage.stageCode === row.stageCode);

        if (!orderStage) {
          throw new ImportApplyError(`Stage ${row.stageCode} does not exist on order ${row.orderNumber}`);
        }

        if (row.completedQuantity < orderStage.completedQuantity) {
          throw new ImportApplyError(
            `completedQuantity ${row.completedQuantity} is lower than current recorded quantity ${orderStage.completedQuantity}`
          );
        }

        const workflowStage = await tx.workflowStage.findUnique({
          where: {
            id: orderStage.workflowStageId
          }
        });

        if (!workflowStage) {
          throw new ImportApplyError(`Workflow stage not found for ${row.stageCode}`);
        }

        const mapping = await this.resolveUnitMapping({
          factoryId: input.factoryId,
          rowColorHex: row.rowColorHex,
          productionStatus: row.productionStatus,
          db: tx
        });

        if ((row.rowColorHex || row.productionStatus) && !mapping) {
          throw new ImportApplyError(`No active unit color mapping found for ${row.rowColorHex || row.productionStatus}`);
        }

        const completedDelta = row.completedQuantity - orderStage.completedQuantity;
        const existingInventory = await tx.stageInventory.findFirst({
          where: {
            orderId: order.id,
            workflowStageId: orderStage.workflowStageId
          }
        });
        const inventoryDelta = row.completedQuantity - (existingInventory?.quantity ?? 0);
        const inventory = new InventoryService(tx);

        if (inventoryDelta > 0) {
          await inventory.addInventory({
            orderId: order.id,
            workflowStageId: orderStage.workflowStageId,
            quantity: inventoryDelta
          });
        } else if (inventoryDelta < 0) {
          await inventory.removeInventory({
            orderId: order.id,
            workflowStageId: orderStage.workflowStageId,
            quantity: Math.abs(inventoryDelta)
          });
        }

        const updatedStage = await tx.orderStage.update({
          where: {
            id: orderStage.id
          },
          data: {
            completedQuantity: row.completedQuantity,
            currentQuantity: row.completedQuantity,
            scrappedQuantity: row.rejectedQuantity,
            reworkedQuantity: row.reworkQuantity,
            startedAt: orderStage.startedAt ?? new Date(row.updateDate),
            completedAt: row.completedQuantity >= orderStage.plannedQuantity ? new Date(row.updateDate) : orderStage.completedAt
          }
        });

        const orderLine = await tx.orderLine.upsert({
          where: {
            orderId_colorName: {
              orderId: order.id,
              colorName: row.colorName
            }
          },
          update: {
            productionUnitId: mapping?.productionUnitId ?? row.productionUnitId,
            buyerName: row.buyerName,
            styleName: row.styleName,
            description: row.description,
            orderQuantity: row.orderQuantity,
            cuttingTotalQty: row.cuttingTotalQuantity,
            cuttingToLineBal: row.cuttingToLineBalanceQuantity,
            lineLoadingQty: row.lineLoadingQuantity,
            todayLineOutQty: row.todayLineOutQuantity,
            totalLineOutQty: row.totalLineOutQuantity,
            lineInBalanceQty: row.lineInBalanceQuantity,
            productionStatus: mapping?.productionStatus ?? row.productionStatus,
            rowColorHex: row.rowColorHex,
            lastUpdatedAt: new Date(row.updateDate)
          },
          create: {
            orderId: order.id,
            productionUnitId: mapping?.productionUnitId ?? row.productionUnitId,
            buyerName: row.buyerName,
            styleName: row.styleName,
            colorName: row.colorName,
            description: row.description,
            orderQuantity: row.orderQuantity,
            cuttingTotalQty: row.cuttingTotalQuantity,
            cuttingToLineBal: row.cuttingToLineBalanceQuantity,
            lineLoadingQty: row.lineLoadingQuantity,
            todayLineOutQty: row.todayLineOutQuantity,
            totalLineOutQty: row.totalLineOutQuantity,
            lineInBalanceQty: row.lineInBalanceQuantity,
            productionStatus: mapping?.productionStatus ?? row.productionStatus,
            rowColorHex: row.rowColorHex,
            lastUpdatedAt: new Date(row.updateDate)
          }
        });

        if (completedDelta > 0) {
          await tx.materialMovement.create({
            data: {
              orderId: order.id,
              fromStageCode: null,
              toStageCode: row.stageCode,
              quantity: completedDelta,
              movementType: workflowStage.isDispatchStage ? "DISPATCH" : "FORWARD",
              notes: row.notes ?? `Daily production update from upload ${input.uploadId}${mapping?.productionUnit?.name ? ` (${mapping.productionUnit.name})` : ""}`
            }
          });
        }

        const nextStatus = workflowStage.isDispatchStage && row.completedQuantity >= orderStage.plannedQuantity
          ? "DISPATCHED"
          : "RUNNING";

        await tx.order.update({
          where: {
            id: order.id
          },
          data: {
            currentStageCode: row.stageCode,
            status: nextStatus
          }
        });

        await new TimelineService(tx).createEvent({
          factoryId: input.factoryId,
          orderId: order.id,
          type: workflowStage.isDispatchStage ? "DISPATCH_COMPLETED" : "MATERIAL_MOVED",
          message: `${order.orderNumber} updated at ${row.stageCode}: ${row.completedQuantity} complete.`,
          metadata: {
            uploadId: input.uploadId,
            rowNumber: row.rowNumber,
            stageCode: row.stageCode,
            completedQuantity: row.completedQuantity,
            completedDelta,
            rejectedQuantity: row.rejectedQuantity,
            reworkQuantity: row.reworkQuantity,
            updateDate: row.updateDate,
            buyerName: row.buyerName,
            styleName: row.styleName,
            colorName: row.colorName,
            orderLineId: orderLine.id,
            rowColorHex: row.rowColorHex,
            productionStatus: mapping?.productionStatus ?? row.productionStatus,
            productionUnitId: mapping?.productionUnitId ?? row.productionUnitId,
            productionUnitCode: mapping?.productionUnit?.code ?? row.productionUnitCode,
            productionUnitName: mapping?.productionUnit?.name ?? row.productionUnitName
          },
          createdBy: input.approvedBy,
          source: "daily-production-import-engine"
        });

        stages.push(updatedStage);
      }

      await tx.upload.update({
        where: {
          id: input.uploadId
        },
        data: {
          status: "APPLIED"
        }
      });

      await new TimelineService(tx).createEvent({
        factoryId: input.factoryId,
        type: "IMPORT_APPROVED",
        message: `Daily production import ${input.uploadId} applied.`,
        metadata: {
          uploadId: input.uploadId,
          updatedStages: stages.length
        },
        createdBy: input.approvedBy,
        source: "daily-production-import-engine"
      });

      return stages;
    });

    return {
      success: true,
      updatedStages
    };
  }
}
