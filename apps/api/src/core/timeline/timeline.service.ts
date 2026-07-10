import { prisma } from "../../db.js";
import { CreateTimelineEventInput } from "./timeline.types.js";

export class TimelineService {
  constructor(private readonly db = prisma) {}

  async createEvent(input: CreateTimelineEventInput) {
    return this.db.event.create({
      data: {
        factoryId: input.factoryId,
        orderId: input.orderId,
        type: input.type,
        message: input.message,
        metadata: input.metadata ?? {},
        createdBy: input.createdBy,
        source: input.source ?? "timeline-service"
      }
    });
  }

  async getOrderTimeline(orderId: string) {
    return this.db.event.findMany({
      where: {
        orderId
      },
      orderBy: {
        createdAt: "asc"
      }
    });
  }

  async getFactoryTimeline(factoryId: string, limit = 100) {
    return this.db.event.findMany({
      where: {
        factoryId
      },
      orderBy: {
        createdAt: "desc"
      },
      take: limit
    });
  }
}

