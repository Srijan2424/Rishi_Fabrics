import { EventType, Prisma } from "@prisma/client";
import { prisma } from "../../db.js";

type CreateEventInput = {
  factoryId: string;
  orderId?: string;
  type: EventType;
  message: string;
  metadata?: Prisma.InputJsonValue;
};

export async function createEvent(input: CreateEventInput) {
  return prisma.event.create({
    data: {
      factoryId: input.factoryId,
      orderId: input.orderId,
      type: input.type,
      message: input.message,
      metadata: input.metadata ?? {}
    }
  });
}

