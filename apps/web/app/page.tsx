import { redirect } from "next/navigation";
import { getControlTower, getCurrentUser } from "./lib/api";
import { Fragment } from "react";

type MetricMap = {
  ordersRunning: number;
  ordersDelayed: number;
  ordersAtRisk: number;
  upcomingDeliveries: number;
  dispatchedOrders: number;
  totalInventoryQuantity: number;
  totalReworkQuantity: number;
  importsPending: number;
};

type JourneyRow = {
  id: string;
  orderNumber: string;
  buyerName: string;
  productCategory: string;
  orderQuantity: number;
  currentStageCode: string | null;
  deliveryDate: string;
  status: string;
  reworkQuantity: number;
  progressPercent: number;
  activeInventory: Array<{
    stageCode: string;
    stageName: string;
    quantity: number;
  }>;
  pipelineProgress: PipelineProgress[];
  materialAccountability?: MaterialAccountability;
  delayStatus: "ON_TRACK" | "AT_RISK" | "DELAYED" | "DISPATCHED" | "CANCELLED";
  delayReason: string;
  expectedStageCode: string | null;
  expectedStageName: string | null;
  plannedProgressPercent: number;
  progressDeficitPercent: number;
  daysRemaining: number;
  lineDelayReports: LineDelayReport[];
  unitDelaySummary: UnitDelaySummary[];
  samplingDelay?: SamplingDelay;
};

type LineDelayReport = {
  orderLineId: string;
  styleName: string;
  colorName: string;
  productionUnitName: string | null;
  productionStatus: string | null;
  status: "ON_TRACK" | "AT_RISK" | "DELAYED" | "DISPATCHED" | "CANCELLED";
  reason: string;
  actualProgressPercent: number;
  plannedProgressPercent: number;
  progressDeficitPercent: number;
  currentStageCode: string;
  expectedStageCode: string;
  orderQuantity: number;
  cuttingTotalQty: number;
  lineLoadingQty: number;
  totalLineOutQty: number;
  lineInBalanceQty: number;
};

type UnitDelaySummary = {
  productionUnitName: string | null;
  status: "ON_TRACK" | "AT_RISK" | "DELAYED" | "DISPATCHED" | "CANCELLED";
  delayedLines: number;
  atRiskLines: number;
  onTrackLines: number;
  totalLines: number;
};

type SamplingDelay = {
  status: "ON_TRACK" | "AT_RISK" | "DELAYED" | "DISPATCHED" | "CANCELLED";
  approvalsComplete: number;
  approvalsTotal: number;
  progressPercent: number;
  reason: string;
};

type TimelineEvent = {
  id: string;
  message: string;
  type: string;
  createdAt: string;
};

type StageInventoryRow = {
  stageCode: string;
  stageName: string;
  category: string;
  quantity: number;
};

type ReworkSummaryRow = {
  id: string;
  orderNumber: string;
  sourceStageCode: string;
  quantity: number;
  severity: string | null;
  department: string | null;
  reason: string;
};

type ImportSummaryRow = {
  status: string;
  count: number;
  rowsAccepted: number;
  rowsRejected: number;
};

type PipelineProgress = {
  pipeline: "SAMPLING" | "FABRIC" | "GARMENT";
  plannedQuantity: number;
  activeQuantity: number;
  completedQuantity: number;
  reworkedQuantity: number;
  scrappedQuantity: number;
  progressPercent: number;
};

type MaterialAccountability = {
  orderQuantity: number;
  activeInventoryQuantity: number;
  openReworkQuantity: number;
  scrappedQuantity: number;
  accountedQuantity: number;
  missingQuantity: number;
  overageQuantity: number;
  isBalanced: boolean;
};

const riskRank = {
  DELAYED: 0,
  AT_RISK: 1,
  ON_TRACK: 2,
  DISPATCHED: 3,
  CANCELLED: 4
};

function aggregatePipelines(rows: JourneyRow[]) {
  const pipelines: PipelineProgress["pipeline"][] = ["SAMPLING", "FABRIC", "GARMENT"];

  return pipelines.map((pipeline) => {
    const matching = rows
      .flatMap((row) => row.pipelineProgress ?? [])
      .filter((item) => item.pipeline === pipeline);
    const plannedQuantity = matching.reduce((sum, item) => sum + item.plannedQuantity, 0);
    const activeQuantity = matching.reduce((sum, item) => sum + item.activeQuantity, 0);
    const completedQuantity = matching.reduce((sum, item) => sum + item.completedQuantity, 0);
    const progressPercent = plannedQuantity > 0
      ? Math.round(matching.reduce((sum, item) => sum + item.progressPercent * item.plannedQuantity, 0) / plannedQuantity)
      : 0;

    return {
      pipeline,
      plannedQuantity,
      activeQuantity,
      completedQuantity,
      progressPercent
    };
  });
}

