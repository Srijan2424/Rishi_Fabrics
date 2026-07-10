import { prisma } from "../src/db.js";
import { ErpImportService } from "../src/core/erp-import/erp-import.service.js";
import { ImportApplyError } from "../src/core/erp-import/erp-import.errors.js";

const erpImport = new ErpImportService();

async function expectError(name: string, action: () => Promise<unknown>, ErrorClass: new (...args: any[]) => Error) {
  try {
    await action();
  } catch (error) {
    if (error instanceof ErrorClass) {
      console.log(`PASS: ${name}`);
      return;
    }

    throw new Error(`${name} failed with wrong error: ${error instanceof Error ? error.name : String(error)}`);
  }

  throw new Error(`${name} did not throw an error`);
}

async function main() {
  const factory = await prisma.factory.findFirst();
  const workflow = await prisma.workflowTemplate.findFirst();

  if (!factory || !workflow) {
    throw new Error("Factory/workflow missing. Run npm run db:seed first.");
  }

  const uniqueSuffix = Date.now();
  const validOrderNumber = `ERP-${uniqueSuffix}`;

  const invalidCsv = [
    "orderNumber,buyerName,productCategory,orderQuantity,deliveryDate,workflowTemplateId",
    `${validOrderNumber}-BAD,Buyer A,T-Shirts,-10,not-a-date,${workflow.id}`,
    `ORD-1001,Buyer Existing,T-Shirts,100,2026-08-01,${workflow.id}`
  ].join("\n");

  const invalidPreview = await erpImport.previewOrderCsv({
    factoryId: factory.id,
    fileName: "invalid-orders.csv",
    sourceType: "CSV",
    csvText: invalidCsv,
    createdBy: "erp-import-smoke-test"
  });

  if (invalidPreview.acceptedRows.length !== 0 || invalidPreview.rejectedRows.length === 0) {
    throw new Error("Invalid import preview did not reject invalid rows.");
  }

  await expectError(
    "Reject apply when preview has rejected rows",
    () => erpImport.applyOrderImport({
      uploadId: invalidPreview.uploadId,
      factoryId: factory.id,
      acceptedRows: invalidPreview.acceptedRows,
      approvedBy: "erp-import-smoke-test"
    }),
    ImportApplyError
  );

  await expectError(
    "Reject tampered apply row count",
    () => erpImport.applyOrderImport({
      uploadId: invalidPreview.uploadId,
      factoryId: factory.id,
      acceptedRows: [],
      approvedBy: "erp-import-smoke-test"
    }),
    ImportApplyError
  );

  const orderBeforeApply = await prisma.order.findFirst({
    where: {
      factoryId: factory.id,
      orderNumber: `${validOrderNumber}-BAD`
    }
  });

  if (orderBeforeApply) {
    throw new Error("Invalid import mutated production data.");
  }

  const validCsv = [
    "orderNumber,buyerName,productCategory,orderQuantity,deliveryDate,workflowTemplateId",
    `${validOrderNumber},ERP Buyer,Polos,1200,2026-08-15,${workflow.id}`
  ].join("\n");

  const validPreview = await erpImport.previewOrderCsv({
    factoryId: factory.id,
    fileName: "valid-orders.csv",
    sourceType: "CSV",
    csvText: validCsv,
    createdBy: "erp-import-smoke-test"
  });

  if (validPreview.acceptedRows.length !== 1 || validPreview.rejectedRows.length !== 0) {
    throw new Error("Valid import preview did not accept exactly one row.");
  }

  if (validPreview.status !== "PREVIEW_READY") {
    throw new Error(`Valid import did not return PREVIEW_READY. Got ${validPreview.status}`);
  }

  const orderBeforeApproval = await prisma.order.findFirst({
    where: {
      factoryId: factory.id,
      orderNumber: validOrderNumber
    }
  });

  if (orderBeforeApproval) {
    throw new Error("Preview mutated production data before approval.");
  }

  const applied = await erpImport.applyOrderImport({
    uploadId: validPreview.uploadId,
    factoryId: factory.id,
    acceptedRows: validPreview.acceptedRows,
    approvedBy: "erp-import-smoke-test"
  });

  if (applied.createdOrders.length !== 1) {
    throw new Error("Import apply did not create exactly one order.");
  }

  await expectError(
    "Reject repeated apply after upload is applied",
    () => erpImport.applyOrderImport({
      uploadId: validPreview.uploadId,
      factoryId: factory.id,
      acceptedRows: validPreview.acceptedRows,
      approvedBy: "erp-import-smoke-test"
    }),
    ImportApplyError
  );

  const quotedCsv = [
    "orderNumber,buyerName,productCategory,orderQuantity,deliveryDate,workflowTemplateId",
    `ERP-Q-${uniqueSuffix},"Buyer, With Comma",Hoodies,300,2026-10-01,${workflow.id}`
  ].join("\n");

  const quotedPreview = await erpImport.previewOrderCsv({
    factoryId: factory.id,
    fileName: "quoted-orders.csv",
    sourceType: "CSV",
    csvText: quotedCsv,
    createdBy: "erp-import-smoke-test"
  });

  if (quotedPreview.acceptedRows[0]?.buyerName !== "Buyer, With Comma") {
    throw new Error("Quoted CSV parser did not preserve comma inside buyerName.");
  }

  const excelPreview = await erpImport.previewOrderImport({
    factoryId: factory.id,
    fileName: "orders.xlsx",
    sourceType: "EXCEL",
    importText: [
      "orderNumber,buyerName,productCategory,orderQuantity,deliveryDate,workflowTemplateId",
      `ERP-XLS-${uniqueSuffix},Excel Buyer,Joggers,450,2026-10-15,${workflow.id}`
    ].join("\n"),
    createdBy: "erp-import-smoke-test"
  });

  if (excelPreview.status !== "PREVIEW_READY" || excelPreview.acceptedRows.length !== 1) {
    throw new Error("Configured Excel source did not validate extracted table rows.");
  }

  const imagePreview = await erpImport.previewOrderImport({
    factoryId: factory.id,
    fileName: "orders-scan.png",
    sourceType: "IMAGE",
    importText: "raw image placeholder without OCR table rows",
    createdBy: "erp-import-smoke-test"
  });

  if (imagePreview.status !== "PREVIEW_HAS_ERRORS" || imagePreview.rejectedRows.length === 0) {
    throw new Error("Image source without OCR table rows did not return validation errors.");
  }

  const createdOrder = await prisma.order.findFirst({
    where: {
      factoryId: factory.id,
      orderNumber: validOrderNumber
    },
    include: {
      stages: true,
      events: true
    }
  });

  if (!createdOrder) {
    throw new Error("Applied import order not found.");
  }

  if (createdOrder.stages.length === 0) {
    throw new Error("Applied import did not create order stages.");
  }

  const importEvent = await prisma.event.findFirst({
    where: {
      factoryId: factory.id,
      source: "erp-import-engine",
      type: "IMPORT_APPROVED"
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  if (!importEvent) {
    throw new Error("Import apply did not create timeline event.");
  }

  console.log("Invalid preview:");
  console.table(invalidPreview.rejectedRows.map((row) => ({
    rowNumber: row.rowNumber,
    errors: row.errors.join("; ")
  })));

  console.log("Created order:");
  console.table([{
    orderNumber: createdOrder.orderNumber,
    buyerName: createdOrder.buyerName,
    quantity: createdOrder.orderQuantity,
    stages: createdOrder.stages.length
  }]);

  console.log("ERP import smoke test passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
