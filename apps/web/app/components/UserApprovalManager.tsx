"use client";

import { useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";
const roles = ["CEO", "HEAD_OF_OPERATIONS", "MERCHANT", "ERP_MANAGER", "ADMIN"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = months[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return day + " " + month + " " + year + ", " + hour + ":" + minute + " UTC";
}

type ManagedUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  requestedRole?: string | null;
  status: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
};

export function UserApprovalManager({ initialUsers }: { initialUsers: ManagedUser[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");

  const pendingUsers = users.filter((user) => user.status === "PENDING_APPROVAL");
  const activeUsers = users.filter((user) => user.status !== "PENDING_APPROVAL");

  async function updateUser(id: string, action: "approve" | "reject", role?: string) {
    setBusyId(id + action);
    setMessage("");
    const response = await fetch(apiUrl + "/users/" + id + "/" + action, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: action === "approve" ? JSON.stringify({ role }) : undefined
    });
    const data = await response.json().catch(() => ({}));
    setBusyId("");
    if (!response.ok) {
      setMessage(data.error ?? "User update failed.");
      return;
    }
    setUsers((current) => current.map((user) => user.id === data.id ? data : user));
    setMessage(action === "approve" ? "User approved." : "User rejected.");
  }

  async function patchUser(id: string, body: Record<string, string>) {
    setBusyId(id + JSON.stringify(body));
    setMessage("");
    const response = await fetch(apiUrl + "/users/" + id, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    setBusyId("");
    if (!response.ok) {
      setMessage(data.error ?? "User update failed.");
      return;
    }
    setUsers((current) => current.map((user) => user.id === data.id ? data : user));
    setMessage("User updated.");
  }

  return (
    <section className="panel section-panel user-admin-panel">
      <div className="panel-head">
        <div>
          <h2>User Access Approval</h2>
          <p>New users can request a role, but only Admin can activate first login access.</p>
        </div>
      </div>
      {message ? <div className={message.includes("failed") ? "form-error" : "form-success"}>{message}</div> : null}

      <h3>Pending Users</h3>
      {pendingUsers.length === 0 ? <div className="empty">No pending access requests.</div> : (
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Requested Role</th><th>Requested At</th><th>Action</th></tr></thead>
          <tbody>
            {pendingUsers.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>{user.requestedRole ?? user.role}</td>
                <td>{formatDateTime(user.createdAt)}</td>
                <td className="button-row">
                  <button type="button" disabled={Boolean(busyId)} onClick={() => updateUser(user.id, "approve", user.requestedRole ?? user.role)}>Approve</button>
                  <button type="button" className="secondary-button" disabled={Boolean(busyId)} onClick={() => updateUser(user.id, "reject")}>Reject</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Active / Blocked Users</h3>
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last Login</th></tr></thead>
        <tbody>
          {activeUsers.map((user) => (
            <tr key={user.id}>
              <td>{user.name}</td>
              <td>{user.email}</td>
              <td>
                <select value={user.role} onChange={(event) => patchUser(user.id, { role: event.target.value })} disabled={Boolean(busyId)}>
                  {roles.map((role) => <option key={role} value={role}>{role.replaceAll("_", " ")}</option>)}
                </select>
              </td>
              <td>
                <select value={user.status === "ACTIVE" ? "ACTIVE" : "DISABLED"} onChange={(event) => patchUser(user.id, { status: event.target.value })} disabled={Boolean(busyId)}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="DISABLED">DISABLED</option>
                </select>
              </td>
              <td>{formatDateTime(user.lastLoginAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
