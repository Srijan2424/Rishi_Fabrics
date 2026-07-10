"use client";

import { useState } from "react";
import { clientApiUrl } from "../lib/client-api";

type Props = {
  title: string;
  module?: "SAMPLING" | "ORDERS" | "FABRIC" | "IMPORTS" | "REPORTS" | "ISSUES" | "SYSTEM";
  linkedType?: string;
  linkedId?: string;
  context?: Record<string, unknown>;
  buttonLabel?: string;
};

export function ReportIssueButton({ title, module = "SYSTEM", linkedType, linkedId, context, buttonLabel = "Report Issue" }: Props) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setMessage("");
    const description = [
      notes ? "User notes: " + notes : "User notes: Not provided",
      "",
      "Context:",
      JSON.stringify(context ?? {}, null, 2)
    ].join("\\n");
    const response = await fetch(clientApiUrl + "/issues", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, module, priority: "MEDIUM", linkedType, linkedId, description })
    });
    setSaving(false);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setMessage(data.error ?? "Could not report issue.");
      return;
    }
    setNotes("");
    setMessage("Issue reported to Admin.");
    setOpen(false);
  }

  return (
    <div className="report-issue-inline">
      <button type="button" className="secondary-button" onClick={() => setOpen((value) => !value)}>{buttonLabel}</button>
      {open ? (
        <div className="report-issue-box">
          <label>
            What should Admin know?
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Explain why this looks like a software mistake." />
          </label>
          <button type="button" onClick={submit} disabled={saving}>{saving ? "Reporting..." : "Send to Admin"}</button>
        </div>
      ) : null}
      {message ? <span className={message.includes("reported") ? "form-success compact-message" : "form-error compact-message"}>{message}</span> : null}
    </div>
  );
}
