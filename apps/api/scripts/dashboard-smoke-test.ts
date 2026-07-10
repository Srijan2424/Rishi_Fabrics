import express from "express";
import { prisma } from "../src/db.js";
import { dashboardRouter } from "../src/modules/dashboard/dashboard.routes.js";
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

  if (!factory) {
    throw new Error("Factory missing. Run npm run db:seed first.");
  }

  const app = express();
  app.use(express.json());
  app.use(attachDevAuth);
  app.use("/dashboard", dashboardRouter);
  app.use(errorHandler);

  const forbidden = await request(app, `/dashboard/control-tower?factoryId=${factory.id}`, {
    headers: {
      "x-user-role": "ERP_MANAGER"
    }
  });

  if (forbidden.status !== 403) {
    throw new Error(`Expected ERP_MANAGER dashboard request to be forbidden, got ${forbidden.status}`);
  }

  console.log("PASS: Dashboard requires VIEW_DASHBOARD permission");

  const allowed = await request(app, `/dashboard/control-tower?factoryId=${factory.id}`, {
    headers: {
      "x-user-role": "HEAD_OF_OPERATIONS"
    }
  });

  if (allowed.status !== 200) {
    throw new Error(`Expected dashboard request to succeed, got ${allowed.status}`);
  }

  const requiredArrays = [
    "upcomingDeliveries",
    "orderJourneyStatus",
    "stageInventorySummary",
    "reworkSummary",
    "importSummary",
    "recentEvents"
  ];

  for (const key of requiredArrays) {
    if (!Array.isArray(allowed.body?.[key])) {
      throw new Error(`Dashboard response missing array: ${key}`);
    }
  }

  const requiredMetrics = [
    "ordersRunning",
    "ordersDelayed",
    "ordersAtRisk",
    "upcomingDeliveries",
    "dispatchedOrders",
    "totalInventoryQuantity",
    "totalReworkQuantity",
    "importsPending"
  ];

  for (const key of requiredMetrics) {
    if (typeof allowed.body?.metrics?.[key] !== "number") {
      throw new Error(`Dashboard response missing numeric metric: ${key}`);
    }
  }

  console.log("Dashboard metrics:");
  console.table([allowed.body.metrics]);
  console.log(`Order rows: ${allowed.body.orderJourneyStatus.length}`);
  console.log(`Stage inventory rows: ${allowed.body.stageInventorySummary.length}`);
  console.log("Dashboard smoke test passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
