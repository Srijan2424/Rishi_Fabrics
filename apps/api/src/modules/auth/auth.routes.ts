import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";
import { hashPassword, verifyPassword } from "../../security/password.js";
import { createOtpAuthUrl, createTotpSecret, verifyTotp } from "../../security/totp.js";
import { createOpaqueToken, hashToken } from "../../security/tokens.js";
import { getPermissions, requireAuthenticated, sessionCookieName, sessionTokenFromRequest } from "../../security/rbac.js";

export const authRouter = Router();

const roleSchema = z.enum(["CEO", "HEAD_OF_OPERATIONS", "MERCHANT", "ERP_MANAGER"]);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const requestAccessSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(10).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/),
  requestedRole: roleSchema
});

const twoFactorVerifySchema = z.object({
  challengeId: z.string().min(10),
  code: z.string().regex(/^\d{6}$/)
});

const passwordResetRequestSchema = z.object({
  email: z.string().email()
});

const passwordResetConfirmSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(10).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/)
});

const twoFactorEnableSchema = z.object({
  code: z.string().regex(/^\d{6}$/)
});

const pendingTwoFactorChallenges = new Map<string, { userId: string; expiresAt: number }>();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function sessionCookie(token: string, maxAgeSeconds: number): string {
  const production = process.env.NODE_ENV === "production";
  const sameSite = production ? "None" : "Lax";
  const secure = production ? "; Secure" : "";
  return `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

function clearSessionCookie(): string {
  const production = process.env.NODE_ENV === "production";
  const sameSite = production ? "None" : "Lax";
  const secure = production ? "; Secure" : "";
  return `${sessionCookieName}=; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=0${secure}`;
}

function assertLoginAllowed(key: string) {
  const now = Date.now();
  const attempt = loginAttempts.get(key);
  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return;
  }

  attempt.count += 1;
  if (attempt.count > 8) {
    throw new Error("Too many login attempts. Try again in 15 minutes.");
  }
}

async function createSession(userId: string, req: Request) {
  const token = createOpaqueToken();
  const maxAgeSeconds = 60 * 60 * 8;
  await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      userAgent: req.header("user-agent") ?? undefined,
      ipAddress: req.ip,
      expiresAt: new Date(Date.now() + maxAgeSeconds * 1000)
    }
  });

  await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() }
  });

  return { token, maxAgeSeconds };
}

function publicUser(user: {
  id: string;
  email: string;
  name: string;
  role: any;
  factoryId: string;
  twoFactorEnabled: boolean;
  status?: string;
  requestedRole?: any;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    factoryId: user.factoryId,
    twoFactorEnabled: user.twoFactorEnabled,
    status: user.status,
    requestedRole: user.requestedRole,
    permissions: getPermissions(user.role)
  };
}

authRouter.post("/request-access", asyncRoute(async (req, res) => {
  const input = requestAccessSchema.parse(req.body);
  const email = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    res.status(409).json({ error: "An account already exists for this email. Please sign in or ask Admin to review access." });
    return;
  }

  const factory = await prisma.factory.findFirst({ orderBy: { createdAt: "asc" } });
  if (!factory) {
    res.status(400).json({ error: "Company setup is not ready. Ask Admin to create the company first." });
    return;
  }

  const user = await prisma.user.create({
    data: {
      factoryId: factory.id,
      email,
      name: input.name,
      role: input.requestedRole,
      requestedRole: input.requestedRole,
      status: "PENDING_APPROVAL",
      isActive: false,
      passwordHash: await hashPassword(input.password),
      passwordChangedAt: new Date()
    }
  });

  await prisma.event.create({
    data: {
      factoryId: factory.id,
      type: "ORDER_UPDATED",
      message: "New user access request: " + user.email + " requested " + input.requestedRole,
      metadata: { userId: user.id, requestedRole: input.requestedRole },
      source: "auth"
    }
  });

  res.status(201).json({ ok: true, status: user.status, message: "Access request sent. Admin approval is required before first login." });
}));

authRouter.post("/login", asyncRoute(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const attemptKey = `${req.ip}:${input.email.toLowerCase()}`;
  assertLoginAllowed(attemptKey);

  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() }
  });

  if (!user || !await verifyPassword(input.password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (user.status === "PENDING_APPROVAL") {
    res.status(403).json({ error: "Your account is waiting for Admin approval." });
    return;
  }

  if (user.status === "REJECTED") {
    res.status(403).json({ error: "This access request was rejected. Please contact Admin." });
    return;
  }

  if (user.status === "DISABLED" || !user.isActive) {
    res.status(403).json({ error: "This account is disabled. Please contact Admin." });
    return;
  }

  loginAttempts.delete(attemptKey);

  if (user.twoFactorEnabled) {
    const challengeId = createOpaqueToken(24);
    pendingTwoFactorChallenges.set(challengeId, {
      userId: user.id,
      expiresAt: Date.now() + 5 * 60 * 1000
    });
    res.json({ requiresTwoFactor: true, challengeId });
    return;
  }

  const session = await createSession(user.id, req);
  res.setHeader("Set-Cookie", sessionCookie(session.token, session.maxAgeSeconds));
  res.json({ requiresTwoFactor: false, sessionToken: session.token, user: publicUser(user) });
}));

authRouter.post("/2fa/verify", asyncRoute(async (req, res) => {
  const input = twoFactorVerifySchema.parse(req.body);
  const challenge = pendingTwoFactorChallenges.get(input.challengeId);

  if (!challenge || challenge.expiresAt <= Date.now()) {
    res.status(401).json({ error: "Two-factor challenge expired" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: challenge.userId } });
  if (!user?.twoFactorSecret || !verifyTotp(user.twoFactorSecret, input.code)) {
    res.status(401).json({ error: "Invalid authenticator code" });
    return;
  }

  pendingTwoFactorChallenges.delete(input.challengeId);
  const session = await createSession(user.id, req);
  res.setHeader("Set-Cookie", sessionCookie(session.token, session.maxAgeSeconds));
  res.json({ sessionToken: session.token, user: publicUser(user) });
}));

authRouter.get("/me", requireAuthenticated, asyncRoute(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.authUser!.id } });
  res.json(publicUser(user));
}));

authRouter.post("/logout", asyncRoute(async (req, res) => {
  const token = sessionTokenFromRequest(req);

  if (token) {
    await prisma.authSession.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }

  res.setHeader("Set-Cookie", clearSessionCookie());
  res.json({ ok: true });
}));

authRouter.post("/password-reset/request", asyncRoute(async (req, res) => {
  const input = passwordResetRequestSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  let localResetToken: string | undefined;

  if (user?.isActive) {
    const token = createOpaqueToken();
    localResetToken = token;
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      }
    });
  }

  res.json({
    ok: true,
    message: "If that email exists, a password reset link will be sent.",
    localResetToken: process.env.NODE_ENV === "production" ? undefined : localResetToken
  });
}));

authRouter.post("/password-reset/confirm", asyncRoute(async (req, res) => {
  const input = passwordResetConfirmSchema.parse(req.body);
  const reset = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
    include: { user: true }
  });

  if (!reset || reset.usedAt || reset.expiresAt <= new Date() || !reset.user.isActive) {
    res.status(400).json({ error: "Invalid or expired reset token" });
    return;
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: reset.userId },
      data: {
        passwordHash: await hashPassword(input.password),
        passwordChangedAt: new Date()
      }
    }),
    prisma.passwordResetToken.update({
      where: { id: reset.id },
      data: { usedAt: new Date() }
    }),
    prisma.authSession.updateMany({
      where: { userId: reset.userId, revokedAt: null },
      data: { revokedAt: new Date() }
    })
  ]);

  res.setHeader("Set-Cookie", clearSessionCookie());
  res.json({ ok: true });
}));

authRouter.post("/2fa/setup", requireAuthenticated, asyncRoute(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.authUser!.id } });
  const secret = user.twoFactorSecret ?? createTotpSecret();

  if (!user.twoFactorSecret) {
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: secret }
    });
  }

  res.json({
    secret,
    otpAuthUrl: createOtpAuthUrl(secret, user.email),
    twoFactorEnabled: user.twoFactorEnabled
  });
}));

authRouter.post("/2fa/enable", requireAuthenticated, asyncRoute(async (req, res) => {
  const input = twoFactorEnableSchema.parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.authUser!.id } });

  if (!user.twoFactorSecret || !verifyTotp(user.twoFactorSecret, input.code)) {
    res.status(400).json({ error: "Invalid authenticator code" });
    return;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: true }
  });

  res.json(publicUser(updated));
}));
