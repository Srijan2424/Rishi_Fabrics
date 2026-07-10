const samplingApprovals = [
  {
    name: "Lab Dip Approval by Buyer",
    owner: "Merchant",
    timeframe: "Variable",
    evidence: "Buyer approval comment or shade confirmation"
  },
  {
    name: "FOB Approval by Buyer",
    owner: "Merchant",
    timeframe: "Variable",
    evidence: "Buyer approval or revised costing confirmation"
  },
  {
    name: "P.O",
    owner: "Merchant",
    timeframe: "Required before production lock",
    evidence: "Purchase order reference"
  },
  {
    name: "Fabric Cutting Swatch",
    owner: "Sampling / Fabric",
    timeframe: "Internal",
    evidence: "Swatch cutting status"
  },
  {
    name: "Size Ratio",
    owner: "Merchant",
    timeframe: "Qty in pcs",
    evidence: "Ratio quantity confirmation"
  },
  {
    name: "Trims Card with Trims",
    owner: "Merchant / Store",
    timeframe: "Internal",
    evidence: "Trim card image or checklist"
  },
  {
    name: "P.P Comments from Buyer Side",
    owner: "Merchant",
    timeframe: "Variable",
    evidence: "Buyer comments and revision notes"
  },
  {
    name: "PP Sealer Garment",
    owner: "Sampling",
    timeframe: "Before bulk approval",
    evidence: "Sealer garment approval"
  },
  {
    name: "Size Set Approval",
    owner: "Merchant / Buyer",
    timeframe: "Variable, domestic only",
    evidence: "Domestic size set approval"
  }
];

const statusOptions = ["Pending", "Submitted", "Approved", "Revision Required"];

export default function SamplingPage() {
  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">Sampling</div>
          <h1>Sampling Approvals</h1>
          <p>Track buyer approvals and merchant-owned sampling checkpoints before bulk production begins.</p>
        </div>
      </header>

      <section className="grid">
        <div className="panel">
          <h2>Approval Tracker</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Checkpoint</th>
                <th>Owner</th>
                <th>Timeframe</th>
                <th>Evidence</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {samplingApprovals.map((approval) => (
                <tr key={approval.name}>
                  <td>
                    <strong>{approval.name}</strong>
                  </td>
                  <td>{approval.owner}</td>
                  <td>{approval.timeframe}</td>
                  <td>{approval.evidence}</td>
                  <td>
                    <select className="table-select" defaultValue="Pending" aria-label={`${approval.name} status`}>
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Tech Pack Intake</h2>
          <div className="sampling-card">
            <p>
              Sampling starts from a tech pack uploaded through Imports. The uploaded file becomes the source for
              approval checkpoints, size ratio quantities, trims card references, and buyer comments.
            </p>
            <a className="button-link" href="/imports">Open Imports</a>
          </div>
          <div className="sampling-card">
            <strong>Manual Control</strong>
            <span>Operators, merchants, or leadership can mark each approval manually after buyer confirmation.</span>
          </div>
          <div className="sampling-card">
            <strong>Next Data Model</strong>
            <span>These checkpoints should become order-linked SamplingApproval records with files, comments, dates, and approver history.</span>
          </div>
        </div>
      </section>
    </>
  );
}
