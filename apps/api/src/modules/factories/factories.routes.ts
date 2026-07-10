import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";
import { createEvent } from "../events/event.service.js";

export const factoriesRouter = Router();

const createFactorySchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2).max(12),
  workingDays: z.array(z.string()).default(["MON", "TUE", "WED", "THU", "FRI", "SAT"]),
  shiftsPerDay: z.number().int().positive().default(1),
  workingHoursPerDay: z.number().positive().default(8)
});

factoriesRouter.get("/", asyncRoute(async (_req, res) => {
  const factories = await prisma.factory.findMany({ orderBy: { createdAt: "desc" } });
  res.json(factories);
}));

factoriesRouter.post("/", asyncRoute(async (req, res) => {
  const input = createFactorySchema.parse(req.body);

  const factory = await prisma.factory.create({ data: input });

  await createEvent({
    factoryId: factory.id,
    type: "FACTORY_CREATED",
    message: `Factory ${factory.name} created.`
  });

  res.status(201).json(factory);
}));
