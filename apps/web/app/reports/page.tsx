import { apiUrl, getCurrentUser, getReportSummary } from "../lib/api";

function formatDate(value: string | Date | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value: string | Date | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function percent(value: number | undefined) {
  return Math.max(0, Math.min(100, Math.round(Number(value ?? 0))));
}

function statusClass(status: string | undefined) {
  const value = String(status ?? "").toUpperCase();
  if (value.includes("DELAY")) return "status-danger";
  if (value.includes("RISK")) return "status-warning";
  return "status-neutral";
}

function ProgressBar({ value }: { value: number }) {
  const safeValue = percent(value);
  return (
    <div className="report-progress">
      <span style={{ width: safeValue + "%" }} />
      <strong>{safeValue}%</strong>
    </div>
  );
}

export default async function ReportsPage() {
  const user = await getCurrentUser();
  if (!user?.permissions.includes("VIEW_REPORTS")) {
    return <div className="panel empty">Forbidden. Production Reports are for MD access.</div>;
  }

  const report = await getReportSummary();
  const metrics = report.metrics ?? {};
  const sections = report.sections ?? {};
  const week = report.week ?? {};
  const productionProgress = sections.productionProgress ?? {};
  const samplingProgress = sections.samplingProgress ?? {};
  const fabricProgress = sections.fabricProgress ?? {};
  const uploadHealth = sections.uploadHealth ?? {};

  return (
    <div>
      <div className="page-header report-header">
        <div>
          <span className="eyebrow">Rishi Fabrics weekly production report</span>
          <h1>Reports</h1>
          <p>{formatDate(week.weekStart)} - {formatDate(week.weekEnd)} · Generated {formatDateTime(report.generatedAt)}</p>
        </div>
        <div className="button-row">
          <a className="button-link" href={apiUrl + "/reports/orders.csv"}>Orders CSV</a>
          <a className="button-link" href={apiUrl + "/reports/fabric.csv"}>Fabric CSV</a>
          <a className="button-link" href={apiUrl + "/reports/uploads.csv"}>Uploads CSV</a>
        </div>
      </div>

      <section className="report-cover panel section-panel">
        <div>
          <span className="eyebrow">Rishi Fabrics Weekly Production Report</span>
          <h2>{formatDate(week.weekStart)} to {formatDate(week.weekEnd)}</h2>
          <p>This report is automatically formed from Rishi Fabrics sampling, production, WIP, fabric/dyeing, and upload health data for this week.</p>
        </div>
        <div className="report-stamp">
          <span>Time stamp</span>
          <strong>{formatDateTime(report.generatedAt)}</strong>
        </div>
      </section>

      <section className="metrics">
        <div className="metric"><span>Avg Progress</span><strong>{metrics.averageOrderProgress ?? 0}%</strong></div>
        <div className="metric"><span>Running Orders</span><strong>{metrics.runningOrders ?? 0}</strong></div>
        <div className="metric"><span>At Risk</span><strong>{metrics.atRiskOrders ?? 0}</strong></div>
        <div className="metric"><span>Delayed</span><strong>{metrics.delayedOrders ?? 0}</strong></div>
      </section>

      <section className="report-grid">
        <div className="report-card">
          <span>Sampling</span>
          <strong>{samplingProgress.uploadedThisWeek ?? 0}</strong>
          <p>styles uploaded this week · {samplingProgress.pendingApprovals ?? 0} approvals pending</p>
        </div>
        <div className="report-card">
          <span>Production</span>
          <strong>{productionProgress.dispatchedThisWeek ?? 0}</strong>
          <p>orders dispatched this week · {productionProgress.averageProgressPercent ?? 0}% average progress</p>
        </div>
        <div className="report-card">
          <span>Fabric / Dyeing</span>
          <strong>{fabricProgress.pendingRows ?? 0}</strong>
          <p>pending fabric rows · {fabricProgress.inhouseAfterDyeingKg ?? 0} kg in-house after dyeing</p>
        </div>
        <div className="report-card">
          <span>Upload Health</span>
          <strong>{uploadHealth.rejectedRows ?? 0}</strong>
          <p>rejected rows this week · {uploadHealth.uploadsThisWeek ?? 0} uploads checked</p>
        </div>
      </section>

      <section className="panel section-panel">
        <div className="panel-head">
          <div>
            <h2>1. Executive Summary</h2>
            <p>High-level weekly position for MD review.</p>
          </div>
        </div>
        <div className="report-summary-list">
          <div><span>Total running orders</span><strong>{metrics.runningOrders ?? 0}</strong></div>
          <div><span>Orders at risk</span><strong>{metrics.atRiskOrders ?? 0}</strong></div>
          <div><span>Delayed orders</span><strong>{metrics.delayedOrders ?? 0}</strong></div>
          <div><span>Rejected rows this week</span><strong>{metrics.rejectedRows ?? 0}</strong></div>
        </div>
      </section>

      <div className="grid-two">
        <section className="panel section-panel">
          <h2>2. Sampling Progress</h2>
          <table>
            <tbody>
              <tr><th>Total sampling styles</th><td>{samplingProgress.totalStyles ?? 0}</td></tr>
              <tr><th>Styles uploaded this week</th><td>{samplingProgress.uploadedThisWeek ?? 0}</td></tr>
              <tr><th>Pending approvals</th><td>{samplingProgress.pendingApprovals ?? 0}</td></tr>
              <tr><th>Completed sampling orders</th><td>{samplingProgress.completedOrders ?? 0}</td></tr>
            </tbody>
          </table>
        </section>

        <section className="panel section-panel">
          <h2>3. Production / Orders Progress</h2>
          <table>
            <tbody>
              <tr><th>Running orders</th><td>{productionProgress.runningOrders ?? 0}</td></tr>
              <tr><th>Dispatched this week</th><td>{productionProgress.dispatchedThisWeek ?? 0}</td></tr>
              <tr><th>Average progress</th><td>{productionProgress.averageProgressPercent ?? 0}%</td></tr>
              <tr><th>Risk items</th><td>{(productionProgress.riskOrders ?? []).length}</td></tr>
            </tbody>
          </table>
        </section>
      </div>

      <section className="panel section-panel">
        <h2>Stage-wise Production Progress</h2>
        <table>
          <thead><tr><th>Stage</th><th>Planned</th><th>Active</th><th>Completed</th><th>Progress</th></tr></thead>
          <tbody>
            {(productionProgress.stageProgress ?? []).map((row: any) => (
              <tr key={row.stageCode}>
                <td>{row.stageName}</td>
                <td>{row.plannedQuantity}</td>
                <td>{row.activeQuantity}</td>
                <td>{row.completedQuantity}</td>
                <td><ProgressBar value={row.progressPercent} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid-two">
        <section className="panel section-panel">
          <h2>4. Fabric / Dyeing Progress</h2>
          <table>
            <tbody>
              <tr><th>Rows received this week</th><td>{fabricProgress.rowsThisWeek ?? 0}</td></tr>
              <tr><th>Pending fabric rows</th><td>{fabricProgress.pendingRows ?? 0}</td></tr>
              <tr><th>Completed fabric rows</th><td>{fabricProgress.completedRows ?? 0}</td></tr>
              <tr><th>Sent for dyeing</th><td>{fabricProgress.sentForDyeingKg ?? 0} kg</td></tr>
              <tr><th>In-house after dyeing</th><td>{fabricProgress.inhouseAfterDyeingKg ?? 0} kg</td></tr>
              <tr><th>Shortage</th><td>{fabricProgress.shortageKg ?? 0} kg</td></tr>
            </tbody>
          </table>
        </section>

        <section className="panel section-panel">
          <h2>5. Upload Health</h2>
          <table>
            <tbody>
              <tr><th>Uploads this week</th><td>{uploadHealth.uploadsThisWeek ?? 0}</td></tr>
              <tr><th>Accepted rows</th><td>{uploadHealth.acceptedRows ?? 0}</td></tr>
              <tr><th>Rejected rows</th><td>{uploadHealth.rejectedRows ?? 0}</td></tr>
              <tr><th>Files needing correction</th><td>{(uploadHealth.filesNeedingCorrection ?? []).length}</td></tr>
            </tbody>
          </table>
        </section>
      </div>

      <section className="panel section-panel">
        <h2>6. MD Action Points</h2>
        {(productionProgress.riskOrders ?? []).length === 0 ? (
          <div className="empty">No delayed or at-risk orders found for this weekly report.</div>
        ) : (
          <table>
            <thead><tr><th>Order</th><th>Buyer</th><th>Status</th><th>Progress</th><th>Reason</th><th>Delivery</th></tr></thead>
            <tbody>
              {(productionProgress.riskOrders ?? []).map((row: any) => (
                <tr key={row.id}>
                  <td>{row.orderNumber}</td>
                  <td>{row.buyerName}</td>
                  <td><span className={"status-pill " + statusClass(row.status)}>{row.status}</span></td>
                  <td><ProgressBar value={row.progressPercent} /></td>
                  <td>{row.reason}</td>
                  <td>{formatDate(row.deliveryDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid-two">
        <section className="panel section-panel">
          <h2>Recent Sampling Styles</h2>
          <table><thead><tr><th>Style</th><th>Source</th><th>Uploaded</th></tr></thead><tbody>{(samplingProgress.recentStyles ?? []).map((row: any) => <tr key={row.id}><td>{row.styleNumber}</td><td>{row.sourceFileName}</td><td>{formatDate(row.createdAt)}</td></tr>)}</tbody></table>
        </section>
        <section className="panel section-panel">
          <h2>Files Needing Correction</h2>
          <table><thead><tr><th>File</th><th>Type</th><th>Accepted</th><th>Rejected</th></tr></thead><tbody>{(uploadHealth.filesNeedingCorrection ?? []).map((row: any) => <tr key={row.id}><td>{row.fileName}</td><td>{row.sourceType}</td><td>{row.rowsAccepted}</td><td>{row.rowsRejected}</td></tr>)}</tbody></table>
        </section>
      </div>
    </div>
  );
}
