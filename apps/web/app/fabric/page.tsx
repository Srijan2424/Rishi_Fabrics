import { FabricSnapshotTable } from "../components/FabricSnapshotTable";
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
        <FabricSnapshotTable rows={rows} />
      </section>
    </>
  );
}
