"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";

type Stage = {
  stageCode: string;
  stageName: string;
};

export function ReworkForm({ orderId, stages }: { orderId: string; stages: Stage[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch(`${apiUrl}/orders/${orderId}/rework`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceStageCode: form.get("sourceStageCode"),
          quantity: Number(form.get("quantity")),
          reason: form.get("reason")
        })
      });

      if (!response.ok) {
        throw new Error(`API responded with ${response.status}`);
      }

      event.currentTarget.reset();
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not create rework.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form compact" onSubmit={onSubmit}>
      <label>
        Source Stage
        <select name="sourceStageCode" required>
          {stages.map((stage) => (
            <option key={stage.stageCode} value={stage.stageCode}>{stage.stageName}</option>
          ))}
        </select>
      </label>
      <label>
        Quantity
        <input name="quantity" type="number" min="1" required />
      </label>
      <label className="wide">
        Reason
        <input name="reason" placeholder="Reason for rework" required />
      </label>
      <button type="submit" disabled={saving}>{saving ? "Creating..." : "Create Rework"}</button>
      {error ? <div className="form-message error wide-message">Error: {error}</div> : null}
    </form>
  );
}
