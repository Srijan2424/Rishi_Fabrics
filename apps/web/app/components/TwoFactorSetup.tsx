"use client";

import { FormEvent, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";

export function TwoFactorSetup({ enabled }: { enabled: boolean }) {
  const [secret, setSecret] = useState("");
  const [otpAuthUrl, setOtpAuthUrl] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState(enabled ? "Two-factor authentication is enabled." : "");
  const [error, setError] = useState("");

  async function setup() {
    setError("");
    const response = await fetch(`${apiUrl}/auth/2fa/setup`, {
      method: "POST",
      credentials: "include"
    });
    const data = await response.json();
    setSecret(data.secret);
    setOtpAuthUrl(data.otpAuthUrl);
    setMessage("Add this secret to your authenticator app, then enter the current code.");
  }

  async function enable(event: FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch(`${apiUrl}/auth/2fa/enable`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error ?? "Could not enable 2FA");
      return;
    }
    setMessage("Two-factor authentication is now enabled.");
  }

  return (
    <div className="settings-card static-card">
      <strong>Two-Factor Authentication</strong>
      <span>Protect login with a six-digit authenticator app code.</span>
      {message ? <p>{message}</p> : null}
      {secret ? (
        <div className="secret-box">
          <code>{secret}</code>
          <small>{otpAuthUrl}</small>
        </div>
      ) : null}
      {!enabled ? <button type="button" onClick={setup}>Set up 2FA</button> : null}
      {secret && !enabled ? (
        <form className="inline-form" onSubmit={enable}>
          <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="123456" inputMode="numeric" />
          <button type="submit">Enable</button>
        </form>
      ) : null}
      {error ? <div className="form-error">{error}</div> : null}
    </div>
  );
}
