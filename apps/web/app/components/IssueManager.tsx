"use client";

import { useState } from "react";
import { clientApiUrl } from "../lib/client-api";

type Issue = { id: string; title: string; status: string; priority: string; module: string; description?: string | null };

export function IssueManager({ initialIssues }: { initialIssues: Issue[] }) {
  const [issues, setIssues] = useState(initialIssues);
  const [title, setTitle] = useState("");
  const [module, setModule] = useState("SYSTEM");
  const [priority, setPriority] = useState("MEDIUM");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");

  async function createIssue() {
    setMessage("");
    const response = await fetch(clientApiUrl + "/issues", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, module, priority, description: description || undefined })
    });
    if (!response.ok) {
      setMessage("Could not create issue");
      return;
    }
    const issue = await response.json();
    setIssues([issue, ...issues]);
    setTitle("");
    setDescription("");
  }

  async function resolveIssue(id: string) {
    const response = await fetch(clientApiUrl + "/issues/" + id, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "RESOLVED" })
    });
    if (response.ok) {
      const updated = await response.json();
      setIssues(issues.map((issue) => issue.id === id ? updated : issue));
    }
  }

  return (
    <section className="panel section-panel">
      <div className="panel-head">
        <div>
          <h2>Issue Tracker</h2>
          <p>Private admin log for bugs, problems, and fixes.</p>
        </div>
      </div>
      <div className="inline-grid issue-form">
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Issue title" />
        <select value={module} onChange={(event) => setModule(event.target.value)}>
          {['SYSTEM', 'SAMPLING', 'ORDERS', 'FABRIC', 'IMPORTS', 'REPORTS', 'ISSUES'].map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={priority} onChange={(event) => setPriority(event.target.value)}>
          {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <button type="button" onClick={createIssue}>Create</button>
      </div>
      <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" />
      {message ? <p className="form-error">{message}</p> : null}
      <table>
        <thead><tr><th>Issue</th><th>Module</th><th>Priority</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {issues.map((issue) => (
            <tr key={issue.id}>
              <td>{issue.title}</td>
              <td>{issue.module}</td>
              <td>{issue.priority}</td>
              <td>{issue.status}</td>
              <td>{issue.status !== "RESOLVED" ? <button type="button" onClick={() => resolveIssue(issue.id)}>Resolve</button> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
