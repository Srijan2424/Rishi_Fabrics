"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { authFetch } from "../lib/client-api";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";

type Factory = {
  id: string;
  name: string;
};

export function WorkflowForm({ factories }: { factories: Factory[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);

    try {
      const response = await authFetch(`${apiUrl}/workflows`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factoryId: form.get("factoryId"),
          name: form.get("name"),
          description: form.get("description"),
          stagesText: form.get("stagesText")
        })
      });

      if (!response.ok) {
        throw new Error(`API responded with ${response.status}`);
      }

      event.currentTarget.reset();
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not create workflow.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <label>
        Company / Site
        <select name="factoryId" required>
          {factories.map((factory) => (
            <option key={factory.id} value={factory.id}>{factory.name}</option>
          ))}
        </select>
      </label>
      <label>
        SOP Workflow Name
        <input name="name" placeholder="Garment Manufacturing SOP" required />
      </label>
      <label>
        Description
        <input name="description" placeholder="Approved SOP route for garment production" />
      </label>
      <label className="wide">
        Stages, One Per Line
        <textarea
          name="stagesText"
          rows={6}
          defaultValue={"Receive Order\nSample Roll Production\nSample Inspection\nApproval\nBulk Production\nInspection\nDispatch"}
          required
        />
      </label>
      <button type="submit" disabled={saving}>{saving ? "Saving..." : "Create SOP Workflow"}</button>
      {error ? <div className="form-message error wide-message">Error: {error}</div> : null}
    </form>
  );
}
