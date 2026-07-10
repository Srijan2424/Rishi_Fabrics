"use client";

import { FormEvent, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";

export function PasswordResetForm() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function requestReset(event: FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch(`${apiUrl}/auth/password-reset/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const data = await response.json();
    setMessage(data.localResetToken ? `Local reset token: ${data.localResetToken}` : data.message);
  }

  async function confirmReset(event: FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch(`${apiUrl}/auth/password-reset/confirm`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error ?? "Password reset failed");
      return;
    }
    setMessage("Password updated. You can sign in with the new password.");
  }

  return (
    <section className="auth-card wide-auth-card">
      <div>
        <div className="eyebrow">Account Recovery</div>
        <h1>Password reset</h1>
        <p>Request a secure reset token, then set a new password.</p>
      </div>

      <form className="auth-form" onSubmit={requestReset}>
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
        </label>
        <button type="submit">Request reset</button>
      </form>

      <form className="auth-form" onSubmit={confirmReset}>
        <label>
          Reset token
          <input value={token} onChange={(event) => setToken(event.target.value)} />
        </label>
        <label>
          New password
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
        </label>
        {error ? <div className="form-error">{error}</div> : null}
        <button type="submit">Update password</button>
      </form>

      {message ? <div className="form-success">{message}</div> : null}
      <a className="auth-link" href="/login">Back to login</a>
    </section>
  );
}
