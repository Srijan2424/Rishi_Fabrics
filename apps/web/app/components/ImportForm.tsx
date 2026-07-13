"use client";

import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { ReportIssueButton } from "./ReportIssueButton";
import { authFetch } from "../lib/client-api";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";
const sampleImportDate = "2026-06-23T00:00:00.000Z";

type Factory = {
  id: string;
  name: string;
};

type Workflow = {
  id: string;
  name: string;
};

type ImportKind = "DAILY_PRODUCTION" | "WIP_REPORT" | "FABRIC_DYEING" | "TECH_PACK";
type SourceType = "CSV" | "MANUAL" | "EXCEL" | "PDF" | "IMAGE";

type AcceptedRow = {
  rowNumber: number;
  values?: Record<string, string>;
  orderNumber?: string;
  buyerName?: string;
  styleName?: string;
  colorName?: string;
  description?: string;
  productCategory?: string;
  orderQuantity?: number;
  deliveryDate?: string;
  workflowTemplateId?: string;
  checkpointCode?: string;
  status?: string;
  comments?: string;
  evidence?: string;
  approvedAt?: string;
  stageCode?: string;
  completedQuantity?: number;
  cuttingTotalQuantity?: number;
  cuttingToLineBalanceQuantity?: number;
  lineLoadingQuantity?: number;
  todayLineOutQuantity?: number;
  totalLineOutQuantity?: number;
  lineInBalanceQuantity?: number;
  rejectedQuantity?: number;
  reworkQuantity?: number;
  productionStatus?: string;
  rowColorHex?: string;
  productionUnitName?: string;
  orderExists?: boolean;
  requiresDeliveryDate?: boolean;
  orderAction?: "CREATE" | "UPDATE";
  updateDate?: string;
  notes?: string;
};

type RejectedRow = {
  rowNumber: number;
  errors: string[];
};

type PreviewResult = {
  uploadId?: string;
  status: string;
  rowsReceived: number;
  acceptedRows?: AcceptedRow[];
  rejectedRows?: RejectedRow[];
  message?: string;
  workbookExtraction?: {
    workbookKind: string;
    sheetName: string;
    updateDate?: string;
    rowsExtracted?: number;
    rowsRejectedDuringExtraction?: number;
    sampleRows?: Array<Record<string, unknown>>;
    warnings?: string[];
  };
};

type LocalFormatReport = {
  status: "READY" | "BLOCKED";
  messages: string[];
};

function explainRejection(error: string) {
  const text = error.toLowerCase();
  if (text.includes("missing required headers")) return { why: "The workbook/table does not contain a column the system needs to read this import type.", fix: "Use the expected file format or add the missing column names, then upload again." };
  if (text.includes("buyer") || text.includes("buyername")) return { why: "Buyer is needed to identify and group the order/style correctly.", fix: "Fill the BUYER column for this row, or make sure merged buyer cells carry into this row." };
  if (text.includes("style")) return { why: "Style is needed to create or match the garment/style record.", fix: "Fill the STYLE / STYLE NAME / STYLE NO field for this row." };
  if (text.includes("colour") || text.includes("color")) return { why: "Colour is needed because the system tracks production and fabric by style-colour.", fix: "Fill the COLOUR field, or check that merged colour cells are visible in this row." };
  if (text.includes("order qty") || text.includes("orderquantity")) return { why: "Order quantity must be a valid positive number for progress and reports.", fix: "Enter a positive numeric order quantity. Avoid blanks, text, or zero." };
  if (text.includes("stage") && text.includes("does not exist")) return { why: "The uploaded stage is not present in the active workflow configured for this order/company.", fix: "Check the production status/stage in the file or update the workflow/stage mapping in Settings." };
  if (text.includes("stagecode could not be inferred")) return { why: "The system could not decide which production stage this row belongs to.", fix: "Check cutting, line loading, total line out, production status, and colour/status mapping." };
  if (text.includes("unit color mapping") || text.includes("colour/status") || text.includes("color/status")) return { why: "The Excel row colour or production status is not mapped to an active unit/status in the system.", fix: "Configure the colour/status mapping before applying this Daily Production file." };
  if (text.includes("delivery date")) return { why: "A new order cannot be created without a delivery date.", fix: "Enter the delivery timeline/date for the new order before applying." };
  if (text.includes("lower than current recorded quantity")) return { why: "The upload would reduce already recorded production, which could erase prior progress.", fix: "Check whether the file is older than the current data. If it is a correction, report it or use a correction workflow." };
  if (text.includes("not a non-negative") || text.includes("must be a non-negative")) return { why: "This quantity cannot be negative for the current field.", fix: "Use zero or a positive number. For planning balance fields, only cutting-to-line balance may be negative." };
  if (text.includes("must be an integer")) return { why: "The field must be a whole number, not text or decimal values.", fix: "Replace the value with a whole number and upload again." };
  if (text.includes("unsupported workbook")) return { why: "The workbook does not match Daily Production, WIP, or Fabric/Dyeing formats currently configured.", fix: "Upload one of the supported formats or report it if this is a valid company format." };
  return { why: "The row did not match the current upload rules.", fix: "Review the exact error, correct the source file, and upload again. If the file is correct, report it to Admin." };
}

