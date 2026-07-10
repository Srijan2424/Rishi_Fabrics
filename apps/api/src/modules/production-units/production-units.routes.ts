import { Router } from "express";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";

export const productionUnitsRouter = Router();

productionUnitsRouter.get("/", asyncRoute(async (req, res) => {
  const factoryId = String(req.query.factoryId ?? "");

  const units = await prisma.productionUnit.findMany({
    where: factoryId ? { factoryId } : undefined,
    include: {
      colorMappings: {
        where: {
          isActive: true
        },
        orderBy: {
          colorHex: "asc"
        }
      }
    },
    orderBy: {
      name: "asc"
    }
  });

  res.json(units);
}));
