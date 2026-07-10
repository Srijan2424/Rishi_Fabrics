"use client";

import { useCallback, useEffect, useState } from "react";
import { SamplingWorkspace } from "../components/SamplingWorkspace";
import { TechPackUpload } from "../components/TechPackUpload";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";

type Order = {
  id: string;
  orderNumber: string;
  buyerName: string;
  productCategory: string;
  orderQuantity: number;
  currentStageCode: string | null;
  deliveryDate: string;
  createdAt: string;
  status: string;
  samplingApprovals: Array<{
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
  }>;
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

function isSamplingOrder(order: Order) {
  return samplingStageCodes.has(order.currentStageCode ?? "");
}

async function fetchOrders() {
  const response = await fetch(`${apiUrl}/orders`, {
    cache: "no-store",
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(`API responded with ${response.status}`);
  }

  const result = await response.json();
  return (Array.isArray(result) ? result : result.rows) as Order[];
}

async function fetchTechPackStyles() {
  const response = await fetch(`${apiUrl}/sampling/tech-packs/styles`, {
    cache: "no-store",
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(`API responded with ${response.status}`);
  }

  return response.json() as Promise<TechPackStyle[]>;
}

export default function SamplingPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [techPackStyles, setTechPackStyles] = useState<TechPackStyle[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState("");

  const loadOrders = useCallback(async () => {
    try {
      setApiError("");
      const nextOrders = await fetchOrders();
      setOrders(nextOrders);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unknown API error");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTechPackStyles = useCallback(async () => {
    try {
      setTechPackStyles(await fetchTechPackStyles());
    } catch {
      setTechPackStyles([]);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
    void loadTechPackStyles();
  }, [loadOrders, loadTechPackStyles]);

  const activeOrders = orders.filter((order) => isSamplingOrder(order) && order.status !== "CANCELLED");
  const removedOrders = orders.filter((order) => isSamplingOrder(order) && order.status === "CANCELLED");

  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">Sampling</div>
          <h1>Sampling Approvals</h1>
          <p>Choose sampling-stage orders, mark buyer approvals, remove rejected samples, or revive them when needed.</p>
        </div>
      </header>

      {apiError ? (
        <section className="setup-warning">
          <strong>API is not reachable yet.</strong>
          <p>
            The frontend is running, but it cannot connect to <code>{apiUrl}</code>. Start
            the backend with <code>npm run dev:api</code>, then refresh this page.
          </p>
          <p className="setup-error">Error: {apiError}</p>
        </section>
      ) : null}

      {loading ? (
        <section className="panel">
          <div className="empty">Loading sampling orders...</div>
        </section>
      ) : (
        <SamplingWorkspace activeOrders={activeOrders} removedOrders={removedOrders} techPackStyles={techPackStyles} onChanged={loadOrders} />
      )}

      <section className="grid lower-grid">
        <div className="panel">
          <h2>Tech Pack Intake</h2>
          <TechPackUpload onUploaded={async () => {
            await loadOrders();
            await loadTechPackStyles();
          }} />
        </div>

        <div className="panel">
          <h2>Sampling Rule</h2>
          <div className="sampling-card">
            <strong>Only sampling-stage orders appear here.</strong>
            <span>Once approved for production, the order moves out of Sampling and appears on the Production Orders page.</span>
          </div>
        </div>
      </section>
    </>
  );
}