const importKindOptions: Array<{ value: ImportKind; label: string; description: string }> = [
  {
    value: "DAILY_PRODUCTION",
    label: "Daily Production",
    description: "Upload the daily production workbook to preview cutting, line loading, line out, row colours, rejections, and rework."
  },
  {
    value: "WIP_REPORT",
    label: "WIP Report",
    description: "Extract unit-wise WIP as a reporting source. This preview does not mutate production quantities yet."
  },
  {
    value: "FABRIC_DYEING",
    label: "Fabric / Dyeing",
    description: "Extract fabric and dyeing pipeline status as a reporting source. This preview does not mutate production quantities yet."
  },
  {
    value: "TECH_PACK",
    label: "Tech Pack",
    description: "Update sampling approval checkpoints from merchant tech-pack data."
  }
];

const sourceTypeOptions: Array<{ value: SourceType; label: string }> = [
  { value: "CSV", label: "CSV" },
  { value: "MANUAL", label: "Manual Paste / TSV" },
  { value: "EXCEL", label: "Excel" },
  { value: "PDF", label: "PDF" },
  { value: "IMAGE", label: "Image / Scan" }
];

const allowedExtensionsBySourceType: Record<SourceType, string[]> = {
  CSV: [".csv"],
  MANUAL: [".tsv", ".txt"],
  EXCEL: [".xlsx", ".xls"],
  PDF: [".pdf"],
  IMAGE: [".png", ".jpg", ".jpeg", ".webp"]
};

const requiredColumns: Record<ImportKind, string[]> = {
  DAILY_PRODUCTION: [
    "orderNumber",
    "buyerName",
    "styleName",
    "colorName",
    "orderQuantity",
    "cuttingTotalQuantity",
    "lineLoadingQuantity",
    "totalLineOutQuantity",
    "productionStatus",
    "rowColorHex",
    "productionUnitName",
    "orderAction",
    "deliveryDate",
    "updateDate",
    "notes"
  ],
  WIP_REPORT: [
    "unitName",
    "styleName",
    "colorName",
    "quantity",
    "comments"
  ],
  FABRIC_DYEING: [
    "buyerName",
    "styleName",
    "colorName",
    "fabricDescription",
    "fabricSentForDyeingKg",
    "inhouseAfterDyeingKg",
    "status"
  ],
  TECH_PACK: [
    "orderNumber",
    "checkpointCode",
    "status",
    "comments",
    "evidence",
    "approvedAt"
  ]
};

