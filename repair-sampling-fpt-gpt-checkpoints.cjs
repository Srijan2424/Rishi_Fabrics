const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const checkpoints = [
  {
    checkpointCode: "FPT",
    label: "FPT",
    owner: "Merchant / Quality",
    timeframe: "Before bulk production",
    evidence: "FPT approval status or report reference"
  },
  {
    checkpointCode: "GPT",
    label: "GPT",
    owner: "Merchant / Quality",
    timeframe: "Before shipment approval",
    evidence: "GPT approval status or report reference"
  }
];

const samplingStageCodes = new Set([
  "INQUIRY",
  "DEVELOPMENT",
  "SAMPLE_CREATION",
  "SAMPLE_APPROVAL",
  "ORDER_CONFIRMATION",
  "LAB_DIP_APPROVAL",
  "FOB_APPROVAL",
  "PO_CONFIRMATION"
]);

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      status: {
        not: "CANCELLED"
      }
    },
    select: {
      id: true,
      orderNumber: true,
      currentStageCode: true
    }
  });

  const samplingOrders = orders.filter((order) => samplingStageCodes.has(order.currentStageCode ?? ""));
  let inserted = 0;

  for (const order of samplingOrders) {
    for (const checkpoint of checkpoints) {
      await prisma.samplingApproval.upsert({
        where: {
          orderId_checkpointCode: {
            orderId: order.id,
            checkpointCode: checkpoint.checkpointCode
          }
        },
        update: {},
        create: {
          orderId: order.id,
          ...checkpoint
        }
      });
      inserted += 1;
    }
  }

  console.log("Ensured FPT/GPT checkpoints for " + samplingOrders.length + " sampling order(s).");
  console.log("Upsert operations: " + inserted);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
