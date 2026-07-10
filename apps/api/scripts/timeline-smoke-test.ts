import { prisma } from "../src/db.js";
import { TimelineService } from "../src/core/timeline/timeline.service.js";

const timeline = new TimelineService();

async function main() {
  const order = await prisma.order.findFirst();

  if (!order) {
    throw new Error("No order found. Run npm run db:seed first.");
  }

  const created = await timeline.createEvent({
    factoryId: order.factoryId,
    orderId: order.id,
    type: "ORDER_UPDATED",
    message: "Timeline smoke test event.",
    metadata: {
      test: true,
      module: "timeline"
    },
    createdBy: "timeline-smoke-test",
    source: "timeline-smoke-test"
  });

  const orderTimeline = await timeline.getOrderTimeline(order.id);
  const factoryTimeline = await timeline.getFactoryTimeline(order.factoryId, 10);

  const foundInOrderTimeline = orderTimeline.some((event) => event.id === created.id);
  const foundInFactoryTimeline = factoryTimeline.some((event) => event.id === created.id);

  if (!foundInOrderTimeline) {
    throw new Error("Created event was not found in order timeline.");
  }

  if (!foundInFactoryTimeline) {
    throw new Error("Created event was not found in factory timeline.");
  }

  console.log("Created event:");
  console.table([{
    id: created.id,
    type: created.type,
    message: created.message,
    source: created.source,
    createdBy: created.createdBy
  }]);

  console.log(`Order timeline events found: ${orderTimeline.length}`);
  console.log(`Factory timeline sample events found: ${factoryTimeline.length}`);
  console.log("Timeline smoke test passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

