import { prisma } from "../src/db.js";
import { hashPassword } from "../src/security/password.js";
import { generateTotpCode } from "../src/security/totp.js";

const apiUrl = process.env.API_URL ?? "http://127.0.0.1:4000";
const email = "erp@factory.local";
const password = "Factory@2026";

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiUrl}${path}`, init);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function main() {
  await prisma.user.update({
    where: { email },
    data: {
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      twoFactorEnabled: false,
      twoFactorSecret: null,
      isActive: true
    }
  });

  const unauthenticated = await request("/auth/me");
  if (unauthenticated.response.status !== 401) {
    throw new Error(`Expected /auth/me to require login, got ${unauthenticated.response.status}`);
  }

  const login = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  if (!login.response.ok || login.body.user?.role !== "ERP_MANAGER") {
    throw new Error(`Login failed: ${JSON.stringify(login.body)}`);
  }

  const cookie = login.response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie?.startsWith("mct_session=")) {
    throw new Error("Login did not set an httpOnly session cookie.");
  }

  const me = await request("/auth/me", { headers: { Cookie: cookie } });
  if (!me.response.ok || me.body.email !== email) {
    throw new Error(`Session lookup failed: ${JSON.stringify(me.body)}`);
  }

  const reset = await request("/auth/password-reset/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });

  if (!reset.response.ok || !reset.body.localResetToken) {
    throw new Error("Password reset request did not return a local test token.");
  }

  const confirm = await request("/auth/password-reset/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: reset.body.localResetToken, password })
  });

  if (!confirm.response.ok) {
    throw new Error(`Password reset confirm failed: ${JSON.stringify(confirm.body)}`);
  }

  const loginAfterReset = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const freshCookie = loginAfterReset.response.headers.get("set-cookie")?.split(";")[0];
  if (!freshCookie) throw new Error("Login after reset did not create a session.");

  const setup = await request("/auth/2fa/setup", {
    method: "POST",
    headers: { Cookie: freshCookie }
  });
  if (!setup.response.ok || !setup.body.secret) {
    throw new Error(`2FA setup failed: ${JSON.stringify(setup.body)}`);
  }

  const enable = await request("/auth/2fa/enable", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: freshCookie
    },
    body: JSON.stringify({ code: generateTotpCode(setup.body.secret) })
  });
  if (!enable.response.ok || enable.body.twoFactorEnabled !== true) {
    throw new Error(`2FA enable failed: ${JSON.stringify(enable.body)}`);
  }

  const challengedLogin = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!challengedLogin.body.requiresTwoFactor || !challengedLogin.body.challengeId) {
    throw new Error("2FA-enabled login did not return a challenge.");
  }

  const twoFactorLogin = await request("/auth/2fa/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challengeId: challengedLogin.body.challengeId,
      code: generateTotpCode(setup.body.secret)
    })
  });
  if (!twoFactorLogin.response.ok || twoFactorLogin.body.user?.email !== email) {
    throw new Error(`2FA login failed: ${JSON.stringify(twoFactorLogin.body)}`);
  }

  await prisma.user.update({
    where: { email },
    data: {
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      twoFactorEnabled: false,
      twoFactorSecret: null
    }
  });

  console.log("Auth smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
