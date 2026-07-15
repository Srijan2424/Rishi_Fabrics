import cors from "cors";
import "dotenv/config";
import express from "express";
import path from "node:path";
import { prisma } from "./db.js";
import { errorHandler } from "./http.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { erpImportRouter } from "./modules/erp-import/erp-import.routes.js";
import { fabricRouter } from "./modules/fabric/fabric.routes.js";
import { factoriesRouter } from "./modules/factories/factories.routes.js";
import { demoGuidesRouter } from "./modules/demo-guides/demo-guides.routes.js";
import { historyRouter } from "./modules/history/history.routes.js";
import { issuesRouter } from "./modules/issues/issues.routes.js";
import { maintenanceRouter } from "./modules/maintenance/maintenance.routes.js";
import { monitoringRouter } from "./modules/monitoring/monitoring.routes.js";
import { ordersRouter } from "./modules/orders/orders.routes.js";
import { productionUnitsRouter } from "./modules/production-units/production-units.routes.js";
import { techPackRouter } from "./modules/sampling/tech-pack.routes.js";
import { reportsRouter } from "./modules/reports/reports.routes.js";
import { uploadsRouter } from "./modules/uploads/uploads.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { wipRouter } from "./modules/wip/wip.routes.js";
import { workLogsRouter } from "./modules/work-logs/work-logs.routes.js";
import workflowEngineRouter from "./modules/workflows/workflow-engine.routes.js";
import { workflowsRouter } from "./modules/workflows/workflows.routes.js";
import { attachDevAuth, attachSessionAuth, requireAuthenticated } from "./security/rbac.js";
import { rejectOversizedJson } from "./security/request-validation.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const defaultDevOrigins = process.env.NODE_ENV === "production" ? [] : [
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];
const allowedOrigins = Array.from(new Set([
  ...defaultDevOrigins,
  ...(process.env.WEB_ORIGIN ?? "").split(","),
  ...(process.env.CORS_ORIGIN ?? "").split(",")
]))
  .map((origin) => origin.trim())
  .filter(Boolean);

function isAllowedDevOrigin(origin: string) {
  if (process.env.NODE_ENV === "production") return false;
  return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || isAllowedDevOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  credentials: true
}));
app.use(rejectOversizedJson);
app.use(express.json({ limit: "2mb" }));
app.use(attachSessionAuth);
app.use(attachDevAuth);

function environmentChecks() {
  return {
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
    SESSION_SECRET: Boolean(process.env.SESSION_SECRET),
    CORS_ORIGIN: Boolean(process.env.CORS_ORIGIN || process.env.WEB_ORIGIN),
    ADMIN_ALERT_EMAIL: Boolean(process.env.ADMIN_ALERT_EMAIL),
    RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY),
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    SUPABASE_STORAGE_BUCKET: Boolean(process.env.SUPABASE_STORAGE_BUCKET),
    SENTRY_DSN: Boolean(process.env.SENTRY_DSN)
  };
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "rishi-fabrics-api",
    environment: process.env.NODE_ENV ?? "development",
    checks: environmentChecks()
  });
});

app.get("/health/deep", async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      ok: true,
      service: "rishi-fabrics-api",
      database: "ONLINE",
      environment: process.env.NODE_ENV ?? "development",
      checks: environmentChecks()
    });
  } catch (error) {
    next(error);
  }
});

app.use("/auth", authRouter);
app.use("/reports", reportsRouter);
app.use("/maintenance", maintenanceRouter);
app.use(requireAuthenticated);
app.use(
  "/tech-pack-previews",
  express.static(path.resolve(process.cwd(), ".generated", "tech-pack-previews"))
);
app.use("/factories", factoriesRouter);
app.use("/workflows", workflowsRouter);
app.use("/workflow-engine", workflowEngineRouter);
app.use("/orders", ordersRouter);
app.use("/production-units", productionUnitsRouter);
app.use("/uploads", uploadsRouter);
app.use("/users", usersRouter);
app.use("/erp-import", erpImportRouter);
app.use("/fabric", fabricRouter);
app.use("/wip", wipRouter);
app.use("/sampling/tech-packs", techPackRouter);
app.use("/history", historyRouter);
app.use("/dashboard", dashboardRouter);
app.use("/monitoring", monitoringRouter);
app.use("/issues", issuesRouter);
app.use("/work-logs", workLogsRouter);
app.use("/demo-guides", demoGuidesRouter);
app.use(errorHandler);

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});
