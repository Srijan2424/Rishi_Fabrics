import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";
import { requirePermission } from "../../security/rbac.js";

export const usersRouter = Router();
usersRouter.use(requirePermission("MANAGE_USERS"));

const roleSchema = z.enum(["CEO", "HEAD_OF_OPERATIONS", "MERCHANT", "ERP_MANAGER", "ADMIN"]);
const approvalSchema = z.object({ role: roleSchema.optional() });
const updateUserSchema = z.object({ role: roleSchema.optional(), status: z.enum(["ACTIVE", "DISABLED"]).optional() });

function safeUser(user: any) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    requestedRole: user.requestedRole,
    status: user.status,
    isActive: user.isActive,
    approvedAt: user.approvedAt,
    approvedBy: user.approvedBy,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt
  };
}

usersRouter.get("/", asyncRoute(async (req, res) => {
  const factoryId = req.authUser?.factoryId;
  const users = await prisma.user.findMany({
    where: factoryId ? { factoryId } : undefined,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }]
  });
  res.json(users.map(safeUser));
}));

usersRouter.post("/:id/approve", asyncRoute(async (req, res) => {
  const input = approvalSchema.parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: String(req.params.id) } });
  const role = input.role ?? user.requestedRole ?? user.role;

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      role,
      requestedRole: null,
      status: "ACTIVE",
      isActive: true,
      approvedAt: new Date(),
      approvedBy: req.authUser?.id
    }
  });

  await prisma.event.create({
    data: {
      factoryId: updated.factoryId,
      type: "ORDER_UPDATED",
      message: "User approved: " + updated.email + " as " + role,
      metadata: { userId: updated.id, role },
      createdBy: req.authUser?.id,
      source: "users"
    }
  });

  res.json(safeUser(updated));
}));

usersRouter.post("/:id/reject", asyncRoute(async (req, res) => {
  const user = await prisma.user.update({
    where: { id: String(req.params.id) },
    data: { status: "REJECTED", isActive: false }
  });
  await prisma.event.create({
    data: {
      factoryId: user.factoryId,
      type: "ORDER_UPDATED",
      message: "User rejected: " + user.email,
      metadata: { userId: user.id },
      createdBy: req.authUser?.id,
      source: "users"
    }
  });
  res.json(safeUser(user));
}));

usersRouter.patch("/:id", asyncRoute(async (req, res) => {
  const input = updateUserSchema.parse(req.body);
  const data: any = {};
  if (input.role) data.role = input.role;
  if (input.status) {
    data.status = input.status;
    data.isActive = input.status === "ACTIVE";
  }
  const user = await prisma.user.update({ where: { id: String(req.params.id) }, data });
  res.json(safeUser(user));
}));