const headerAliases: Record<ImportKind, string[][]> = {
  DAILY_PRODUCTION: [
    ["orderNumber", "BUYER"],
    ["STYLE", "styleName"],
    ["COLOUR", "COLOR", "colorName"],
    ["ORDER QTY.", "ORDER QTY", "orderQuantity"],
    ["TOTAL LINE OUT", "LINE LOADING", "CUTTING TOTAL QTY", "completedQuantity"],
    ["PRODUCTION STATUS", "productionStatus"],
    ["rowColorHex", "ROW COLOR HEX", "COLOR HEX"]
  ],
  WIP_REPORT: [
    ["unitName", "UNIT"],
    ["styleName", "STYLE"],
    ["quantity", "QTY"]
  ],
  FABRIC_DYEING: [
    ["buyerName", "BUYER"],
    ["styleName", "STYLE"],
    ["colorName", "COLOUR", "COLOR"],
    ["status", "STATUS"]
  ],
  TECH_PACK: [
    ["orderNumber"],
    ["checkpointCode"],
    ["status"]
  ]
};

const previewEndpointByKind: Partial<Record<ImportKind, string>> = {
  TECH_PACK: "/erp-import/preview-tech-pack",
  DAILY_PRODUCTION: "/erp-import/preview-daily-production"
};

const applyEndpointByKind: Partial<Record<ImportKind, string>> = {
  TECH_PACK: "/erp-import/apply-tech-pack",
  DAILY_PRODUCTION: "/erp-import/apply-daily-production",
  WIP_REPORT: "/erp-import/apply-extracted-workbook",
  FABRIC_DYEING: "/erp-import/apply-extracted-workbook"
};

const workbookKindByImportKind: Partial<Record<ImportKind, "DAILY_PRODUCTION" | "WIP" | "FABRIC_DYEING">> = {
  DAILY_PRODUCTION: "DAILY_PRODUCTION",
  WIP_REPORT: "WIP",
  FABRIC_DYEING: "FABRIC_DYEING"
};

function getSourceTypeFromFileName(fileName: string): SourceType {
  const extension = fileName.split(".").pop()?.toLowerCase();

  if (extension === "xlsx" || extension === "xls") return "EXCEL";
  if (extension === "pdf") return "PDF";
  if (extension === "png" || extension === "jpg" || extension === "jpeg" || extension === "webp") return "IMAGE";
  if (extension === "tsv" || extension === "txt") return "MANUAL";
  return "CSV";
}

function getFileExtension(fileName: string) {
  const extension = fileName.includes(".") ? `.${fileName.split(".").pop()?.toLowerCase()}` : "";
  return extension;
}

function parseHeaders(importText: string, sourceType: SourceType) {
  const firstLine = importText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0) ?? "";
  const delimiter = sourceType === "MANUAL" && firstLine.includes("\t") ? "\t" : ",";

  return firstLine.split(delimiter).map((header) => header.trim());
}

