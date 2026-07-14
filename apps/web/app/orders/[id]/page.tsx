import Link from "next/link";
import { MovementForm } from "../../components/MovementForm";
import { ReworkForm } from "../../components/ReworkForm";
import { getOrder } from "../../lib/api";

type OrderStage = {
  id: string;
  stageCode: string;
  stageName: string;
  plannedQuantity: number;
  completedQuantity: number;
  workflowStage?: { sequence: number };
};

type TimelineEvent = {
  id: string;
  message: string;
  type: string;
  createdAt: string;
};

type ReworkTicket = {
  id: string;
  sourceStageCode: string;
  quantity: number;
  reason: string;
};

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id);

  if (!order || order.apiOffline || !order.id) {
    return (
      <section className="panel">
        <h2>Order Not Available</h2>
        <div className="empty">The order could not be loaded. Check that the API is running.</div>
      </section>
    );
  }

  const stages = [...(order.stages as OrderStage[])].sort(
    (left, right) => (left.workflowStage?.sequence ?? 0) - (right.workflowStage?.sequence ?? 0)
  );
  const events = order.events as TimelineEvent[];
  const reworkTickets = order.reworkTickets as ReworkTicket[];

  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">Order Detail</div>
          <h1>{order.orderNumber}</h1>
          <p>{order.buyerName} · {order.productCategory} · {order.orderQuantity.toLocaleString()} units</p>
        </div>
        <Link className="button-secondary" href="/orders">Back to Orders</Link>
      </header>

      <section className="metrics">
        <div className="metric">Current Stage<strong>{order.currentStageCode}</strong></div>
        <div className="metric">Order Quantity<strong>{order.orderQuantity.toLocaleString()}</strong></div>
        <div className="metric">Rework Tickets<strong>{reworkTickets.length}</strong></div>
        <div className="metric">Status<strong>{order.status}</strong></div>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Stage Progress</h2>
          <div className="stage-list">
            {stages.map((stage) => {
              const percent = Math.min(100, Math.round((stage.completedQuantity / stage.plannedQuantity) * 100));
              return (
                <div className="stage-row" key={stage.id}>
                  <div>
                    <strong>{stage.stageName}</strong>
                    <span>{stage.completedQuantity.toLocaleString()} / {stage.plannedQuantity.toLocaleString()}</span>
                  </div>
                  <div className="progress"><span style={{ width: `${percent}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <h2>Move Quantity</h2>
          <MovementForm orderId={order.id} stages={stages} currentStageCode={order.currentStageCode} />
        </div>
      </section>

      <section className="grid lower-grid">
        <div className="panel">
          <h2>Rework</h2>
          <ReworkForm orderId={order.id} stages={stages} />
          {reworkTickets.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Qty</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {reworkTickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>{ticket.sourceStageCode}</td>
                    <td>{ticket.quantity.toLocaleString()}</td>
                    <td>{ticket.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>

        <div className="panel">
          <h2>Timeline</h2>
          <ul className="timeline">
            {events.map((event) => (
              <li key={event.id}>
                {event.message}
                <span>{event.type} · {new Date(event.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

