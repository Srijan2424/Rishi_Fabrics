"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { authFetch } from "../lib/client-api";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";

type Stage = {
  stageCode: string;
  stageName: string;
  plannedQuantity: number;
  completedQuantity: number;
};

function nextStageCode(stages: Stage[], fromStageCode: string) {
  const index = stages.findIndex((stage) => stage.stageCode === fromStageCode);
  if (index < 0) return stages[0]?.stageCode ?? "";
  return stages[index + 1]?.stageCode ?? stages[index]?.stageCode ?? "";
}

export function MovementForm({
  orderId,
  stages,
  currentStageCode
}: {
  orderId: string;
  stages: Stage[];
  currentStageCode?: string | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const defaultFromStageCode = useMemo(() => {
    const currentStage = stages.find((stage) => stage.stageCode === currentStageCode && stage.completedQuantity > 0);
    if (currentStage) return currentStage.stageCode;

    const lastCompletedStage = [...stages].reverse().find((stage) => stage.completedQuantity > 0);
    return lastCompletedStage?.stageCode ?? stages[0]?.stageCode ?? "";
  }, [currentStageCode, stages]);
  const [fromStageCode, setFromStageCode] = useState(defaultFromStageCode);
  const [toStageCode, setToStageCode] = useState(nextStageCode(stages, defaultFromStageCode));

  const sourceStage = stages.find((stage) => stage.stageCode === fromStageCode);
  const targetStage = stages.find((stage) => stage.stageCode === toStageCode);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const quantity = Number(form.get("quantity"));

    if (!fromStageCode || !toStageCode) {
      setSaving(false);
      setError("Choose both source and target stages.");
      return;
    }

    if (fromStageCode === toStageCode) {
      setSaving(false);
      setError("Source and target stage cannot be the same.");
      return;
    }

    try {
      const response = await authFetch(`${apiUrl}/orders/${orderId}/movements`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromStageCode,
          toStageCode,
          quantity,
          movementType: form.get("movementType"),
          notes: form.get("notes")
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? `API responded with ${response.status}`);
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
        <select
          name="fromStageCode"
          value={fromStageCode}
          onChange={(event) => {
            const nextFromStageCode = event.target.value;
            setFromStageCode(nextFromStageCode);
            setToStageCode(nextStageCode(stages, nextFromStageCode));
          }}
        >
          {stages.map((stage) => (
            <option key={stage.stageCode} value={stage.stageCode}>
              {stage.stageName} ({stage.completedQuantity.toLocaleString()} done)
            </option>
          ))}
        </select>
      </label>
      <label>
        To
        <select name="toStageCode" value={toStageCode} onChange={(event) => setToStageCode(event.target.value)} required>
          {stages.map((stage) => (
            <option key={stage.stageCode} value={stage.stageCode} disabled={stage.stageCode === fromStageCode}>
              {stage.stageName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Quantity
        <input name="quantity" type="number" min="1" max={sourceStage?.completedQuantity || undefined} required />
        {sourceStage ? (
          <span className="field-hint">
            Source complete: {sourceStage.completedQuantity.toLocaleString()} / {sourceStage.plannedQuantity.toLocaleString()}
          </span>
        ) : null}
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
      <button type="submit" disabled={saving || !targetStage || fromStageCode === toStageCode}>
        {saving ? "Moving..." : "Move Quantity"}
      </button>
      {error ? <div className="form-message error wide-message">Error: {error}</div> : null}
    </form>
  );
}
