import { prisma } from "../db.js";

export class EventService {

  async createEvent(
    factoryId: string,
    orderId: string | null,
    type: any,
    message: string,
    metadata: any = {}
  ) {

    return prisma.event.create({
      data: {
        factoryId,
        orderId,
        type,
        message,
        metadata
      }
    });

  }

  async getTimeline(orderId: string) {

    return prisma.event.findMany({
      where: { orderId },
      orderBy: {
        createdAt: "asc"
      }
    });

  }

}