import { ImportForm } from "../components/ImportForm";
import { getFactories, getImportStageMappings, getUploads, getWorkflows } from "../lib/api";

type StageMapping = {
  id: string;
  importType: string;
  sourceColumn: string;
  targetStageKey: string;
  quantityType: string;
  applyMode: string;
  isActive: boolean;
};

type Upload = {
  id: string;
  fileName: string;
  sourceType: string;
  status: string;
  rowsReceived: number;
  rowsAccepted: number;
  rowsRejected: number;
  createdAt: string;
};

export default async function ImportsPage() {
  const [result, factoriesResult, workflowsResult, mappingsResult] = await Promise.all([
    getUploads(),
    getFactories(),
    getWorkflows(),
    getImportStageMappings()
  ]);
  const uploads = (Array.isArray(result) ? result : result.rows) as Upload[];
  const factories = (Array.isArray(factoriesResult) ? factoriesResult : factoriesResult.rows) as Array<{ id: string; name: string }>;
  const workflows = (Array.isArray(workflowsResult) ? workflowsResult : workflowsResult.rows) as Array<{ id: string; name: string }>;
  const stageMappings = (Array.isArray(mappingsResult) ? mappingsResult : mappingsResult.rows) as StageMapping[];
  const defaultFactory = factories[0];

  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">ERP Layer</div>
          <h1>Imports</h1>
          <p>Validate ERP rows, preview accepted and rejected records, then apply approved imports safely.</p>
        </div>
      </header>

      <section className="import-guidance-grid">
        <div className="panel">
          <h2>Accepted Documents</h2>
          <div className="guidance-list">
            <p><strong>CSV / TSV / TXT:</strong> accepted directly when required headers are present.</p>
            <p><strong>Excel:</strong> accepted for daily production only after the table is extracted with row color hex values.</p>
            <p><strong>PDF / Image:</strong> accepted only after OCR/table extraction into the required columns.</p>
            <p><strong>Tech Pack:</strong> accepted when it provides order number, approval checkpoint, status, and evidence/comments.</p>
          </div>
        </div>

        <div className="panel">
          <h2>Not Accepted</h2>
          <div className="guidance-list">
            <p>Files without readable table rows.</p>
            <p>Daily production files missing buyer, style, colour, quantity, production status, or row color.</p>
            <p>Unknown Excel row colors that are not configured in the color index.</p>
            <p>Any upload with rejected rows. Apply is blocked until the preview is clean.</p>
          </div>
        </div>

        <div className="panel">
          <h2>Color Index</h2>
          <div className="color-index">
            <span><i style={{ background: "#92d050" }} /> Green / FF92D050 = Unit-I / Running Production</span>
            <span><i style={{ background: "#00b0f0" }} /> Blue / FF00B0F0 = Unit-II / 2nd Unit</span>
            <span><i style={{ background: "#ff0000" }} /> Red / FFFF0000 = Pending Production</span>
            <span><i style={{ background: "#ffff00" }} /> Yellow / FFFFFF00 = Dispatch Done</span>
          </div>
        </div>
      </section>



      <section className="panel import-stage-mapping-panel">
        <h2>Stage Mapping Config</h2>
        {stageMappings.length === 0 ? (
          <div className="empty">No daily production stage mappings configured yet. Seed the database to add defaults.</div>
        ) : (
          <table className="table dense-table">
            <thead>
              <tr>
                <th>Excel Column</th>
                <th>SOP Stage</th>
                <th>Quantity Meaning</th>
                <th>Apply Mode</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {stageMappings.map((mapping) => (
                <tr key={mapping.id}>
                  <td><strong>{mapping.sourceColumn}</strong></td>
                  <td>{mapping.targetStageKey}</td>
                  <td>{mapping.quantityType}</td>
                  <td>{mapping.applyMode}</td>
                  <td>{mapping.isActive ? "Active" : "Inactive"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Import Runs</h2>
          {uploads.length === 0 ? (
            <div className="empty">No imports yet.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Rows</th>
                  <th>Accepted</th>
                  <th>Rejected</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((upload) => (
                  <tr key={upload.id}>
                    <td>{upload.fileName}</td>
                    <td>{upload.sourceType}</td>
                    <td>{upload.status}</td>
                    <td>{upload.rowsReceived}</td>
                    <td>{upload.rowsAccepted}</td>
                    <td>{upload.rowsRejected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <h2>Create Import Preview</h2>
          <ImportForm defaultFactory={defaultFactory} workflows={workflows} />
        </div>
      </section>
    </>
  );
}
