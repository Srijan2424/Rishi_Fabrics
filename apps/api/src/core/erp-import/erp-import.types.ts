export type ImportSourceType = "CSV" | "EXCEL" | "PDF" | "IMAGE" | "MANUAL";

export interface ImportSourceConfig {
  sourceType: ImportSourceType;
  label: string;
  extensions: string[];
  enabled: boolean;
  parserMode: "NATIVE_TABLE_TEXT" | "EXTRACTED_TABLE_TEXT";
  requiresExtraction: boolean;
  extractionHint: string;
}

export interface ParsedOrderImportRow {
  rowNumber: number;
  orderNumber: string;
  buyerName: string;
  productCategory: string;
  orderQuantity: number;
  deliveryDate: string;
  workflowTemplateId: string;
}

export interface RejectedImportRow {
  rowNumber: number;
  row: Record<string, string>;
  errors: string[];
}

export interface ImportPreviewResult {
  uploadId: string;
  status: "PREVIEW_READY" | "PREVIEW_HAS_ERRORS";
  rowsReceived: number;
  acceptedRows: ParsedOrderImportRow[];
  rejectedRows: RejectedImportRow[];
}

export interface PreviewOrderImportInput {
  factoryId: string;
  fileName: string;
  sourceType: ImportSourceType;
  importText: string;
  createdBy?: string;
}

export type PreviewOrderCsvInput = Omit<PreviewOrderImportInput, "importText"> & {
  importText?: string;
  csvText?: string;
};

export interface ApplyOrderImportInput {
  uploadId: string;
  factoryId: string;
  acceptedRows: ParsedOrderImportRow[];
  approvedBy?: string;
}

export type ImportKind = "ORDER" | "TECH_PACK" | "DAILY_PRODUCTION";

export interface ParsedTechPackImportRow {
  rowNumber: number;
  orderNumber: string;
  checkpointCode: string;
  status: "PENDING" | "SUBMITTED" | "APPROVED" | "REVISION_REQUIRED";
  comments?: string;
  evidence?: string;
  submittedAt?: string;
  approvedAt?: string;
}

export interface ParsedDailyProductionImportRow {
  rowNumber: number;
  orderNumber: string;
  buyerName: string;
  styleName: string;
  colorName: string;
  description?: string;
  orderQuantity: number;
  stageCode: string;
  completedQuantity: number;
  cuttingTotalQuantity: number;
  cuttingToLineBalanceQuantity: number;
  lineLoadingQuantity: number;
  todayLineOutQuantity: number;
  totalLineOutQuantity: number;
  lineInBalanceQuantity: number;
  rejectedQuantity: number;
  reworkQuantity: number;
  productionStatus?: string;
  rowColorHex?: string;
  productionUnitId?: string;
  productionUnitCode?: string;
  productionUnitName?: string;
  deliveryDate?: string;
  orderExists?: boolean;
  requiresDeliveryDate?: boolean;
  orderAction?: "CREATE" | "UPDATE";
  updateDate: string;
  notes?: string;
}

export interface ImportPreviewResultForRows<TAcceptedRow> {
  uploadId: string;
  status: "PREVIEW_READY" | "PREVIEW_HAS_ERRORS";
  rowsReceived: number;
  acceptedRows: TAcceptedRow[];
  rejectedRows: RejectedImportRow[];
}

export interface PreviewTypedImportInput {
  factoryId: string;
  fileName: string;
  sourceType: ImportSourceType;
  importText: string;
  createdBy?: string;
}

export interface ApplyTechPackImportInput {
  uploadId: string;
  factoryId: string;
  acceptedRows: ParsedTechPackImportRow[];
  approvedBy?: string;
}

export interface ApplyDailyProductionImportInput {
  uploadId: string;
  factoryId: string;
  acceptedRows: ParsedDailyProductionImportRow[];
  approvedBy?: string;
}
