import { getFabricSnapshots } from "../lib/api";

type FabricRow = {
  id: string;
  buyerName: string;
  styleName: string;
  colorName: string;
  fabricDescription: string | null;
  orderQuantity: number;
  greigeBookingKg: number;
  fabricSentForDyeingKg: number;
  inhouseAfterDyeingKg: number;
  actualShortageFabricBalanceKg: number;
  shortagePercent: number;
  status: string | null;
  dyeingParty: string | null;
  sourceFileName: string;
  createdAt: string;
};

export default async function FabricPage() {
  const result = await getFabricSnapshots();
  const rows = (Array.isArray(result) ? result : result.rows) as FabricRow[];
  const totalSent = rows.reduce((sum, row) => sum + row.fabricSentForDyeingKg, 0);
  const totalInhouse = rows.reduce((sum, row) => sum + row.inhouseAfterDyeingKg, 0);
  const shortageRows = rows.filter((row) => row.actualShortageFabricBalanceKg < 0 || row.shortagePercent < 0);

  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">Fabric</div>
          <h1>Fabric / Dyeing</h1>
          <p>Fabric booking, dyeing, in-house fabric, shortage, status, and dyeing party tracking.</p>
        </div>
      </header>

      {!Array.isArray(result) && result.apiOffline ? (
        <section className="setup-warning">
          <strong>API is not reachable yet.</strong>
          <p>Error: {result.error}</p>
        </section>
      ) : null}

      <section className="metrics">
        <div className="metric">
          Fabric Rows
          <strong>{rows.length}</strong>
        </div>
        <div className="metric">
          Sent Dyeing Kg
          <strong>{Math.round(totalSent).toLocaleString()}</strong>
        </div>
        <div className="metric">
          In-House Kg
          <strong>{Math.round(totalInhouse).toLocaleString()}</strong>
        </div>
        <div className="metric metric-warning">
          Shortage Rows
          <strong>{shortageRows.length}</strong>
        </div>
      </section>

      <section className="panel">
        <h2>Latest Fabric Snapshot</h2>
        {rows.length === 0 ? (
          <div className="empty">No fabric snapshots yet. Upload Fabric / Dyeing from Imports and save it to the Fabric module.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Buyer</th>
                <th>Style</th>
                <th>Colour</th>
                <th>Fabric</th>
                <th>Order Qty</th>
                <th>Sent</th>
                <th>In-House</th>
                <th>Shortage</th>
                <th>Status</th>
                <th>Dyeing Party</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((row) => (
                <tr key={row.id}>
                  <td>{row.buyerName}</td>
                  <td><strong>{row.styleName}</strong></td>
                  <td>{row.colorName}</td>
                  <td>{row.fabricDescription ?? "-"}</td>
                  <td>{row.orderQuantity.toLocaleString()}</td>
                  <td>{Math.round(row.fabricSentForDyeingKg).toLocaleString()}</td>
                  <td>{Math.round(row.inhouseAfterDyeingKg).toLocaleString()}</td>
                  <td>{row.actualShortageFabricBalanceKg.toLocaleString()}</td>
                  <td>{row.status ?? "-"}</td>
                  <td>{row.dyeingParty ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