function validateLocalFormat(input: {
  importKind: ImportKind;
  sourceType: SourceType;
  fileName: string;
  importText: string;
  hasDirectWorkbookFile?: boolean;
}): LocalFormatReport {
  const messages: string[] = [];
  const extension = getFileExtension(input.fileName);
  const allowedExtensions = allowedExtensionsBySourceType[input.sourceType];

  if (extension && !allowedExtensions.includes(extension)) {
    messages.push(`${input.fileName} does not match selected source type ${input.sourceType}. Allowed: ${allowedExtensions.join(", ")}`);
  }

  if (!input.importText.trim() && !input.hasDirectWorkbookFile) {
    messages.push("No extracted table rows or Excel workbook file found. Paste extracted rows or upload an .xlsx workbook before preview.");
  }

  if (input.sourceType === "EXCEL" && input.hasDirectWorkbookFile && extension !== ".xlsx") {
    messages.push("Direct Excel extraction currently supports .xlsx workbooks only.");
  }

  if (input.sourceType === "EXCEL" && input.importKind === "DAILY_PRODUCTION" && !input.hasDirectWorkbookFile && !input.importText.includes("rowColorHex")) {
    messages.push("Daily Excel text imports must include rowColorHex. Upload the .xlsx workbook directly to extract row colors automatically.");
  }

  if ((input.importKind === "WIP_REPORT" || input.importKind === "FABRIC_DYEING") && !input.hasDirectWorkbookFile) {
    messages.push(`${input.importKind === "WIP_REPORT" ? "WIP Report" : "Fabric / Dyeing"} requires a direct .xlsx workbook upload.`);
  }

  if (input.importText.trim() && input.importKind !== "WIP_REPORT" && input.importKind !== "FABRIC_DYEING") {
    const headers = parseHeaders(input.importText, input.sourceType);
    const missingGroups = headerAliases[input.importKind].filter((aliases) =>
      !aliases.some((alias) => headers.includes(alias))
    );

    if (missingGroups.length > 0) {
      messages.push(`Missing required header groups: ${missingGroups.map((group) => group.join(" or ")).join("; ")}`);
    }
  }

  return {
    status: messages.length > 0 ? "BLOCKED" : "READY",
    messages
  };
}

async function readResponseBody(response: Response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      error: text
    };
  }
}

function formatCell(value: unknown) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toLocaleDateString();
  }
  return String(value);
}

