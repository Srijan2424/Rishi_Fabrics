"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";
const requestRoles = [
  { value: "CEO", label: "Managing Director" },
  { value: "ERP_MANAGER", label: "ERP Manager" },
  { value: "MERCHANT", label: "Merchant" },
  { value: "HEAD_OF_OPERATIONS", label: "Head of Operations" }
];

function homeForUser(user: { permissions?: string[]; role?: string }) {
  if (user.permissions?.includes("VIEW_DASHBOARD")) return "/";
  if (user.permissions?.includes("UPLOAD_ERP_FILE")) return "/imports";
  if (user.permissions?.includes("VIEW_SAMPLING")) return "/sampling";
  if (user.permissions?.includes("VIEW_ORDER")) return "/orders";
  return "/settings";
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"login" | "request">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [requestedRole, setRequestedRole] = useState("ERP_MANAGER");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    const response = await fetch(apiUrl + "/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json().catch(() => ({}));
    setLoading(false);

    if (!response.ok) {
      setError(data.error ?? "Login failed");
      return;
    }

    if (data.requiresTwoFactor) {
      router.push(`/two-factor?challengeId=${encodeURIComponent(data.challengeId)}&next=${encodeURIComponent(searchParams.get("next") ?? "/")}`);
      return;
    }

    const requestedNext = searchParams.get("next");
    const destination = requestedNext && requestedNext !== "/" ? requestedNext : homeForUser(data.user ?? {});
    router.push(destination);
    router.refresh();
  }

  async function submitRequest(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    const response = await fetch(apiUrl + "/auth/request-access", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, requestedRole })
    });

    const data = await response.json().catch(() => ({}));
    setLoading(false);

    if (!response.ok) {
      setError(data.error ?? "Access request failed");
      return;
    }

    setMessage(data.message ?? "Access request sent. Admin approval is required before first login.");
    setMode("login");
  }

  return (
    <section className="auth-card wide-auth-card">
      <div>
        <div className="eyebrow">Secure Access</div>
        <h1>Rishi Fabrics</h1>
        <p>{mode === "login" ? "Sign in to your Rishi Fabrics workspace." : "Request first-time access. Admin approval is required before login is enabled."}</p>
      </div>

      {mode === "login" ? (
        <form className="auth-form" onSubmit={submitLogin}>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          {message ? <div className="form-success">{message}</div> : null}
          <button type="submit" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={submitRequest}>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} type="text" autoComplete="name" required />
          </label>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
          </label>
          <label>
            Requested Role
            <select value={requestedRole} onChange={(event) => setRequestedRole(event.target.value)}>
              {requestRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" required />
          </label>
          <p className="form-note">Use at least 10 characters with uppercase, lowercase, and a number.</p>
          {error ? <div className="form-error">{error}</div> : null}
          <button type="submit" disabled={loading}>{loading ? "Sending request..." : "Request access"}</button>
        </form>
      )}

      <div className="auth-help">
        <a href="/password-reset">Reset password</a>
        <button className="link-button" type="button" onClick={() => { setMode(mode === "login" ? "request" : "login"); setError(""); setMessage(""); }}>
          {mode === "login" ? "Request first-time access" : "Back to sign in"}
        </button>
      </div>
    </section>
  );
}
