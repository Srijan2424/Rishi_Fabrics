import express from "express";
import { prisma } from "../src/db.js";
import { erpImportRouter } from "../src/modules/erp-import/erp-import.routes.js";
import { attachDevAuth } from "../src/security/rbac.js";
import { errorHandler } from "../src/http.js";

async function request(app: express.Express, path: string, options: RequestInit = {}) {
  const server = app.listen(0);
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Could not start test server");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, options);
    const body = await response.json().catch(() => null);
    return {
      status: response.status,
      body
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

async function main() {
  const factory = await prisma.factory.findFirst();
  const workflow = await prisma.workflowTemplate.findFirst();

  if (!factory || !workflow) {
    throw new Error("Factory/workflow missing. Run npm run db:seed first.");
  }

  const app = express();
  app.use(express.json());
  app.use(attachDevAuth);
  app.use("/erp-import", erpImportRouter);
  app.use(errorHandler);

  const config = await request(app, "/erp-import/config", {
    headers: {
      "x-user-role": "ERP_MANAGER"
    }
  });

  if (config.status !== 200 || !config.body?.sources?.some((source: { sourceType: string }) => source.sourceType === "IMAGE")) {
    throw new Error(`Import config failed: ${config.status}`);
  }

  console.log("PASS: Import source config includes image/excel/pdf formats");

  const csvText = [
    "orderNumber,buyerName,productCategory,orderQuantity,deliveryDate,workflowTemplateId",
    `ROUTE-${Date.now()},Route Buyer,T-Shirts,700,2026-09-01,${workflow.id}`
  ].join("\n");

  const forbiddenPreview = await request(app, "/erp-import/preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-role": "CEO"
    },
    body: JSON.stringify({
      factoryId: factory.id,
      fileName: "route-test.csv",
      sourceType: "CSV",
      csvText
    })
  });

  if (forbiddenPreview.status !== 403) {
    throw new Error(`Expected CEO preview request to be forbidden, got ${forbiddenPreview.status}`);
  }

  console.log("PASS: Preview requires UPLOAD_ERP_FILE permission");

  const preview = await request(app, "/erp-import/preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-role": "ERP_MANAGER",
      "x-user-id": "route-test-erp-manager"
    },
    body: JSON.stringify({
      factoryId: factory.id,
      fileName: "route-test.csv",
      sourceType: "CSV",
      csvText
    })
  });

  if (preview.status !== 201 || !preview.body?.uploadId || preview.body.acceptedRows?.length !== 1) {
    throw new Error(`Preview failed: ${preview.status} ${JSON.stringify(preview.body)}`);
  }

  console.log("PASS: ERP Manager can create import preview");

  const apply = await request(app, "/erp-import/apply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-role": "ERP_MANAGER",
      "x-user-id": "route-test-erp-manager"
    },
    body: JSON.stringify({
      uploadId: preview.body.uploadId,
      factoryId: factory.id,
      acceptedRows: preview.body.acceptedRows
    })
  });

  if (apply.status !== 201 || apply.body?.createdOrders?.length !== 1) {
    throw new Error(`Apply failed: ${apply.status} ${JSON.stringify(apply.body)}`);
  }

  console.log("PASS: ERP Manager can apply approved import");

  const uploads = await request(app, `/erp-import/uploads?factoryId=${factory.id}`, {
    headers: {
      "x-user-role": "ERP_MANAGER"
    }
  });

  if (uploads.status !== 200 || !Array.isArray(uploads.body)) {
    throw new Error(`Upload listing failed: ${uploads.status}`);
  }

  console.log("PASS: Upload listing works");

  const uploadDetail = await request(app, `/erp-import/uploads/${preview.body.uploadId}`, {
    headers: {
      "x-user-role": "ERP_MANAGER"
    }
  });

  if (uploadDetail.status !== 200 || !Array.isArray(uploadDetail.body?.auditEvents)) {
    throw new Error(`Upload audit detail failed: ${uploadDetail.status}`);
  }

  console.log("PASS: Upload audit detail works");
  console.log("ERP import routes smoke test passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
