import { Prisma } from "@prisma/client";

export type TimelineEventType =
  | "FACTORY_CREATED"
  | "ORDER_CREATED"
  | "ORDER_UPDATED"
  | "STAGE_STARTED"
  | "STAGE_COMPLETED"
  | "MATERIAL_MOVED"
  | "REWORK_CREATED"
  | "IMPORT_CREATED"
  | "IMPORT_APPROVED"
  | "DISPATCH_COMPLETED";

export interface CreateTimelineEventInput {
  factoryId: string;
  orderId?: string;
  type: TimelineEventType;
  message: string;
  metadata?: Prisma.InputJsonValue;
  createdBy?: string;
  source?: string;
}
