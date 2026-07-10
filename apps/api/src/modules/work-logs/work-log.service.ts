import type { WorkLogModule } from "@prisma/client";
import { prisma } from "../../db.js";

type RecordWorkLogInput = {
  factoryId?: string;
  userId?: string;
  module: WorkLogModule;
  action: string;
  itemType?: string;
  itemId?: string;
  itemLabel?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
};

export async function recordWorkLog(input: RecordWorkLogInput) {
  if (!input.factoryId || !input.userId) return null;

  return prisma.workLog.create({
    data: {
      factoryId: input.factoryId,
      userId: input.userId,
      module: input.module,
      action: input.action,
      itemType: input.itemType,
      itemId: input.itemId,
      itemLabel: input.itemLabel,
      notes: input.notes,
      metadata: JSON.parse(JSON.stringify(input.metadata ?? {}))
    }
  });
}
