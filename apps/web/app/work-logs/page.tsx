import { getCurrentUser, getWorkLogs } from "../lib/api";

export default async function WorkLogsPage() {
  const user = await getCurrentUser();
  if (!user?.permissions.includes("VIEW_WORK_LOGS")) {
    return <div className="panel empty">Forbidden. Work Logs are private to Admin.</div>;
  }

  const rows = await getWorkLogs();
  const logs = Array.isArray(rows) ? rows : [];
  const modules = new Set(logs.map((row: any) => row.module));

  return (
    <div>
      <div className="page-header">
        <div>
          <span className="eyebrow">Admin private</span>
          <h1>Work Logs</h1>
          <p>Automatic task completion records across uploads, sampling edits, reports, and issue handling.</p>
        </div>
      </div>
      <section className="metrics">
        <div className="metric"><span>Entries</span><strong>{logs.length}</strong></div>
        <div className="metric"><span>Users</span><strong>{new Set(logs.map((row: any) => row.userId)).size}</strong></div>
        <div className="metric"><span>Modules</span><strong>{modules.size}</strong></div>
        <div className="metric"><span>Today</span><strong>{logs.filter((row: any) => new Date(row.createdAt).toDateString() === new Date().toDateString()).length}</strong></div>
      </section>
      <section className="panel section-panel">
        <table>
          <thead><tr><th>User</th><th>Module</th><th>Action</th><th>Item</th><th>Notes</th><th>Timestamp</th></tr></thead>
          <tbody>{logs.map((row: any) => <tr key={row.id}><td>{row.user?.name ?? row.userId}</td><td>{row.module}</td><td>{row.action}</td><td>{row.itemLabel ?? row.itemId ?? '-'}</td><td>{row.notes ?? '-'}</td><td>{new Date(row.createdAt).toLocaleString()}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}
