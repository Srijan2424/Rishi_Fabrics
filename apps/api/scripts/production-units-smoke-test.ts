import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const factory = await prisma.factory.findFirst({
    where: {
      code: "DEMO"
    }
  });

  if (!factory) {
    throw new Error("Seed factory DEMO not found. Run npm run db:seed first.");
  }

  const units = await prisma.productionUnit.findMany({
    where: {
      factoryId: factory.id
    },
    include: {
      colorMappings: true
    },
    orderBy: {
      code: "asc"
    }
  });

  const requiredMappings = new Map([
    ["FF92D050", "UNIT_I"],
    ["FF00B0F0", "UNIT_II"],
    ["FFFF0000", "PENDING_PRODUCTION"],
    ["FFFFFF00", "DISPATCH_DONE"]
  ]);

  for (const [colorHex, unitCode] of requiredMappings) {
    const mapping = units
      .flatMap((unit) => unit.colorMappings.map((colorMapping) => ({ unit, colorMapping })))
      .find(({ colorMapping }) => colorMapping.colorHex === colorHex);

    if (!mapping || mapping.unit.code !== unitCode) {
      throw new Error(`Expected ${colorHex} to map to ${unitCode}.`);
    }
  }

  console.log("Production units:");
  console.table(units.map((unit) => ({
    code: unit.code,
    name: unit.name,
    mappings: unit.colorMappings.map((mapping) => mapping.colorHex).join(", ")
  })));
  console.log("Production units smoke test passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
