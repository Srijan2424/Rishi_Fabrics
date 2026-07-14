"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { authFetch } from "../lib/client-api";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";

type MovementType = "FORWARD" | "ROLLBACK" | "DISPATCH";

type Stage = {
  stageCode: string;
  stageName: string;
  plannedQuantity: number;
  completedQuantity: number;
};

function targetStageCode(stages: Stage[], fromStageCode: string, movementType: MovementType) {
  const index = stages.findIndex((stage) => stage.stageCode === fromStageCode);
  if (index < 0) return "";

  if (movementType === "ROLLBACK") return stages[index - 1]?.stageCode ?? "";
  if (movementType === "DISPATCH") {
    const nextStage = stages[index + 1];
    return nextStage?.stageCode === "DISPATCH" ? nextStage.stageCode : "";
  }

  return stages[index + 1]?.stageCode ?? "";
}

function validTargetStages(stages: Stage[], fromStageCode: string, movementType: MovementType) {
  const targetCode = targetStageCode(stages, fromStageCode, movementType);
  return stages.filter((stage) => stage.stageCode === targetCode);
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
  const [movementType, setMovementType] = useState<MovementType>("FORWARD");

  const defaultFromStageCode = useMemo(() => {
    const currentStage = stages.find((stage) => stage.stageCode === currentStageCode && stage.completedQuantity > 0);
    if (currentStage) return currentStage.stageCode;

    const lastCompletedStage = [...stages].reverse().find((stage) => stage.completedQuantity > 0);
    return lastCompletedStage?.stageCode ?? stages[0]?.stageCode ?? "";
  }, [currentStageCode, stages]);

  const [fromStageCode, setFromStageCode] = useState(defaultFromStageCode);
  const [toStageCode, setToStageCode] = useState(targetStageCode(stages, defaultFromStageCode, "FORWARD"));

  const sourceStage = stages.find((stage) => stage.stageCode === fromStageCode);
  const targetOptions = validTargetStages(stages, fromStageCode, movementType);
  const targetStage = targetOptions.find((stage) => stage.stageCode === toStageCode) ?? targetOptions[0];
  const resolvedToStageCode = targetStage?.stageCode ?? "";

  function updateFromStage(nextFromStageCode: string) {
    setFromStageCode(nextFromStageCode);
    setToStageCode(targetStageCode(stages, nextFromStageCode, movementType));
  }

  function updateMovementType(nextMovementType: MovementType) {
    setMovementType(nextMovementType);
    setToStageCode(targetStageCode(stages, fromStageCode, nextMovementType));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSaving(true);
    setError("");
    const form = new FormData(formElement);
    const quantity = Number(form.get("quantity"));

    if (!fromStageCode || !resolvedToStageCode) {
      setSaving(false);
      setError("This movement type is not valid from the selected stage.");
      return;
    }

    if (fromStageCode === resolvedToStageCode) {
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
          toStageCode: resolvedToStageCode,
          quantity,
          movementType,
          notes: form.get("notes")
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? `API responded with ${response.status}`);
      }

      formElement.reset();
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
        <select name="fromStageCode" value={fromStageCode} onChange={(event) => updateFromStage(event.target.value)}>
          {stages.map((stage) => (
            <option key={stage.stageCode} value={stage.stageCode}>
              {stage.stageName} ({stage.completedQuantity.toLocaleString()} done)
            </option>
          ))}
        </select>
      </label>
      <label>
        To
        <select name="toStageCode" value={resolvedToStageCode} onChange={(event) => setToStageCode(event.target.value)} required>
          {targetOptions.length > 0 ? (
            targetOptions.map((stage) => (
              <option key={stage.stageCode} value={stage.stageCode}>{stage.stageName}</option>
            ))
          ) : (
            <option value="">No valid target</option>
          )}
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
        <select name="movementType" value={movementType} onChange={(event) => updateMovementType(event.target.value as MovementType)}>
          <option value="FORWARD">Forward</option>
          <option value="ROLLBACK">Rollback</option>
          <option value="DISPATCH">Dispatch</option>
        </select>
      </label>
      <label className="wide">
        Notes
        <input name="notes" placeholder="Optional movement note" />
      </label>
      <button type="submit" disabled={saving || !targetStage || fromStageCode === resolvedToStageCode}>
        {saving ? "Moving..." : "Move Quantity"}
      </button>
      {error ? <div className="form-message error wide-message">Error: {error}</div> : null}
    </form>
  );
}
