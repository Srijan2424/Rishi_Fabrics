import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db.js";
import { hashToken } from "./tokens.js";

export type RoleName = "CEO" | "HEAD_OF_OPERATIONS" | "MERCHANT" | "ERP_MANAGER" | "ADMIN";

export type Permission =
  | "VIEW_DASHBOARD"
  | "VIEW_ORDER"
  | "CREATE_ORDER"
  | "MOVE_INVENTORY"
  | "CREATE_REWORK"
  | "CLOSE_REWORK"
  | "VIEW_SAMPLING"
  | "MANAGE_SAMPLING"
  | "UPLOAD_ERP_FILE"
  | "APPROVE_IMPORT"
  | "MANAGE_WORKFLOW"
  | "MANAGE_USERS"
  | "VIEW_REPORTS"
  | "VIEW_MONITORING"
  | "MANAGE_ISSUES"
  | "VIEW_WORK_LOGS"
  | "MANAGE_REPORTS";

const rolePermissions: Record<RoleName, Permission[]> = {
  CEO: ["VIEW_DASHBOARD", "VIEW_ORDER", "VIEW_SAMPLING", "VIEW_REPORTS"],
  HEAD_OF_OPERATIONS: [
    "VIEW_DASHBOARD",
    "VIEW_ORDER",
    "VIEW_SAMPLING",
    "CREATE_ORDER",
    "MOVE_INVENTORY",
    "CREATE_REWORK",
    "CLOSE_REWORK",
    "MANAGE_WORKFLOW"
  ],
  MERCHANT: ["VIEW_DASHBOARD", "VIEW_ORDER", "VIEW_SAMPLING", "MANAGE_SAMPLING", "UPLOAD_ERP_FILE"],
  ERP_MANAGER: ["VIEW_ORDER", "CREATE_ORDER", "UPLOAD_ERP_FILE", "APPROVE_IMPORT"],
  ADMIN: [
    "VIEW_DASHBOARD",
    "VIEW_ORDER",
    "CREATE_ORDER",
    "MOVE_INVENTORY",
    "CREATE_REWORK",
    "CLOSE_REWORK",
    "VIEW_SAMPLING",
    "MANAGE_SAMPLING",
    "UPLOAD_ERP_FILE",
    "APPROVE_IMPORT",
    "MANAGE_WORKFLOW",
    "MANAGE_USERS",
    "VIEW_MONITORING",
    "MANAGE_ISSUES",
    "VIEW_WORK_LOGS"
  ]
};

export const sessionCookieName = "mct_session";

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: string;
        role: RoleName;
        factoryId?: string;
      };
    }
  }
}

export function attachDevAuth(req: Request, _res: Response, next: NextFunction) {
  if (process.env.ALLOW_DEV_AUTH !== "true") {
    next();
    return;
  }

  const role = String(req.header("x-user-role") ?? "ADMIN") as RoleName;
  const safeRole: RoleName = rolePermissions[role] ? role : "ADMIN";

  req.authUser = {
    id: String(req.header("x-user-id") ?? "dev-user"),
    role: safeRole,
    factoryId: req.header("x-factory-id") ?? undefined
  };

  next();
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const cookies = header.split(";").map((cookie) => cookie.trim());
  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.split("=");
    if (key === name) return decodeURIComponent(valueParts.join("="));
  }
  return undefined;
}

export async function attachSessionAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = parseCookie(req.header("cookie"), sessionCookieName);
    if (!token) {
      next();
      return;
    }

    const session = await prisma.authSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true }
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive || session.user.status !== "ACTIVE") {
      next();
      return;
    }

    req.authUser = {
      id: session.user.id,
      role: session.user.role,
      factoryId: session.user.factoryId
    };

    await prisma.authSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() }
    });

    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  next();
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.authUser?.role;

    if (!role) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (!rolePermissions[role]?.includes(permission)) {
      res.status(403).json({ error: "Forbidden", requiredPermission: permission });
      return;
    }

    next();
  };
}

export function getPermissions(role: RoleName): Permission[] {
  return rolePermissions[role] ?? [];
}
