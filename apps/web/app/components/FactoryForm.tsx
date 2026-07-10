"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { authFetch } from "../lib/client-api";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";

export function FactoryForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);

    try {
      const response = await authFetch(`${apiUrl}/factories`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          code: form.get("code"),
          shiftsPerDay: Number(form.get("shiftsPerDay")),
          workingHoursPerDay: Number(form.get("workingHoursPerDay"))
        })
      });

      if (!response.ok) {
        throw new Error(`API responded with ${response.status}`);
      }

      event.currentTarget.reset();
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not create factory.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <label>
        Company / Site Name
        <input name="name" placeholder="Rishi Fabrics Limited" required />
      </label>
      <label>
        Code
        <input name="code" placeholder="RFL" required />
      </label>
      <label>
        Shifts Per Day
        <input name="shiftsPerDay" type="number" min="1" defaultValue="1" required />
      </label>
      <label>
        Working Hours
        <input name="workingHoursPerDay" type="number" min="1" defaultValue="8" required />
      </label>
      <button type="submit" disabled={saving}>{saving ? "Saving..." : "Create Company / Site"}</button>
      {error ? <div className="form-message error wide-message">Error: {error}</div> : null}
    </form>
  );
}
