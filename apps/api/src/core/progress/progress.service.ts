import { prisma } from "../../db.js";
import {
  MaterialAccountability,
  OrderProgressReport,
  PipelineName,
  PipelineProgress,
  StageProgress
} from "./progress.types.js";

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

const fabricStageCodes = new Set([
  "YARN",
  "KNITTING",
  "FABRIC_INSPECTION",
  "DYEING",
  "COMPACTING",
  "FABRIC_READY"
]);

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getPipeline(stageCode: string): PipelineName {
  if (samplingStageCodes.has(stageCode)) return "SAMPLING";
  if (fabricStageCodes.has(stageCode)) return "FABRIC";
  return "GARMENT";
}

export class ProgressService {
  constructor(private readonly db = prisma) {}

  async getOrderProgress(orderId: string): Promise<OrderProgressReport> {
    const order = await this.db.order.findUniqueOrThrow({
      where: {
        id: orderId
      },
      include: {
        stages: {
          include: {
            workflowStage: true
          }
        },
        inventories: {
          include: {
            workflowStage: true
          }
        },
        reworkTickets: true
      }
    });

    const orderedStages = [...order.stages].sort(
      (left, right) => left.workflowStage.sequence - right.workflowStage.sequence
    );
    const inventoryByStageId = new Map(
      order.inventories.map((inventory) => [inventory.workflowStageId, inventory.quantity])
    );
    const totalStages = Math.max(orderedStages.length, 1);
    const maxSequenceIndex = Math.max(totalStages - 1, 1);

    const stageProgress: StageProgress[] = orderedStages.map((stage) => {
      const activeQuantity = inventoryByStageId.get(stage.workflowStageId) ?? 0;
      const stageCompletionPercent = stage.plannedQuantity > 0
        ? clampPercent((stage.completedQuantity / stage.plannedQuantity) * 100)
        : 0;
      const positionPercent = clampPercent(
        ((stage.workflowStage.sequence - 1) / maxSequenceIndex) * 100
      );

      return {
        stageId: stage.workflowStageId,
        stageCode: stage.stageCode,
        stageName: stage.stageName,
        category: stage.workflowStage.category,
        pipeline: getPipeline(stage.stageCode),
        sequence: stage.workflowStage.sequence,
        plannedQuantity: stage.plannedQuantity,
        activeQuantity,
        completedQuantity: stage.completedQuantity,
        reworkedQuantity: stage.reworkedQuantity,
        scrappedQuantity: stage.scrappedQuantity,
        stageCompletionPercent,
        positionPercent
      };
    });

    const activeInventoryQuantity = stageProgress.reduce((sum, stage) => sum + stage.activeQuantity, 0);
    const openReworkQuantity = order.reworkTickets
      .filter((ticket) => !ticket.closedAt)
      .reduce((sum, ticket) => sum + ticket.quantity, 0);
    const scrappedQuantity = stageProgress.reduce((sum, stage) => sum + stage.scrappedQuantity, 0);
    const accountedQuantity = activeInventoryQuantity + scrappedQuantity;
    const missingQuantity = Math.max(0, order.orderQuantity - accountedQuantity);
    const overageQuantity = Math.max(0, accountedQuantity - order.orderQuantity);

    const materialAccountability: MaterialAccountability = {
      orderQuantity: order.orderQuantity,
      activeInventoryQuantity,
      openReworkQuantity,
      scrappedQuantity,
      accountedQuantity,
      missingQuantity,
      overageQuantity,
      isBalanced: missingQuantity === 0 && overageQuantity === 0
    };

    const weightedPosition = order.orderQuantity > 0
      ? stageProgress.reduce((sum, stage) => sum + (stage.activeQuantity * stage.positionPercent), 0) /
        order.orderQuantity
      : 0;
    const overallProgressPercent = order.status === "DISPATCHED"
      ? 100
      : clampPercent(weightedPosition);

    const pipelineProgress = this.calculatePipelineProgress(stageProgress);

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderQuantity: order.orderQuantity,
      currentStageCode: order.currentStageCode,
      overallProgressPercent,
      stageProgress,
      pipelineProgress,
      materialAccountability
    };
  }

  async getFactoryProgress(factoryId?: string) {
    const orders = await this.db.order.findMany({
      where: factoryId ? { factoryId } : undefined,
      orderBy: {
        deliveryDate: "asc"
      },
      take: 100
    });

    const reports = await Promise.all(
      orders.map((order) => this.getOrderProgress(order.id))
    );
    const averageProgressPercent = reports.length > 0
      ? clampPercent(
        reports.reduce((sum, report) => sum + report.overallProgressPercent, 0) / reports.length
      )
      : 0;

    return {
      averageProgressPercent,
      orders: reports
    };
  }

  private calculatePipelineProgress(stageProgress: StageProgress[]): PipelineProgress[] {
    const pipelines: PipelineName[] = ["SAMPLING", "FABRIC", "GARMENT"];

    return pipelines.map((pipeline) => {
      const stages = stageProgress.filter((stage) => stage.pipeline === pipeline);
      const plannedQuantity = stages.reduce((sum, stage) => sum + stage.plannedQuantity, 0);
      const activeQuantity = stages.reduce((sum, stage) => sum + stage.activeQuantity, 0);
      const completedQuantity = stages.reduce((sum, stage) => sum + stage.completedQuantity, 0);
      const reworkedQuantity = stages.reduce((sum, stage) => sum + stage.reworkedQuantity, 0);
      const scrappedQuantity = stages.reduce((sum, stage) => sum + stage.scrappedQuantity, 0);
      const progressPercent = plannedQuantity > 0
        ? clampPercent(
          stages.reduce((sum, stage) => sum + (stage.stageCompletionPercent * stage.plannedQuantity), 0) /
          plannedQuantity
        )
        : 0;

      return {
        pipeline,
        plannedQuantity,
        activeQuantity,
        completedQuantity,
        reworkedQuantity,
        scrappedQuantity,
        progressPercent
      };
    });
  }
}
