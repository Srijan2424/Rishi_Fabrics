"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { authFetch } from "../lib/client-api";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";

function assetSrc(url: string) {
  return url.startsWith("http://") || url.startsWith("https://") ? url : `${apiUrl}${url}`;
}

type SamplingOrder = {
  id: string;
  orderNumber: string;
  buyerName: string;
  productCategory: string;
  orderQuantity: number;
  currentStageCode: string | null;
  deliveryDate: string;
  createdAt: string;
  status: string;
  samplingApprovals: SamplingApproval[];
};

type SamplingApproval = {
  id: string;
  checkpointCode: string;
  label: string;
  owner: string;
  timeframe: string;
  evidence: string;
  status: "PENDING" | "SUBMITTED" | "APPROVED" | "REVISION_REQUIRED";
  comments: string | null;
  approvedAt: string | null;
  updatedAt: string;
};

type TechPackStyle = {
  id: string;
  styleNumber: string;
  previewImageUrl: string | null;
  previewPageNumber: number | null;
  sourceFileName: string;
  descriptionOne: string | null;
  descriptionTwo: string | null;
  colorways: string | null;
  mainMaterials: string | null;
};

const defaultApprovals: SamplingApproval[] = [
  ["LAB_DIP_APPROVAL", "Lab Dip Approval by Buyer"],
  ["FOB_APPROVAL", "FOB Approval by Buyer"],
  ["PO", "P.O"],
  ["FABRIC_CUTTING_SWATCH", "Fabric Cutting Swatch"],
  ["SIZE_RATIO", "Size Ratio"],
  ["TRIMS_CARD", "Trims Card with Trims"],
  ["PP_COMMENTS", "P.P Comments from Buyer Side"],
  ["PP_SEALER_GARMENT", "PP Sealer Garment"],
  ["FPT", "FPT"],
  ["GPT", "GPT"],
  ["SIZE_SET_APPROVAL", "Size Set Approval"]
].map(([checkpointCode, label]) => ({
  id: checkpointCode,
  checkpointCode,
  label,
  owner: "Merchant",
  timeframe: "Variable",
  evidence: "Pending update",
  status: "PENDING",
  comments: null,
  approvedAt: null,
  updatedAt: ""
}));