export function ImportForm({ defaultFactory, workflows }: { defaultFactory?: Factory; workflows: Workflow[] }) {
  const router = useRouter();
  const factoryId = defaultFactory?.id ?? "";
  const [importKind, setImportKind] = useState<ImportKind>("DAILY_PRODUCTION");
  const [sourceType, setSourceType] = useState<SourceType>("EXCEL");
  const [fileName, setFileName] = useState("daily-production.xlsx");
  const [importText, setImportText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [formatReport, setFormatReport] = useState<LocalFormatReport | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);

  const selectedImportKind = importKindOptions.find((option) => option.value === importKind) ?? importKindOptions[0];

  const sampleText = useMemo(() => {
    if (importKind === "TECH_PACK") {
      return [
        "orderNumber,checkpointCode,status,comments,evidence,approvedAt",
        `TP-SMOKE-1001,LAB_DIP_APPROVAL,APPROVED,Buyer approved lab dip,Approval reference TP-001,${sampleImportDate}`
      ].join("\n");
    }

    if (importKind === "DAILY_PRODUCTION") {
      return [
        "orderNumber,BUYER,STYLE,COLOUR,DESC.,ORDER QTY.,CUTTING TOTAL QTY,CUTTING TO LINE IN BAL,LINE LOADING,TODAY LINE OUT,TOTAL LINE OUT, LINE IN BAL,PRODUCTION STATUS,rowColorHex,updateDate,notes",
        `DP-SMOKE-1001,Smoke Buyer,Production Tee,BLACK,T-SHIRT,200,120,0,120,25,25,95,RUNNING PROD.,FF92D050,${sampleImportDate},Daily production update`
      ].join("\n");
    }

    return "Upload the .xlsx workbook directly for extraction.";
  }, [importKind]);

  function resetPreviewState() {
    setPreview(null);
    setError("");
    setFormatReport(null);
  }

  function onImportKindChanged(nextKind: ImportKind) {
    setImportKind(nextKind);
    setFileName(
      nextKind === "TECH_PACK"
        ? "sampling-tech-pack.csv"
        : nextKind === "WIP_REPORT"
          ? "wip-report.xlsx"
          : nextKind === "FABRIC_DYEING"
            ? "fabric-dyeing.xlsx"
            : "daily-production.xlsx"
    );
    setSourceType(nextKind === "TECH_PACK" ? "CSV" : "EXCEL");
    setImportText("");
    setSelectedFile(null);
    resetPreviewState();
  }

  function onFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const detectedSourceType = getSourceTypeFromFileName(file.name);
    const extension = getFileExtension(file.name);

    if (!Object.values(allowedExtensionsBySourceType).flat().includes(extension)) {
      setError(`Unsupported file type: ${extension || "unknown"}. Accepted: CSV, TSV, TXT, XLSX, XLS, PDF, PNG, JPG, JPEG, WEBP.`);
      setFileName(file.name);
      setImportText("");
      setPreview(null);
      setFormatReport({
        status: "BLOCKED",
        messages: [`Unsupported file type: ${extension || "unknown"}`]
      });
      return;
    }

    setFileName(file.name);
    setSelectedFile(file);
    setSourceType(detectedSourceType);
    resetPreviewState();

    if (detectedSourceType === "EXCEL" || detectedSourceType === "PDF" || detectedSourceType === "IMAGE") {
      setImportText("");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setImportText(String(reader.result ?? ""));
    };
    reader.readAsText(file);
  }

  async function onPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setPreview(null);

    const localReport = validateLocalFormat({
      importKind,
      sourceType,
      fileName,
      importText,
      hasDirectWorkbookFile: sourceType === "EXCEL" && selectedFile !== null
    });
    setFormatReport(localReport);

    if (localReport.status === "BLOCKED") {
      setSaving(false);
      setError("Format test failed. Fix the listed issues before preview.");
      return;
    }

    try {
      const hasDirectWorkbookFile = sourceType === "EXCEL" && selectedFile !== null;
      const response = hasDirectWorkbookFile
        ? await authFetch(`${apiUrl}/erp-import/preview-workbook`, {
          method: "POST",
          credentials: "include",
          body: (() => {
            const formData = new FormData();
            formData.append("factoryId", factoryId);
            formData.append("importKind", workbookKindByImportKind[importKind] ?? "AUTO");
            formData.append("file", selectedFile);
            return formData;
          })()
        })
        : previewEndpointByKind[importKind]
          ? await authFetch(`${apiUrl}${previewEndpointByKind[importKind]}`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            factoryId,
            fileName,
            sourceType,
            importText
          })
        })
          : new Response(JSON.stringify({ error: "This import type requires a direct .xlsx workbook upload." }), { status: 400 });

      const body = await readResponseBody(response);

      if (!response.ok) {
        setError(body.error ?? `Import preview failed with status ${response.status}`);
        return;
      }

      const nextPreview = body as PreviewResult;
      setPreview({
        ...nextPreview,
        acceptedRows: nextPreview.acceptedRows?.map((row) => ({
          ...row,
          deliveryDate: row.deliveryDate ? row.deliveryDate.slice(0, 10) : ""
        }))
      });
      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? `Import preview failed: ${error.message}. Make sure the real API is running with npm run dev:api.`
          : "Import preview failed. Make sure the real API is running."
      );
    } finally {
      setSaving(false);
    }
  }

  async function onApply() {
    const applyEndpoint = applyEndpointByKind[importKind];

    if (!preview || !applyEndpoint || (preview.rejectedRows ?? []).length > 0) {
      return;
    }

    setApplying(true);
    setError("");

    try {
      const response = await authFetch(`${apiUrl}${applyEndpoint}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(
          importKind === "WIP_REPORT" || importKind === "FABRIC_DYEING"
            ? {
              factoryId,
              fileName,
              workbookKind: workbookKindByImportKind[importKind],
              acceptedRows: preview.acceptedRows
            }
            : {
              uploadId: preview.uploadId,
              factoryId,
              acceptedRows: preview.acceptedRows
            }
        )
      });

      const body = await readResponseBody(response);

      if (!response.ok) {
        setError(body.error ?? `Import apply failed with status ${response.status}`);
        return;
      }

      setPreview(null);
      setImportText("");
      setSelectedFile(null);
      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? `Import apply failed: ${error.message}. Make sure the real API is running with npm run dev:api.`
          : "Import apply failed. Make sure the real API is running."
      );
    } finally {
      setApplying(false);
    }
  }

  const acceptedRows = preview?.acceptedRows ?? [];
  const rejectedRows = preview?.rejectedRows ?? [];
  const dailyProductionMissingDeliveryDate = false;
  const canApplyPreview = Boolean(
    applyEndpointByKind[importKind] &&
    rejectedRows.length === 0 &&
    acceptedRows.length > 0 &&
    (preview?.uploadId || importKind === "WIP_REPORT" || importKind === "FABRIC_DYEING")
  );
  const previewColumns = requiredColumns[importKind].filter((column) => column !== "workflowTemplateId");
  const sampleRows = preview?.workbookExtraction?.sampleRows?.length
    ? preview.workbookExtraction.sampleRows.slice(0, 5)
    : (acceptedRows.slice(0, 5).map((row) => ({ ...row })) as Array<Record<string, unknown>>) ?? [];
  const sampleColumns = sampleRows.length > 0
    ? Object.keys(sampleRows[0]).filter((column) => column !== "rowNumber").slice(0, 12)
    : [];

  function updateAcceptedRow(rowNumber: number, changes: Partial<AcceptedRow>) {
    setPreview((current) => {
      if (!current) return current;

      return {
        ...current,
        acceptedRows: current.acceptedRows?.map((row) => (
          row.rowNumber === rowNumber ? { ...row, ...changes } : row
        ))
      };
    });
  }

  return (
    <div>
      <form className="form" onSubmit={onPreview}>
        <div className="wide import-context">
          <strong>Default site</strong>
          <span>{defaultFactory?.name ?? "No company/site configured. Create it in Settings before importing."}</span>
        </div>

        <label>
          Import Type
          <select value={importKind} onChange={(event) => onImportKindChanged(event.target.value as ImportKind)} required>
            {importKindOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <div className="wide import-type-card">
          <strong>{selectedImportKind.label}</strong>
          <span>{selectedImportKind.description}</span>
        </div>

        <div className="wide import-rules">
          <strong>Format test before acceptance</strong>
          <span>
            This screen tests source type, extension, extracted headers, and required row fields before API preview.
            Apply remains blocked unless preview returns zero rejected rows.
          </span>
        </div>

        <label>
          File Name
          <input value={fileName} onChange={(event) => setFileName(event.target.value)} required />
        </label>

        <label>
          Upload File
          <input
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp"
            onChange={onFileSelected}
          />
        </label>

        <label>
          Source Type
          <select value={sourceType} onChange={(event) => setSourceType(event.target.value as SourceType)} required>
            {sourceTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <div className="wide required-columns">
          <span>Required columns</span>
          <div>
            {requiredColumns[importKind].map((column) => (
              <code key={column}>{column}</code>
            ))}
          </div>
        </div>

        <label className="wide">
          Import Data
          <textarea
            rows={9}
            value={importText}
            onChange={(event) => {
              setImportText(event.target.value);
              setSelectedFile(null);
              resetPreviewState();
            }}
            placeholder={
              sourceType === "CSV" || sourceType === "MANUAL"
                ? sampleText
                : sourceType === "EXCEL"
          ? "Upload the .xlsx workbook directly, or paste extracted rows with rowColorHex."
          : "Paste extracted table rows here. For PDF/Image, extract or OCR the table first, then preview."
            }
            required={!(sourceType === "EXCEL" && selectedFile)}
          />
        </label>

        <div className="form-help wide">
          <button className="button-secondary" type="button" onClick={() => setImportText(sampleText)}>
            Use Sample Rows
          </button>
          <p>
            Preview validates the file and creates an audit record. Apply is the only step that changes sampling or
            production data.
          </p>
        </div>

        <button type="submit" disabled={saving || !factoryId || (!importText.trim() && !(sourceType === "EXCEL" && selectedFile))}>
          {saving ? "Testing..." : "Test Format & Preview"}
        </button>
      </form>

      {error ? <div className="form-message error">{error}</div> : null}

      {formatReport ? (
        <div className={`form-message ${formatReport.status === "READY" ? "success" : "error"}`}>
          <strong>{formatReport.status === "READY" ? "Format test passed." : "Format test failed."}</strong>
          {formatReport.messages.length > 0 ? (
            <ul>
              {formatReport.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : (
            <span> The document can proceed to API preview.</span>
          )}
        </div>
      ) : null}

      {preview ? (
        <div className="preview-box">
          <div className="preview-summary">
            <span>Status: {preview.status}</span>
            <span>Rows: {preview.rowsReceived}</span>
            <span>Accepted: {acceptedRows.length}</span>
            <span>Rejected: {rejectedRows.length}</span>
            {preview.workbookExtraction ? <span>Workbook: {preview.workbookExtraction.workbookKind}</span> : null}
          </div>

          {preview.message ? <div className="form-message success">{preview.message}</div> : null}

          {preview.workbookExtraction ? (
            <div className="form-message success">
              Extracted sheet {preview.workbookExtraction.sheetName}
              {preview.workbookExtraction.rowsExtracted !== undefined ? `, ${preview.workbookExtraction.rowsExtracted} workbook rows` : ""}.
            </div>
          ) : null}

          {sampleRows.length > 0 ? (
            <div>
              <strong>File Sample - First 5 Rows</strong>
              <table className="table">
                <thead>
                  <tr>
                    <th>Row</th>
                    {sampleColumns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.map((row, index) => (
                    <tr key={String(row.rowNumber ?? index)}>
                      <td>{formatCell(row.rowNumber)}</td>
                      {sampleColumns.map((column) => (
                        <td key={column}>{formatCell(row[column])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {rejectedRows.length > 0 ? (
            <div>
              <strong>Rejected Rows</strong>
              <table className="table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {rejectedRows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td>
                        <div className="rejection-explanations">
                          {row.errors.map((item) => {
                            const explanation = explainRejection(item);
                            return (
                              <div key={item} className="rejection-explanation">
                                <strong>{item}</strong>
                                <span>Why: {explanation.why}</span>
                                <span>What to change: {explanation.fix}</span>
                              </div>
                            );
                          })}
                          <ReportIssueButton
                            title={"Upload rejection may be incorrect: " + selectedImportKind.label}
                            module="IMPORTS"
                            linkedType="upload"
                            linkedId={preview.uploadId}
                            context={{ importKind, fileName, rowNumber: row.rowNumber, errors: row.errors }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : acceptedRows.length > 0 ? (
            <div>
              <strong>Accepted Rows</strong>
              {importKind === "DAILY_PRODUCTION" ? (
                <div className="form-message success">
                  New orders can be applied now. If a delivery date is not edited here, the system uses a 60 day default and the order date can be edited later.
                </div>
              ) : null}
              <table className="table">
                <thead>
                  <tr>
                    <th>Row</th>
                    {previewColumns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {acceptedRows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      {previewColumns.map((column) => (
                        <td key={column}>
                          {importKind === "DAILY_PRODUCTION" && column === "deliveryDate" ? (
                            <input
                              className="table-input"
                              type="date"
                              value={row.deliveryDate ?? ""}
                              onChange={(event) => updateAcceptedRow(row.rowNumber, { deliveryDate: event.target.value })}
                              required
                            />
                          ) : (
                            formatCell(row.values?.[column] ?? row[column as keyof AcceptedRow])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {canApplyPreview ? (
                <button className="apply-button" type="button" onClick={onApply} disabled={applying}>
                  {applying ? "Saving..." : importKind === "WIP_REPORT" || importKind === "FABRIC_DYEING" ? `Save ${selectedImportKind.label}` : `Apply ${selectedImportKind.label}`}
                </button>
              ) : null}
            </div>
          ) : preview.workbookExtraction ? (
            <div className="form-message success">Extraction completed. This import type is available as a reporting source and does not apply production changes yet.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
