import Link from "next/link";
import { OrderForm } from "../components/OrderForm";
import { getFactories, getWipSnapshots, getWorkflows } from "../lib/api";
import { getOrders } from "../lib/api";

type Order = {
  id: string;
  orderNumber: string;
  buyerName: string;
  productCategory: string;
  orderQuantity: number;
  currentStageCode: string | null;
  deliveryDate: string;
  status: string;
};

type WipRow = {
  id: string;
  unitName: string;
  styleName: string;
  colorName: string | null;
  quantity: number;
  comments: string | null;
  sourceFileName: string;
  createdAt: string;
};

const samplingStageCodes = new Set([
  "INQUIRY",
  "DEVELOPMENT",
  "SAMPLE_CREATION",
  "SAMPLE_APPROVAL",
  "ORDER_CONFIRMATION",
  "LAB_DIP_APPROVAL",
  "FOB_APPROVAL",
  "PO_CONFIRMATION"
]);

export default async function OrdersPage() {
  const [result, factoriesResult, workflowsResult, wipResult] = await Promise.all([
    getOrders(),
    getFactories(),
    getWorkflows(),
    getWipSnapshots()
  ]);
  const orders = (Array.isArray(result) ? result : result.rows) as Order[];
  const productionOrders = orders.filter((order) => (
    order.status !== "CANCELLED" &&
    order.status !== "DRAFT" &&
    order.status !== "DISPATCHED" &&
    !samplingStageCodes.has(order.currentStageCode ?? "")
  ));
  const factories = (Array.isArray(factoriesResult) ? factoriesResult : factoriesResult.rows) as Array<{ id: string; name: string }>;
  const workflows = (Array.isArray(workflowsResult) ? workflowsResult : workflowsResult.rows) as Array<{ id: string; name: string }>;
  const wipRows = (Array.isArray(wipResult) ? wipResult : wipResult.rows) as WipRow[];

  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">Orders</div>
          <h1>Production Orders</h1>
          <p>Approved orders currently in production. Sampling-stage orders are managed separately.</p>
        </div>
      </header>

      {!Array.isArray(result) && result.apiOffline ? (
        <section className="setup-warning">
          <strong>API is not reachable yet.</strong>
          <p>
            The frontend is running, but it cannot connect to <code>{result.apiUrl}</code>. Start
            the backend with <code>npm run dev:api</code>, then refresh this page.
          </p>
          <p className="setup-error">Error: {result.error}</p>
        </section>
      ) : null}

      <section className="grid">
        <div className="panel">
          <h2>Orders</h2>
          {productionOrders.length === 0 ? (
            <div className="empty">No production orders found. Approve sampling orders to move them here.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Buyer</th>
                  <th>Category</th>
                  <th>Stage</th>
                  <th>Qty</th>
                  <th>Delivery</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {productionOrders.map((order) => (
                  <tr key={order.id}>
                    <td><Link className="link" href={`/orders/${order.id}`}>{order.orderNumber}</Link></td>
                    <td>{order.buyerName}</td>
                    <td>{order.productCategory}</td>
                    <td>{order.currentStageCode ?? "Not started"}</td>
                    <td>{order.orderQuantity.toLocaleString()}</td>
                    <td>{new Date(order.deliveryDate).toLocaleDateString()}</td>
                    <td>
                      <span className={`status ${order.status}`}>{order.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <h2>Create Order</h2>
          <OrderForm factories={factories} workflows={workflows} />
        </div>
      </section>

      <section className="panel lower-grid">
        <h2>Latest WIP Snapshot</h2>
        {wipRows.length === 0 ? (
          <div className="empty">No WIP snapshots yet. Upload WIP Report from Imports and save it to Orders/WIP.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Style</th>
                <th>Colour</th>
                <th>Qty</th>
                <th>Comments</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {wipRows.slice(0, 50).map((row) => (
                <tr key={row.id}>
                  <td>{row.unitName}</td>
                  <td><strong>{row.styleName}</strong></td>
                  <td>{row.colorName ?? "-"}</td>
                  <td>{row.quantity.toLocaleString()}</td>
                  <td>{row.comments ?? "-"}</td>
                  <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
