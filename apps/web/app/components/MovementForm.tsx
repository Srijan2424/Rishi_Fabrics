"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";

type Stage = {
  stageCode: string;
  stageName: string;
};

export function MovementForm({ orderId, stages }: { orderId: string; stages: Stage[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch(`${apiUrl}/orders/${orderId}/movements`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromStageCode: form.get("fromStageCode"),
          toStageCode: form.get("toStageCode"),
          quantity: Number(form.get("quantity")),
          movementType: form.get("movementType"),
          notes: form.get("notes")
        })
      });

      if (!response.ok) {
        throw new Error(`API responded with ${response.status}`);
      }

      event.currentTarget.reset();
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not move quantity.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form compact" onSubmit={onSubmit}>
      <label>
        From
        <select name="fromStageCode">
          {stages.map((stage) => (
            <option key={stage.stageCode} value={stage.stageCode}>{stage.stageName}</option>
          ))}
        </select>
      </label>
      <label>
        To
        <select name="toStageCode" required>
          {stages.map((stage) => (
            <option key={stage.stageCode} value={stage.stageCode}>{stage.stageName}</option>
          ))}
        </select>
      </label>
      <label>
        Quantity
        <input name="quantity" type="number" min="1" required />
      </label>
      <label>
        Type
        <select name="movementType">
          <option value="FORWARD">Forward</option>
          <option value="ROLLBACK">Rollback</option>
          <option value="DISPATCH">Dispatch</option>
        </select>
      </label>
      <label className="wide">
        Notes
        <input name="notes" placeholder="Optional movement note" />
      </label>
      <button type="submit" disabled={saving}>{saving ? "Moving..." : "Move Quantity"}</button>
      {error ? <div className="form-message error wide-message">Error: {error}</div> : null}
    </form>
  );
}