const statusOptions = [
  ["PENDING", "Pending"],
  ["SUBMITTED", "Submitted"],
  ["APPROVED", "Approved"],
  ["REVISION_REQUIRED", "Revision Required"]
] as const;

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export function SamplingWorkspace({
  activeOrders,
  removedOrders,
  techPackStyles,
  onChanged
}: {
  activeOrders: SamplingOrder[];
  removedOrders: SamplingOrder[];
  techPackStyles?: TechPackStyle[];
  onChanged?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"ACTIVE" | "REMOVED">("ACTIVE");
  const [roleMode, setRoleMode] = useState<"MERCHANT" | "CEO" | "HEAD_OF_OPERATIONS">("MERCHANT");
  const [selectedOrderId, setSelectedOrderId] = useState(activeOrders[0]?.id ?? "");
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});
  const [detailDrafts, setDetailDrafts] = useState<Record<string, {
    orderNumber: string;
    buyerName: string;
    productCategory: string;
  }>>({});

  useEffect(() => {
    setCurrentTime(Date.now());
  }, []);

  useEffect(() => {
    setQuantityDrafts((current) => {
      const next = { ...current };
      for (const order of activeOrders) {
        if (next[order.id] === undefined) {
          next[order.id] = String(order.orderQuantity);
        }
      }
      return next;
    });

    setDetailDrafts((current) => {
      const next = { ...current };
      for (const order of activeOrders) {
        if (next[order.id] === undefined) {
          next[order.id] = {
            orderNumber: order.orderNumber,
            buyerName: order.buyerName,
            productCategory: order.productCategory
          };
        }
      }
      return next;
    });
  }, [activeOrders]);

  useEffect(() => {
    if (activeOrders.length === 0) {
      setSelectedOrderId("");
      return;
    }

    if (!activeOrders.some((order) => order.id === selectedOrderId)) {
      setSelectedOrderId(activeOrders[0].id);
    }
  }, [activeOrders, selectedOrderId]);

  function getDaysInSampling(createdAt: string) {
    if (currentTime === null) return 0;

    return Math.max(0, Math.ceil((currentTime - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)));
  }

  const selectedOrder = useMemo(
    () => activeOrders.find((order) => order.id === selectedOrderId) ?? activeOrders[0],
    [activeOrders, selectedOrderId]
  );
  const selectedApprovals = selectedOrder?.samplingApprovals.length
    ? selectedOrder.samplingApprovals
    : defaultApprovals;
  const approvedCount = selectedApprovals.filter((approval) => approval.status === "APPROVED").length;
  const samplingProgressPercent = selectedApprovals.length > 0
    ? Math.round((approvedCount / selectedApprovals.length) * 100)
    : 0;
  const selectedDaysInSampling = selectedOrder ? getDaysInSampling(selectedOrder.createdAt) : 0;
  const canEditSampling = roleMode === "MERCHANT";
  const selectedTechPackStyle = selectedOrder
    ? techPackStyles?.find((style) => style.styleNumber === selectedOrder.orderNumber)
    : undefined;

  async function updateSamplingDecision(orderId: string, action: "REMOVE" | "REVIVE") {
    const order = action === "REMOVE"
      ? activeOrders.find((activeOrder) => activeOrder.id === orderId)
      : removedOrders.find((removedOrder) => removedOrder.id === orderId);

    if (action === "REMOVE") {
      const confirmed = window.confirm(
        `Remove this style from active sampling?\n\n${order?.orderNumber ?? "Selected style"} will move to Removed Samples and can be revived later.`
      );

      if (!confirmed) return;
    }

    setSavingId(orderId);
    setError("");

    try {
      const response = await authFetch(`${apiUrl}/orders/${orderId}/sampling-decision`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action,
          target: "STYLE",
          reason: action === "REMOVE" ? "Sampling not accepted by factory" : undefined
        })
      });
      const body = await readResponseBody(response);

      if (!response.ok) {
        throw new Error(body.error ?? `API responded with ${response.status}`);
      }

      await onChanged?.();
      if (action === "REMOVE") {
        const remainingActiveOrders = activeOrders.filter((activeOrder) => activeOrder.id !== orderId);
        setSelectedOrderId(remainingActiveOrders[0]?.id ?? "");
        if (remainingActiveOrders.length === 0) {
          setTab("REMOVED");
        }
      } else {
        setSelectedOrderId(orderId);
        setTab("ACTIVE");
      }
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Sampling update failed.");
    } finally {
      setSavingId("");
    }
  }

  async function updateSamplingApproval(orderId: string, checkpointCode: string, status: SamplingApproval["status"]) {
    setSavingId(`${orderId}:${checkpointCode}`);
    setError("");

    try {
      const response = await authFetch(`${apiUrl}/orders/${orderId}/sampling-approvals/${checkpointCode}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          status
        })
      });
      const body = await readResponseBody(response);

      if (!response.ok) {
        throw new Error(body.error ?? `API responded with ${response.status}`);
      }

      await onChanged?.();
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Sampling approval update failed.");
    } finally {
      setSavingId("");
    }
  }

  async function updateSamplingQuantity(order: SamplingOrder) {
    const quantity = Number(quantityDrafts[order.id] ?? order.orderQuantity);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("Quantity must be a positive whole number.");
      setQuantityDrafts((current) => ({ ...current, [order.id]: String(order.orderQuantity) }));
      return;
    }

    if (quantity === order.orderQuantity) {
      return;
    }

    setSavingId(`qty:${order.id}`);
    setError("");

    try {
      const response = await authFetch(`${apiUrl}/orders/${order.id}/sampling-quantity`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          orderQuantity: quantity
        })
      });
      const body = await readResponseBody(response);

      if (!response.ok) {
        throw new Error(body.error ?? `API responded with ${response.status}`);
      }

      await onChanged?.();
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Sampling quantity update failed.");
      setQuantityDrafts((current) => ({ ...current, [order.id]: String(order.orderQuantity) }));
    } finally {
      setSavingId("");
    }
  }

  async function updateSamplingDetails(order: SamplingOrder) {
    const draft = detailDrafts[order.id] ?? {
      orderNumber: order.orderNumber,
      buyerName: order.buyerName,
      productCategory: order.productCategory
    };
    const nextDetails = {
      orderNumber: draft.orderNumber.trim(),
      buyerName: draft.buyerName.trim(),
      productCategory: draft.productCategory.trim()
    };

    if (nextDetails.orderNumber.length < 2 || nextDetails.buyerName.length < 2 || nextDetails.productCategory.length < 2) {
      setError("Style code, buyer/brand, and description must each be at least 2 characters.");
      setDetailDrafts((current) => ({
        ...current,
        [order.id]: {
          orderNumber: order.orderNumber,
          buyerName: order.buyerName,
          productCategory: order.productCategory
        }
      }));
      return;
    }

    if (
      nextDetails.orderNumber === order.orderNumber &&
      nextDetails.buyerName === order.buyerName &&
      nextDetails.productCategory === order.productCategory
    ) {
      return;
    }

    setSavingId(`details:${order.id}`);
    setError("");

    try {
      const response = await authFetch(`${apiUrl}/orders/${order.id}/sampling-details`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(nextDetails)
      });
      const body = await readResponseBody(response);

      if (!response.ok) {
        throw new Error(body.error ?? `API responded with ${response.status}`);
      }

      await onChanged?.();
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Sampling details update failed.");
      setDetailDrafts((current) => ({
        ...current,
        [order.id]: {
          orderNumber: order.orderNumber,
          buyerName: order.buyerName,
          productCategory: order.productCategory
        }
      }));
    } finally {
      setSavingId("");
    }
  }

  function updateDetailDraft(orderId: string, field: "orderNumber" | "buyerName" | "productCategory", value: string) {
    setDetailDrafts((current) => ({
      ...current,
      [orderId]: {
        ...(current[orderId] ?? { orderNumber: "", buyerName: "", productCategory: "" }),
        [field]: value
      }
    }));
  }

  function submitDetailsOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  }

  return (
    <section className="grid">
      <div className="panel">
        <div className="tab-header">
          <h2>Sampling Orders</h2>
          <div className="segmented">
            <button className={tab === "ACTIVE" ? "active" : ""} type="button" onClick={() => setTab("ACTIVE")}>
              Active Sampling
            </button>
            <button className={tab === "REMOVED" ? "active" : ""} type="button" onClick={() => setTab("REMOVED")}>
              Removed Samples
            </button>
          </div>
        </div>
        <div className="role-strip">
          <span>Viewing as</span>
          <select className="table-select" value={roleMode} onChange={(event) => setRoleMode(event.target.value as typeof roleMode)}>
            <option value="MERCHANT">Merchant - editable</option>
            <option value="CEO">CEO - read only</option>
            <option value="HEAD_OF_OPERATIONS">Operations - read only</option>
          </select>
        </div>

        {error ? <div className="form-message error inline-panel-message">Error: {error}</div> : null}

        {tab === "ACTIVE" ? (
          activeOrders.length === 0 ? (
            <div className="empty">No orders are currently in sampling.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Order / Style</th>
                  <th>Buyer</th>
                  <th>Stage</th>
                  <th>Qty</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeOrders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <button className="link-button" type="button" onClick={() => setSelectedOrderId(order.id)}>
                        {order.orderNumber}
                      </button>
                      <span className="muted-row">{order.productCategory}</span>
                    </td>
                    <td>{order.buyerName}</td>
                    <td>
                      {order.currentStageCode ?? "Sampling"}
                      <span className="muted-row">
                        {getDaysInSampling(order.createdAt)} day(s)
                      </span>
                    </td>
                    <td>
                      <input
                        className="table-input"
                        type="number"
                        min={1}
                        value={quantityDrafts[order.id] ?? String(order.orderQuantity)}
                        disabled={!canEditSampling || savingId === `qty:${order.id}`}
                        aria-label={`Quantity for ${order.orderNumber}`}
                        onChange={(event) => setQuantityDrafts((current) => ({ ...current, [order.id]: event.target.value }))}
                        onBlur={() => updateSamplingQuantity(order)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    </td>
                    <td>
                      <div className="action-row">
                        <button
                          className="danger-button"
                          type="button"
                          disabled={!canEditSampling || savingId === order.id}
                          aria-label={`Remove ${order.orderNumber} from active sampling`}
                          onClick={() => updateSamplingDecision(order.id, "REMOVE")}
                        >
                          {savingId === order.id ? "Removing..." : "Remove"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : removedOrders.length === 0 ? (
          <div className="empty">No removed samples.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Order / Style</th>
                <th>Buyer</th>
                <th>Stage</th>
                <th>Qty</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {removedOrders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <strong>{order.orderNumber}</strong>
                    <span className="muted-row">{order.productCategory}</span>
                  </td>
                  <td>{order.buyerName}</td>
                  <td>{order.currentStageCode ?? "Sampling"}</td>
                  <td>{order.orderQuantity.toLocaleString()}</td>
                  <td>
                    <button
                      className="button-secondary"
                      type="button"
                      disabled={!canEditSampling || savingId === order.id}
                      aria-label={`Revive ${order.orderNumber} into active sampling`}
                      onClick={() => updateSamplingDecision(order.id, "REVIVE")}
                    >
                      {savingId === order.id ? "Reviving..." : "Revive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Approval Checklist</h2>
        {!selectedOrder ? (
          <div className="empty">Choose an active sampling order to mark approvals.</div>
        ) : (
          <div>
            <div className="sampling-card">
              {canEditSampling ? (
                <div className="sampling-detail-form">
                  <label>
                    Style / Order Code
                    <input
                      value={detailDrafts[selectedOrder.id]?.orderNumber ?? selectedOrder.orderNumber}
                      disabled={savingId === `details:${selectedOrder.id}`}
                      onChange={(event) => updateDetailDraft(selectedOrder.id, "orderNumber", event.target.value)}
                      onBlur={() => updateSamplingDetails(selectedOrder)}
                      onKeyDown={submitDetailsOnEnter}
                    />
                  </label>
                  <label>
                    Buyer / Brand
                    <input
                      value={detailDrafts[selectedOrder.id]?.buyerName ?? selectedOrder.buyerName}
                      disabled={savingId === `details:${selectedOrder.id}`}
                      onChange={(event) => updateDetailDraft(selectedOrder.id, "buyerName", event.target.value)}
                      onBlur={() => updateSamplingDetails(selectedOrder)}
                      onKeyDown={submitDetailsOnEnter}
                    />
                  </label>
                  <label>
                    Style Description
                    <input
                      value={detailDrafts[selectedOrder.id]?.productCategory ?? selectedOrder.productCategory}
                      disabled={savingId === `details:${selectedOrder.id}`}
                      onChange={(event) => updateDetailDraft(selectedOrder.id, "productCategory", event.target.value)}
                      onBlur={() => updateSamplingDetails(selectedOrder)}
                      onKeyDown={submitDetailsOnEnter}
                    />
                  </label>
                </div>
              ) : (
                <>
                  <strong>{selectedOrder.orderNumber}</strong>
                  <span>{selectedOrder.buyerName} · {selectedOrder.productCategory}</span>
                </>
              )}
              {selectedTechPackStyle?.previewImageUrl ? (
                <img
                  className="tech-pack-preview-image"
                  src={assetSrc(selectedTechPackStyle.previewImageUrl)}
                  alt={`${selectedOrder.orderNumber} tech pack preview`}
                />
              ) : null}
              {selectedTechPackStyle ? (
                <span>
                  {selectedTechPackStyle.colorways ? `Colorways: ${selectedTechPackStyle.colorways}` : "Tech pack style uploaded"}
                  {selectedTechPackStyle.previewPageNumber ? ` · Page ${selectedTechPackStyle.previewPageNumber}` : ""}
                </span>
              ) : null}
              <span>{selectedDaysInSampling} day(s) in sampling</span>
              <div className="progress">
                <span style={{ width: `${samplingProgressPercent}%` }} />
              </div>
              <span>{approvedCount} of {selectedApprovals.length} approvals complete · {samplingProgressPercent}%</span>
              {!canEditSampling ? <span>Read-only view. Merchant role is required to change sampling approvals.</span> : null}
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Approval</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {selectedApprovals.map((approval) => (
                  <tr key={approval.checkpointCode}>
                    <td>
                      <strong>{approval.label}</strong>
                      <span className="muted-row">{approval.timeframe} · {approval.evidence}</span>
                    </td>
                    <td>
                      <select
                        className="table-select"
                        value={approval.status}
                        disabled={!canEditSampling || savingId === `${selectedOrder.id}:${approval.checkpointCode}`}
                        aria-label={`${approval.label} status`}
                        onChange={(event) => updateSamplingApproval(
                          selectedOrder.id,
                          approval.checkpointCode,
                          event.target.value as SamplingApproval["status"]
                        )}
                      >
                        {statusOptions.map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                      {approval.approvedAt ? (
                        <span className="muted-row">Approved {new Date(approval.approvedAt).toLocaleDateString()}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
