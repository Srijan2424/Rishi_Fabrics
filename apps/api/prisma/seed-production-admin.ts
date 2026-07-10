import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/security/password.js";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || "Rishi Fabrics Admin";

  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required to seed the production Admin account.");
  }

  if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error("ADMIN_PASSWORD must be at least 12 characters and include uppercase, lowercase, and a number.");
  }

  const factory = await prisma.factory.upsert({
    where: { code: "RISHI" },
    update: { name: "Rishi Fabrics" },
    create: {
      name: "Rishi Fabrics",
      code: "RISHI",
      workingDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
      shiftsPerDay: 1,
      workingHoursPerDay: 8
    }
  });

  await prisma.user.upsert({
    where: { email },
    update: {
      factoryId: factory.id,
      name,
      role: "ADMIN",
      requestedRole: null,
      status: "ACTIVE",
      isActive: true,
      approvedAt: new Date(),
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date()
    },
    create: {
      factoryId: factory.id,
      email,
      name,
      role: "ADMIN",
      requestedRole: null,
      status: "ACTIVE",
      isActive: true,
      approvedAt: new Date(),
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date()
    }
  });

  console.log("Production Admin seeded for " + email + " at Rishi Fabrics.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