export default async function ControlTowerPage() {
  const user = await getCurrentUser();
  if (user && !user.permissions.includes("VIEW_DASHBOARD")) {
    if (user.permissions.includes("UPLOAD_ERP_FILE")) redirect("/imports");
    if (user.permissions.includes("VIEW_SAMPLING")) redirect("/sampling");
    if (user.permissions.includes("VIEW_ORDER")) redirect("/orders");
    redirect("/settings");
  }

  const data = await getControlTower();
  const metrics = data.metrics as MetricMap;
  const rows = data.orderJourneyStatus as JourneyRow[];
  const events = data.recentEvents as TimelineEvent[];
  const stageInventory = data.stageInventorySummary as StageInventoryRow[];
  const reworkSummary = data.reworkSummary as ReworkSummaryRow[];
  const importSummary = data.importSummary as ImportSummaryRow[];
  const priorityRows = [...rows].sort((left, right) => {
    const riskDiff = riskRank[left.delayStatus] - riskRank[right.delayStatus];
    if (riskDiff !== 0) return riskDiff;
    return new Date(left.deliveryDate).getTime() - new Date(right.deliveryDate).getTime();
  });
  const riskRows = priorityRows.filter((row) => row.delayStatus === "DELAYED" || row.delayStatus === "AT_RISK");
  const pipelineSummary = aggregatePipelines(rows);
  const unbalancedRows = rows.filter((row) => row.materialAccountability && !row.materialAccountability.isBalanced);
  const getWorstLine = (row: JourneyRow) => [...(row.lineDelayReports ?? [])].sort((left, right) => (
    riskRank[left.status] - riskRank[right.status] ||
    right.progressDeficitPercent - left.progressDeficitPercent
  ))[0];

  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">Operations</div>
          <h1>Control Tower</h1>
          <p>Live delivery risk, pipeline progress, material balance, and timeline activity.</p>
        </div>
      </header>

      {data.apiOffline ? (
        <section className="setup-warning">
          <strong>API is not reachable yet.</strong>
          <p>
            The frontend is running, but it cannot connect to <code>{data.apiUrl}</code>. Start the
            backend with <code>npm run dev:api</code>, then refresh this page.
          </p>
          <p className="setup-error">Error: {data.error}</p>
        </section>
      ) : null}

      <section className="metrics">
        <div className="metric metric-danger">
          Running Orders
          <strong>{metrics.ordersRunning}</strong>
        </div>
        <div className="metric metric-danger">
          Delayed Orders
          <strong>{metrics.ordersDelayed}</strong>
        </div>
        <div className="metric metric-warning">
          At Risk
          <strong>{metrics.ordersAtRisk}</strong>
        </div>
        <div className="metric">
          Upcoming Deliveries
          <strong>{metrics.upcomingDeliveries}</strong>
        </div>
      </section>

      <section className="metrics secondary-metrics">
        <div className="metric">
          Total Inventory Qty
          <strong>{metrics.totalInventoryQuantity.toLocaleString()}</strong>
        </div>
        <div className="metric">
          Open Rework Qty
          <strong>{metrics.totalReworkQuantity.toLocaleString()}</strong>
        </div>
        <div className="metric">
          Pending Imports
          <strong>{metrics.importsPending}</strong>
        </div>
        <div className="metric">
          Dispatched Orders
          <strong>{metrics.dispatchedOrders}</strong>
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Priority Orders</h2>
          {priorityRows.length === 0 ? (
            <div className="empty">No orders yet. Seed data or create your first order.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Buyer</th>
                  <th>Current / Expected</th>
                  <th>Progress</th>
                  <th>Risk</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {priorityRows.map((row) => (
                  <Fragment key={row.id}>
                    <tr>
                      <td>
                        <strong>{row.orderNumber}</strong>
                        <span className="muted-row">{row.productCategory} · {row.orderQuantity.toLocaleString()} pcs</span>
                      </td>
                      <td>{row.buyerName}</td>
                      <td>
                        <strong>{row.currentStageCode ?? "Not started"}</strong>
                        <span className="muted-row">Expected: {row.expectedStageCode ?? "n/a"}</span>
                      </td>
                      <td>
                        <div className="mini-progress" aria-label={`${row.progressPercent}% complete`}>
                          <span style={{ width: `${row.progressPercent}%` }} />
                        </div>
                        <small>{row.progressPercent}% actual · {row.plannedProgressPercent}% planned</small>
                      </td>
                      <td>
                        <span className={`status ${row.delayStatus}`}>{row.delayStatus}</span>
                        <span className="muted-row">{row.daysRemaining} day(s) left</span>
                      </td>
                      <td>{row.delayReason}</td>
                    </tr>
                    {getWorstLine(row) ? (
                      <tr className="detail-row">
                        <td colSpan={6}>
                          <strong>Style/colour risk:</strong>{" "}
                          {getWorstLine(row)?.styleName} / {getWorstLine(row)?.colorName} ·{" "}
                          {getWorstLine(row)?.productionUnitName ?? "Unmapped unit"} ·{" "}
                          {getWorstLine(row)?.actualProgressPercent}% actual ·{" "}
                          {getWorstLine(row)?.status}
                          {row.unitDelaySummary.length > 0 ? (
                            <span className="muted-row">
                              Units: {row.unitDelaySummary.map((unit) => (
                                `${unit.productionUnitName ?? "Unmapped"} ${unit.status} (${unit.totalLines})`
                              )).join(" · ")}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <h2>Risk Queue</h2>
          {riskRows.length === 0 ? (
            <div className="empty">No delayed or at-risk orders right now.</div>
          ) : (
            <ul className="summary-list risk-list">
              {riskRows.slice(0, 8).map((row) => (
                <li key={row.id}>
                  <div className="row-between">
                    <strong>{row.orderNumber}</strong>
                    <span className={`status ${row.delayStatus}`}>{row.delayStatus}</span>
                  </div>
                  <span>{row.delayReason}</span>
                  <small>
                    Current {row.currentStageCode ?? "n/a"} · Expected {row.expectedStageCode ?? "n/a"} · Deficit {row.progressDeficitPercent}%
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid lower-grid">
        <div className="panel">
          <h2>Pipeline Progress</h2>
          <div className="pipeline-grid">
            {pipelineSummary.map((pipeline) => (
              <div className="pipeline-card" key={pipeline.pipeline}>
                <div className="row-between">
                  <strong>{pipeline.pipeline}</strong>
                  <span>{pipeline.progressPercent}%</span>
                </div>
                <div className="progress">
                  <span style={{ width: `${pipeline.progressPercent}%` }} />
                </div>
                <small>
                  Active {pipeline.activeQuantity.toLocaleString()} pcs · Completed {pipeline.completedQuantity.toLocaleString()} pcs
                </small>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>Material Balance Alerts</h2>
          {unbalancedRows.length === 0 ? (
            <div className="empty">All visible orders are materially balanced.</div>
          ) : (
            <ul className="summary-list">
              {unbalancedRows.slice(0, 8).map((row) => (
                <li key={row.id}>
                  <strong>{row.orderNumber}</strong>
                  <span>
                    Missing {row.materialAccountability?.missingQuantity.toLocaleString()} pcs · Overage {row.materialAccountability?.overageQuantity.toLocaleString()} pcs
                  </span>
                  <small>
                    Accounted {row.materialAccountability?.accountedQuantity.toLocaleString()} of {row.materialAccountability?.orderQuantity.toLocaleString()} pcs
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid lower-grid">
        <div className="panel">
          <h2>Stage Inventory</h2>
          {stageInventory.length === 0 ? (
            <div className="empty">No active stage inventory yet. Run an inventory or workflow test.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Category</th>
                  <th>Quantity</th>
                </tr>
              </thead>
              <tbody>
                {stageInventory.map((stage) => (
                  <tr key={stage.stageCode}>
                    <td>
                      <strong>{stage.stageName}</strong>
                      <span className="muted-row">{stage.stageCode}</span>
                    </td>
                    <td>{stage.category}</td>
                    <td>{stage.quantity.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <h2>Open Rework</h2>
          {reworkSummary.length === 0 ? (
            <div className="empty">No open rework tickets.</div>
          ) : (
            <ul className="summary-list">
              {reworkSummary.map((ticket) => (
                <li key={ticket.id}>
                  <strong>{ticket.orderNumber}</strong>
                  <span>
                    {ticket.quantity.toLocaleString()} pcs from {ticket.sourceStageCode}
                  </span>
                  <small>
                    {[ticket.department, ticket.severity, ticket.reason].filter(Boolean).join(" · ")}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid lower-grid">
        <div className="panel">
          <h2>Import Health</h2>
          {importSummary.length === 0 ? (
            <div className="empty">No ERP imports have been previewed yet.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Files</th>
                  <th>Accepted Rows</th>
                  <th>Rejected Rows</th>
                </tr>
              </thead>
              <tbody>
                {importSummary.map((upload) => (
                  <tr key={upload.status}>
                    <td>{upload.status}</td>
                    <td>{upload.count}</td>
                    <td>{upload.rowsAccepted.toLocaleString()}</td>
                    <td>{upload.rowsRejected.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <h2>Recent Timeline</h2>
          {events.length === 0 ? (
            <div className="empty">No timeline events yet.</div>
          ) : (
            <ul className="timeline">
              {events.slice(0, 10).map((event) => (
                <li key={event.id}>
                  {event.message}
                  <span>
                    {event.type} · {new Date(event.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
