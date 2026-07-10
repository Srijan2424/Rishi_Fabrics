import ExcelJS from "exceljs";

export type WorkbookImportKind = "DAILY_PRODUCTION" | "WIP" | "FABRIC_DYEING";

export interface ExtractedWorkbookRow {
  rowNumber: number;
  rowColorHex?: string;
  values: Record<string, string>;
}

export interface WorkbookExtractionResult {
  workbookKind: WorkbookImportKind;
  sheetName: string;
  updateDate?: string;
  rowsReceived: number;
  acceptedRows: ExtractedWorkbookRow[];
  rejectedRows: Array<{ rowNumber: number; errors: string[] }>;
  extractedText?: string;
  warnings: string[];
}

const dailyProductionHeaders = [
  "orderNumber",
  "BUYER",
  "STYLE",
  "COLOUR",
  "DESC.",
  "ORDER QTY.",
  "CUTTING TOTAL QTY",
  "CUTTING TO LINE IN BAL",
  "LINE LOADING",
  "TODAY LINE OUT",
  "TOTAL LINE OUT",
  "LINE IN BAL",
  "PRODUCTION STATUS",
  "rowColorHex",
  "updateDate",
  "notes"
];

function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value && value.text) return String(value.text).trim();
    if ("result" in value && value.result !== undefined) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("").trim();
    }
    if ("hyperlink" in value && "text" in value) return String(value.text ?? "").trim();
  }
  return String(value).trim();
}

function cellNumber(value: ExcelJS.CellValue | undefined): string {
  const text = cellText(value).replace(/,/g, "");
  if (!text) return "";
  const number = Number(text);
  if (!Number.isFinite(number)) return text;
  return String(Math.round(number));
}

