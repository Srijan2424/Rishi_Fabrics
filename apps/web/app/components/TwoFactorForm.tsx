"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";

export function TwoFactorForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const challengeId = searchParams.get("challengeId") ?? "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    const response = await fetch(`${apiUrl}/auth/2fa/verify`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId, code })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error ?? "Invalid authenticator code");
      return;
    }

    router.push(searchParams.get("next") ?? "/");
    router.refresh();
  }

  return (
    <section className="auth-card">
      <div>
        <div className="eyebrow">Two-Factor Authentication</div>
        <h1>Enter authenticator code</h1>
        <p>Use the six-digit code from your authenticator app.</p>
      </div>

      <form className="auth-form" onSubmit={submit}>
        <label>
          Code
          <input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" />
        </label>
        {error ? <div className="form-error">{error}</div> : null}
        <button type="submit">Verify</button>
      </form>
    </section>
  );
}
