import { IssueManager } from "../components/IssueManager";
import { getCurrentUser, getIssues, getMonitoringSummary } from "../lib/api";

function severityClass(severity: string) {
  const value = String(severity ?? "").toLowerCase();
  if (value.includes("critical") || value.includes("error")) return "status-danger";
  if (value.includes("high")) return "status-warning";
  return "status-neutral";
}

export default async function MonitoringPage() {
  const user = await getCurrentUser();
  if (!user?.permissions.includes("VIEW_MONITORING")) {
    return <div className="panel empty">Forbidden. Monitoring is private to Admin.</div>;
  }

  const [summary, issues] = await Promise.all([getMonitoringSummary(), getIssues()]);
  const metrics = summary.metrics ?? {};
  const diagnostics = summary.diagnostics ?? [];
  const health = summary.health ?? {};

  return (
    <div>
      <div className="page-header">
        <div>
          <span className="eyebrow">System diagnostics</span>
          <h1>Monitoring</h1>
          <p>Website health, bugs, failed uploads, broken actions, and unresolved system issues.</p>
        </div>
      </div>
      <section className="metrics">
        <div className="metric"><span>System</span><strong>{health.ok ? "OK" : "Issues"}</strong></div>
        <div className="metric"><span>Active Problems</span><strong>{metrics.activeProblems ?? 0}</strong></div>
        <div className="metric"><span>Server Errors</span><strong>{metrics.unresolvedErrors ?? 0}</strong></div>
        <div className="metric"><span>Failed Uploads</span><strong>{metrics.failedUploads ?? 0}</strong></div>
      </section>

      <section className="panel section-panel">
        <div className="panel-head">
          <div>
            <h2>Current Problems</h2>
            <p>Every row explains where the issue is, what happened, and how to investigate or fix it.</p>
          </div>
        </div>
        {diagnostics.length === 0 ? (
          <div className="empty">No active website issues detected right now.</div>
        ) : (
          <table>
            <thead><tr><th>Severity</th><th>Where</th><th>What</th><th>How</th><th>Time</th></tr></thead>
            <tbody>
              {diagnostics.map((row: any) => (
                <tr key={row.id}>
                  <td><span className={"status-pill " + severityClass(row.severity)}>{row.severity}</span></td>
                  <td>{row.where}</td>
                  <td>{row.what}</td>
                  <td>{row.how}</td>
                  <td>{new Date(row.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid-two">
        <section className="panel section-panel">
          <h2>Server / Client Errors</h2>
          <table><thead><tr><th>Message</th><th>Source</th><th>Route</th><th>Time</th></tr></thead><tbody>
            {(summary.recentErrors ?? []).map((row: any) => <tr key={row.id}><td>{row.message}</td><td>{row.source}</td><td>{row.route ?? '-'}</td><td>{new Date(row.createdAt).toLocaleString()}</td></tr>)}
          </tbody></table>
        </section>
        <section className="panel section-panel">
          <h2>Upload Failures</h2>
          <table><thead><tr><th>File</th><th>Type</th><th>Rejected</th><th>Time</th></tr></thead><tbody>
            {(summary.failedUploads ?? []).map((row: any) => <tr key={row.id}><td>{row.fileName}</td><td>{row.sourceType}</td><td>{row.rowsRejected}</td><td>{new Date(row.createdAt).toLocaleString()}</td></tr>)}
          </tbody></table>
        </section>
      </div>
      <IssueManager initialIssues={Array.isArray(issues) ? issues : []} />
    </div>
  );
}