function numberFromCell(cell: ExcelJS.Cell): number | null {
  const value = cellNumber(cell.value);
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberTextFromCell(cell: ExcelJS.Cell, fallback?: number): string {
  const number = numberFromCell(cell);
  if (number !== null) return String(number);
  if (fallback !== undefined && Number.isFinite(fallback)) return String(Math.round(fallback));
  return "";
}

function cellDecimal(value: ExcelJS.CellValue | undefined): string {
  const text = cellText(value).replace(/,/g, "");
  if (!text) return "";
  const number = Number(text);
  if (!Number.isFinite(number)) return text;
  return String(number);
}

function cellDate(value: ExcelJS.CellValue | undefined): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const text = cellText(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function normalizeColor(value?: string): string | undefined {
  const color = value?.replace(/^#/, "").trim().toUpperCase();
  return color || undefined;
}

function cellFillColor(cell: ExcelJS.Cell): string | undefined {
  const fill = cell.fill;
  if (!fill || fill.type !== "pattern") return undefined;
  return normalizeColor(fill.fgColor?.argb ?? fill.bgColor?.argb);
}

function dominantRowColor(row: ExcelJS.Row, startCol: number, endCol: number): string | undefined {
  const counts = new Map<string, number>();
  for (let col = startCol; col <= endCol; col += 1) {
    const color = cellFillColor(row.getCell(col));
    if (color) counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}

function isTotalLabel(value: string): boolean {
  const normalized = value.toUpperCase();
  return normalized.includes("TOTAL") || normalized.includes("GRAND TOTAL");
}

function csvEscape(value: string | undefined): string {
  const text = value ?? "";
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows: ExtractedWorkbookRow[]): string {
  const lines = [dailyProductionHeaders.join(",")];
  for (const row of rows) {
    lines.push(dailyProductionHeaders.map((header) => csvEscape(row.values[header])).join(","));
  }
  return lines.join("\n");
}

function parseStyleColor(styleWithColor: string) {
  const match = styleWithColor.match(/^(.*)\(([^()]*)\)\s*$/);
  if (!match) return { styleName: styleWithColor.trim(), colorName: "" };
  return {
    styleName: match[1].trim().replace(/^'+/, ""),
    colorName: match[2].trim()
  };
}

function isUnsafeSheetName(name: string): boolean {
  return ["PASSWORD", "USER", "ADMIN", "LOGIN"].some((token) => name.toUpperCase().includes(token));
}

function detectWorkbookKind(workbook: ExcelJS.Workbook): { kind: WorkbookImportKind; worksheet: ExcelJS.Worksheet } {
  for (const worksheet of workbook.worksheets) {
    if (isUnsafeSheetName(worksheet.name)) continue;
    const title = worksheet.name.toUpperCase();
    const rowOne = worksheet.getRow(1).values?.toString().toUpperCase() ?? "";
    const rowTwo = worksheet.getRow(2).values?.toString().toUpperCase() ?? "";
    const rowThree = worksheet.getRow(3).values?.toString().toUpperCase() ?? "";

    if (title.includes("DPR") || rowOne.includes("DAILY PRODUCTION REPORT")) {
      return { kind: "DAILY_PRODUCTION", worksheet };
    }

    if (title === "WIP" || rowTwo.includes("WIP (UNIT-I)")) {
      return { kind: "WIP", worksheet };
    }

    if (title.includes("FABRIC") || rowOne.includes("FABRIC SHEET OF DYEING")) {
      return { kind: "FABRIC_DYEING", worksheet };
    }

    if (rowThree.includes("FABRIC SENT FOR DYEING") || rowThree.includes("DYEING PARTY")) {
      return { kind: "FABRIC_DYEING", worksheet };
    }
  }

  throw new Error("Unsupported workbook format. Expected Daily Production, WIP, or Fabric Dyeing workbook.");
}

function extractDailyProduction(worksheet: ExcelJS.Worksheet): WorkbookExtractionResult {
  const updateDate = cellDate(worksheet.getCell("J1").value) ?? new Date().toISOString();
  const acceptedRows: ExtractedWorkbookRow[] = [];
  const rejectedRows: Array<{ rowNumber: number; errors: string[] }> = [];

  for (let rowNumber = 5; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const buyerName = cellText(row.getCell(1).value);
    const styleName = cellText(row.getCell(2).value);
    const colorName = cellText(row.getCell(3).value);
    const description = cellText(row.getCell(4).value);
    const orderQuantity = cellNumber(row.getCell(5).value);
    const cuttingTotalQuantityNumber = numberFromCell(row.getCell(6)) ?? 0;
    const lineLoadingQuantityNumber = numberFromCell(row.getCell(8)) ?? 0;
    const totalLineOutQuantityNumber = numberFromCell(row.getCell(10)) ?? 0;
    const productionStatus = cellText(row.getCell(12).value);
    const firstLabel = buyerName || styleName;

    if (!firstLabel && !colorName && !orderQuantity) continue;
    if (isTotalLabel(firstLabel)) continue;

    const errors: string[] = [];
    if (!buyerName) errors.push("BUYER is required");
    if (!styleName) errors.push("STYLE is required");
    if (!colorName) errors.push("COLOUR is required");
    if (!orderQuantity || Number(orderQuantity) <= 0) errors.push("ORDER QTY. must be positive");

    if (errors.length > 0) {
      rejectedRows.push({ rowNumber, errors });
      continue;
    }

    const rowColorHex = dominantRowColor(row, 1, 12);
    const orderNumber = [buyerName, styleName, colorName]
      .join("-")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);

    acceptedRows.push({
      rowNumber,
      rowColorHex,
      values: {
        orderNumber,
        "BUYER": buyerName,
        "STYLE": styleName,
        "COLOUR": colorName,
        "DESC.": description,
        "ORDER QTY.": orderQuantity,
        "CUTTING TOTAL QTY": String(cuttingTotalQuantityNumber),
        "CUTTING TO LINE IN BAL": numberTextFromCell(row.getCell(7), cuttingTotalQuantityNumber - lineLoadingQuantityNumber) || "0",
        "LINE LOADING": String(lineLoadingQuantityNumber),
        "TODAY LINE OUT": cellNumber(row.getCell(9).value) || "0",
        "TOTAL LINE OUT": String(totalLineOutQuantityNumber),
        "LINE IN BAL": numberTextFromCell(row.getCell(11), lineLoadingQuantityNumber - totalLineOutQuantityNumber) || "0",
        "PRODUCTION STATUS": productionStatus,
        rowColorHex: rowColorHex ?? "",
        updateDate,
        notes: `Extracted from ${worksheet.name} row ${rowNumber}`
      }
    });
  }

  return {
    workbookKind: "DAILY_PRODUCTION",
    sheetName: worksheet.name,
    updateDate,
    rowsReceived: acceptedRows.length + rejectedRows.length,
    acceptedRows,
    rejectedRows,
    extractedText: toCsv(acceptedRows),
    warnings: rejectedRows.length ? ["Some production rows were rejected during workbook extraction."] : []
  };
}

function extractWip(worksheet: ExcelJS.Worksheet): WorkbookExtractionResult {
  const acceptedRows: ExtractedWorkbookRow[] = [];
  const rejectedRows: Array<{ rowNumber: number; errors: string[] }> = [];
  const unitBlocks = [
    { unitCode: "UNIT_I", unitName: "Unit-I", styleCol: 2, qtyCol: 3, commentsCol: 4 },
    { unitCode: "UNIT_II", unitName: "Unit-II", styleCol: 6, qtyCol: 7, commentsCol: 8 }
  ];

  for (let rowNumber = 4; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    for (const block of unitBlocks) {
      const styleRaw = cellText(row.getCell(block.styleCol).value);
      const qty = cellNumber(row.getCell(block.qtyCol).value);
      if (!styleRaw && !qty) continue;
      if (isTotalLabel(styleRaw)) continue;

      const errors: string[] = [];
      if (!styleRaw) errors.push("STYLE NO is required");
      if (!qty || Number(qty) < 0) errors.push("QTY must be a non-negative number");

      if (errors.length > 0) {
        rejectedRows.push({ rowNumber, errors });
        continue;
      }

      const parsed = parseStyleColor(styleRaw);
      acceptedRows.push({
        rowNumber,
        values: {
          unitCode: block.unitCode,
          unitName: block.unitName,
          styleName: parsed.styleName,
          colorName: parsed.colorName,
          quantity: qty,
          comments: cellText(row.getCell(block.commentsCol).value)
        }
      });
    }
  }

  return {
    workbookKind: "WIP",
    sheetName: worksheet.name,
    rowsReceived: acceptedRows.length + rejectedRows.length,
    acceptedRows,
    rejectedRows,
    warnings: ["WIP workbook is extracted as a unit snapshot. Applying it requires the WIP snapshot engine, not the daily production apply engine."]
  };
}

function extractFabricDyeing(worksheet: ExcelJS.Worksheet): WorkbookExtractionResult {
  const acceptedRows: ExtractedWorkbookRow[] = [];
  const rejectedRows: Array<{ rowNumber: number; errors: string[] }> = [];
  const updateDate = cellDate(worksheet.getCell("O1").value) ?? undefined;
  let buyerName = "";
  let styleName = "";
  let fabricDescription = "";
  let colorName = "";

  for (let rowNumber = 4; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const buyerCell = cellText(row.getCell(1).value);
    const styleCell = cellText(row.getCell(2).value);
    const colorCell = cellText(row.getCell(3).value);
    const fabricCell = cellText(row.getCell(4).value);

    if (buyerCell && !isTotalLabel(buyerCell)) buyerName = buyerCell;
    if (styleCell) styleName = styleCell;
    if (fabricCell) fabricDescription = fabricCell;
    if (colorCell) colorName = colorCell;

    if (isTotalLabel(buyerCell)) continue;

    const hasAnyQuantity = [5, 6, 7, 10, 11, 12, 14, 15].some((col) => cellText(row.getCell(col).value));
    if (!buyerName && !styleName && !colorName && !hasAnyQuantity) continue;

    const errors: string[] = [];
    if (!buyerName) errors.push("BUYER is required or must be carried from a merged row");
    if (!styleName) errors.push("STYLE NAME is required or must be carried from a merged row");
    if (!colorName) errors.push("COLOUR is required or must be carried from a merged row");

    if (errors.length > 0) {
      rejectedRows.push({ rowNumber, errors });
      continue;
    }

    acceptedRows.push({
      rowNumber,
      rowColorHex: dominantRowColor(row, 1, 18),
      values: {
        buyerName,
        styleName,
        colorName,
        fabricDescription,
        orderQuantity: cellNumber(row.getCell(5).value),
        actualCutQuantity: cellNumber(row.getCell(6).value),
        stitchOutQuantity: cellNumber(row.getCell(7).value),
        gsm: cellDecimal(row.getCell(8).value),
        bodyAverage: cellDecimal(row.getCell(9).value),
        greigeBookingKg: cellDecimal(row.getCell(10).value),
        pendingExtraFabricForDyeingKg: cellDecimal(row.getCell(11).value),
        fabricSentForDyeingKg: cellDecimal(row.getCell(12).value),
        lotNumber: cellText(row.getCell(13).value),
        actualShortageFabricBalanceKg: cellDecimal(row.getCell(14).value),
        inhouseAfterDyeingKg: cellDecimal(row.getCell(15).value),
        shortagePercent: cellDecimal(row.getCell(16).value),
        status: cellText(row.getCell(17).value),
        dyeingParty: cellText(row.getCell(18).value),
        updateDate: updateDate ?? ""
      }
    });
  }

  return {
    workbookKind: "FABRIC_DYEING",
    sheetName: worksheet.name,
    updateDate,
    rowsReceived: acceptedRows.length + rejectedRows.length,
    acceptedRows,
    rejectedRows,
    warnings: ["Fabric dyeing workbook is extracted as a fabric pipeline snapshot. Applying it requires the fabric pipeline engine."]
  };
}

export async function extractWorkbookImport(buffer: Buffer): Promise<WorkbookExtractionResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const detected = detectWorkbookKind(workbook);

  if (detected.kind === "DAILY_PRODUCTION") return extractDailyProduction(detected.worksheet);
  if (detected.kind === "WIP") return extractWip(detected.worksheet);
  return extractFabricDyeing(detected.worksheet);
}
