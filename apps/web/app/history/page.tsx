import { getHistory } from "../lib/api";

type HistoryTab = "sampling" | "fabric" | "production";

type HistoryRow = Record<string, string | number | null>;

type HistoryGroup = {
  month: string;
  label: string;
  rows: HistoryRow[];
};

const tabs: Array<{ key: HistoryTab; label: string }> = [
  { key: "sampling", label: "Sampling" },
  { key: "fabric", label: "Fabric" },
  { key: "production", label: "Production" }
];

function tabFromSearch(value: string | undefined): HistoryTab {
  return value === "fabric" || value === "production" ? value : "sampling";
}

function columnsFor(tab: HistoryTab) {
  if (tab === "fabric") return ["buyerName", "styleName", "colorName", "orderQuantity", "status", "dyeingParty", "completedAt"];
  if (tab === "production") return ["orderNumber", "buyerName", "productCategory", "orderQuantity", "status", "completedAt"];
  return ["orderNumber", "buyerName", "productCategory", "orderQuantity", "status", "completedAt"];
}

function labelFor(column: string) {
  return column
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase());
}

function formatCell(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleDateString();
  return String(value);
}

export default async function HistoryPage({ searchParams }: { searchParams?: Promise<{ tab?: string }> }) {
  const params = await searchParams;
  const activeTab = tabFromSearch(params?.tab);
  const result = await getHistory(activeTab);
  const groups = ((Array.isArray(result) ? [] : result.groups) ?? []) as HistoryGroup[];
  const columns = columnsFor(activeTab);
  const totalRows = groups.reduce((sum, group) => sum + group.rows.length, 0);

  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">History</div>
          <h1>Completed Work</h1>
          <p>Completed sampling, fabric, and production records grouped by month for report formation.</p>
        </div>
      </header>

      {!Array.isArray(result) && result.apiOffline ? (
        <section className="setup-warning">
          <strong>API is not reachable yet.</strong>
          <p>Error: {result.error}</p>
        </section>
      ) : null}

      <nav className="tabs">
        {tabs.map((tab) => (
          <a key={tab.key} className={tab.key === activeTab ? "active" : ""} href={`/history?tab=${tab.key}`}>
            {tab.label}
          </a>
        ))}
      </nav>

      <section className="metrics">
        <div className="metric">
          Completed Rows
          <strong>{totalRows}</strong>
        </div>
        <div className="metric">
          Months
          <strong>{groups.length}</strong>
        </div>
        <div className="metric">
          View
          <strong>{tabs.find((tab) => tab.key === activeTab)?.label}</strong>
        </div>
        <div className="metric">
          Report Ready
          <strong>{totalRows > 0 ? "Yes" : "No"}</strong>
        </div>
      </section>

      {groups.length === 0 ? (
        <section className="panel">
          <div className="empty">No completed {activeTab} records yet.</div>
        </section>
      ) : (
        groups.map((group) => (
          <section className="panel lower-grid" key={group.month}>
            <h2>{group.label}</h2>
            <table className="table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>{labelFor(column)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row, index) => (
                  <tr key={String(row.id ?? index)}>
                    {columns.map((column) => (
                      <td key={column}>{formatCell(row[column])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </>
  );
}
