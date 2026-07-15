"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { authFetch, clientApiUrl } from "../lib/client-api";

export type FabricRow = {
  id: string;
  buyerName: string;
  styleName: string;
  colorName: string;
  fabricDescription: string | null;
  orderQuantity: number;
  fabricSentForDyeingKg: number;
  inhouseAfterDyeingKg: number;
  actualShortageFabricBalanceKg: number;
  status: string | null;
  dyeingParty: string | null;
};

function isLikelyUnhelpful(row: FabricRow) {
  const text = [row.styleName, row.colorName, row.fabricDescription, row.status, row.dyeingParty].join(" ").toUpperCase();
  const allQuantitiesEmpty =
    row.orderQuantity === 0 &&
    row.fabricSentForDyeingKg === 0 &&
    row.inhouseAfterDyeingKg === 0 &&
    row.actualShortageFabricBalanceKg === 0;

  return text.includes("GRAND TOTAL") || (allQuantitiesEmpty && !row.status && !row.dyeingParty);
}

export function FabricSnapshotTable({ rows }: { rows: FabricRow[] }) {
  const router = useRouter();
  const [visibleRows, setVisibleRows] = useState(rows);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedRows = useMemo(() => {
    return [...visibleRows].sort((left, right) => Number(isLikelyUnhelpful(right)) - Number(isLikelyUnhelpful(left)));
  }, [visibleRows]);

  async function removeRow(row: FabricRow) {
    const confirmed = window.confirm(`Remove this fabric row?\n\n${row.buyerName} - ${row.styleName} - ${row.colorName}`);
    if (!confirmed) return;

    setDeletingId(row.id);
    setError(null);

    try {
      const response = await authFetch(`${clientApiUrl}/fabric/snapshots/${row.id}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `API responded with ${response.status}`);
      }

      setVisibleRows((current) => current.filter((item) => item.id !== row.id));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove fabric row");
    } finally {
      setDeletingId(null);
    }
  }

  if (visibleRows.length === 0) {
    return <div className="empty">No fabric snapshots yet. Upload Fabric / Dyeing from Imports and save it to the Fabric module.</div>;
  }

  return (
    <>
      {error ? <div className="error-banner">Error: {error}</div> : null}
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
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.slice(0, 500).map((row) => (
            <tr key={row.id} className={isLikelyUnhelpful(row) ? "warning-row" : undefined}>
              <td>{row.buyerName}</td>
              <td>
                <strong>{row.styleName}</strong>
                {isLikelyUnhelpful(row) ? <span className="muted-row">Likely total or empty row</span> : null}
              </td>
              <td>{row.colorName}</td>
              <td>{row.fabricDescription ?? "-"}</td>
              <td>{row.orderQuantity.toLocaleString()}</td>
              <td>{Math.round(row.fabricSentForDyeingKg).toLocaleString()}</td>
              <td>{Math.round(row.inhouseAfterDyeingKg).toLocaleString()}</td>
              <td>{row.actualShortageFabricBalanceKg.toLocaleString()}</td>
              <td>{row.status ?? "-"}</td>
              <td>{row.dyeingParty ?? "-"}</td>
              <td>
                <button
                  className="danger-button"
                  type="button"
                  disabled={deletingId === row.id}
                  onClick={() => removeRow(row)}
                >
                  {deletingId === row.id ? "Removing..." : "Remove"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
