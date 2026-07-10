import { readFile } from "node:fs/promises";
import { extractWorkbookImport } from "../src/core/erp-import/workbook-extractor.js";

const files = [
  {
    path: "/Users/srijanchopra/Desktop/RFL DAILY PRODUCTION REPORT.xlsx",
    expectedKind: "DAILY_PRODUCTION",
    minRows: 20
  },
  {
    path: "/Users/srijanchopra/Desktop/WIP BOTH UNIT.xlsx",
    expectedKind: "WIP",
    minRows: 5
  },
  {
    path: "/Users/srijanchopra/Desktop/FABRIC SHEET OF DYEING.xlsx",
    expectedKind: "FABRIC_DYEING",
    minRows: 50
  }
] as const;

async function main() {
  for (const file of files) {
    const buffer = await readFile(file.path);
    const extraction = await extractWorkbookImport(buffer);

    console.log(`Workbook: ${file.path}`);
    console.table({
      kind: extraction.workbookKind,
      sheet: extraction.sheetName,
      rowsReceived: extraction.rowsReceived,
      accepted: extraction.acceptedRows.length,
      rejected: extraction.rejectedRows.length
    });

    if (extraction.workbookKind !== file.expectedKind) {
      throw new Error(`Expected ${file.expectedKind}, received ${extraction.workbookKind}`);
    }

    if (extraction.acceptedRows.length < file.minRows) {
      throw new Error(`Expected at least ${file.minRows} accepted rows for ${file.expectedKind}`);
    }

    if (extraction.workbookKind === "DAILY_PRODUCTION") {
      const colors = new Set(extraction.acceptedRows.map((row) => row.rowColorHex).filter(Boolean));
      for (const expectedColor of ["FF92D050", "FF00B0F0", "FFFF0000"]) {
        if (!colors.has(expectedColor)) {
          throw new Error(`Daily production extractor did not detect expected row color ${expectedColor}`);
        }
      }

      if (!extraction.extractedText?.includes("rowColorHex")) {
        throw new Error("Daily production extraction did not create preview CSV text.");
      }

      const computedBalanceRow = extraction.acceptedRows.find((row) => row.rowNumber === 5);
      if (!computedBalanceRow || computedBalanceRow.values["CUTTING TO LINE IN BAL"] !== "0") {
        throw new Error("Daily production extractor did not compute missing cutting-to-line formula result for row 5.");
      }

      if (extraction.acceptedRows.some((row) => Number.isNaN(Number(row.values["CUTTING TO LINE IN BAL"])))) {
        throw new Error("Daily production extractor produced a non-numeric cutting-to-line balance.");
      }
    }

    if (extraction.workbookKind === "WIP") {
      const units = new Set(extraction.acceptedRows.map((row) => row.values.unitName));
      if (!units.has("Unit-I") || !units.has("Unit-II")) {
        throw new Error("WIP extractor did not extract both Unit-I and Unit-II blocks.");
      }
      if (extraction.acceptedRows.some((row) => String(row.values.styleName).toUpperCase().includes("TOTAL"))) {
        throw new Error("WIP extractor should skip total rows.");
      }
    }

    if (extraction.workbookKind === "FABRIC_DYEING") {
      const sample = extraction.acceptedRows[0]?.values;
      for (const field of ["buyerName", "styleName", "colorName", "fabricSentForDyeingKg", "inhouseAfterDyeingKg", "status"]) {
        if (!sample?.[field]) {
          throw new Error(`Fabric dyeing extractor missing expected field ${field}`);
        }
      }
    }
  }

  console.log("Workbook extractor smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
