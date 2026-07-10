import { prisma } from "../../db.js";
import { ProgressService } from "../progress/progress.service.js";
import {
  DelayStatus,
  OrderLineDelayReport,
  OrderDelayReport,
  SamplingDelaySummary,
  StageDelayExpectation
} from "./delay.types.js";

type StageCategory = "APPROVAL" | "PRODUCTION" | "INSPECTION" | "REWORK" | "DISPATCH";

const defaultDurationByCategory: Record<StageCategory, number> = {
  APPROVAL: 2,
  PRODUCTION: 3,
  INSPECTION: 2,
  REWORK: 2,
  DISPATCH: 1
};

const millisecondsPerDay = 1000 * 60 * 60 * 24;

const delayRank: Record<DelayStatus, number> = {
  CANCELLED: 5,
  DELAYED: 4,
  AT_RISK: 3,
  ON_TRACK: 2,
  DISPATCHED: 1
};

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function daysBetween(start: Date, end: Date) {
  return Math.ceil((end.getTime() - start.getTime()) / millisecondsPerDay);
}

function elapsedDaysSince(start: Date, now: Date) {
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / millisecondsPerDay));
}

export class DelayService {
  constructor(
    private readonly db = prisma,
    private readonly progress = new ProgressService(db)
  ) {}

  async getOrderDelay(orderId: string, now = new Date()): Promise<OrderDelayReport> {
    const order = await this.db.order.findUniqueOrThrow({
      where: {
        id: orderId
      },
      include: {
        orderLines: {
          include: {
            productionUnit: true
          }
        },
        samplingApprovals: true,
        workflowTemplate: {
          include: {
            stages: {
              orderBy: {
                sequence: "asc"
              }
            }
          }
        }
      }
    });

    const progressReport = await this.progress.getOrderProgress(order.id);
    const stageExpectations = this.getStageExpectations(order.workflowTemplate.stages);
    const totalExpectedDays = stageExpectations.reduce(
      (sum, stage) => sum + stage.expectedDurationDays,
      0
    );
    const orderWindowDays = Math.max(1, daysBetween(order.createdAt, order.deliveryDate));
    const totalPlannedDays = Math.max(1, Math.min(totalExpectedDays || orderWindowDays, orderWindowDays));
    const daysElapsed = elapsedDaysSince(order.createdAt, now);
    const daysRemaining = daysBetween(now, order.deliveryDate);
    const plannedProgressPercent = clampPercent((daysElapsed / totalPlannedDays) * 100);
    const actualProgressPercent = progressReport.overallProgressPercent;
    const progressDeficitPercent = Math.max(0, plannedProgressPercent - actualProgressPercent);
    const expectedStage = this.getExpectedStage(stageExpectations, daysElapsed);
    const status = this.classifyStatus({
      orderStatus: order.status,
      daysRemaining,
      actualProgressPercent,
      plannedProgressPercent,
      progressDeficitPercent
    });
    const reason = this.getReason({
      status,
      currentStageCode: order.currentStageCode,
      expectedStageCode: expectedStage?.stageCode ?? null,
      daysRemaining,
      progressDeficitPercent,
      actualProgressPercent,
      plannedProgressPercent
    });
    const samplingDelay = this.getSamplingDelay({
      approvals: order.samplingApprovals,
      createdAt: order.createdAt,
      now,
      plannedSamplingDays: this.getPlannedSamplingDays(stageExpectations)
    });
    const lineDelayReports = this.getOrderLineDelaysForOrder({
      order,
      stageExpectations,
      plannedProgressPercent,
      daysRemaining,
      samplingDelay
    });
    const unitDelaySummary = this.getUnitDelaySummary(lineDelayReports);
    const worstLine = this.getWorstLine(lineDelayReports);
    const rolledUpStatus = this.getWorstStatus([status, samplingDelay.status, worstLine?.status]);
    const rolledUpReason = this.getRolledUpReason({
      baseReason: reason,
      baseStatus: status,
      samplingDelay,
      worstLine
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: rolledUpStatus,
      reason: rolledUpReason,
      currentStageCode: order.currentStageCode,
      expectedStageCode: expectedStage?.stageCode ?? null,
      expectedStageName: expectedStage?.stageName ?? null,
      actualProgressPercent,
      plannedProgressPercent,
      progressDeficitPercent,
      daysElapsed,
      daysRemaining,
      totalPlannedDays,
      deliveryDate: order.deliveryDate,
      stageExpectations,
      lineDelayReports,
      unitDelaySummary,
      samplingDelay
    };
  }

  async getOrderLineDelays(orderId: string, now = new Date()): Promise<OrderLineDelayReport[]> {
    return (await this.getOrderDelay(orderId, now)).lineDelayReports;
  }

  async getFactoryDelays(factoryId?: string, now = new Date()) {
    const orders = await this.db.order.findMany({
      where: factoryId ? { factoryId } : undefined,
      orderBy: {
        deliveryDate: "asc"
      },
      take: 100
    });
    const reports = await Promise.all(
      orders.map((order) => this.getOrderDelay(order.id, now))
    );

    return {
      onTrack: reports.filter((report) => report.status === "ON_TRACK").length,
      atRisk: reports.filter((report) => report.status === "AT_RISK").length,
      delayed: reports.filter((report) => report.status === "DELAYED").length,
      dispatched: reports.filter((report) => report.status === "DISPATCHED").length,
      cancelled: reports.filter((report) => report.status === "CANCELLED").length,
      reports
    };
  }

  private getStageExpectations(stages: Array<{
    code: string;
    name: string;
    category: StageCategory;
    sequence: number;
    expectedDurationDays: number | null;
  }>): StageDelayExpectation[] {
    let cursor = 0;

    return stages.map((stage) => {
      const expectedDurationDays = Math.max(
        1,
        stage.expectedDurationDays ?? defaultDurationByCategory[stage.category]
      );
      const expectation = {
        stageCode: stage.code,
        stageName: stage.name,
        sequence: stage.sequence,
        expectedDurationDays,
        expectedStartDay: cursor,
        expectedEndDay: cursor + expectedDurationDays
      };

      cursor += expectedDurationDays;
      return expectation;
    });
  }

  private getExpectedStage(stageExpectations: StageDelayExpectation[], daysElapsed: number) {
    return stageExpectations.find((stage) => (
      daysElapsed >= stage.expectedStartDay && daysElapsed < stage.expectedEndDay
    )) ?? stageExpectations[stageExpectations.length - 1] ?? null;
  }

  private classifyStatus(input: {
    orderStatus: string;
    daysRemaining: number;
    actualProgressPercent: number;
    plannedProgressPercent: number;
    progressDeficitPercent: number;
  }): DelayStatus {
    if (input.orderStatus === "DISPATCHED") return "DISPATCHED";
    if (input.orderStatus === "CANCELLED") return "CANCELLED";
    if (input.daysRemaining < 0) return "DELAYED";
    if (input.progressDeficitPercent >= 30) return "DELAYED";
    if (input.progressDeficitPercent >= 15) return "AT_RISK";
    if (input.daysRemaining <= 3 && input.actualProgressPercent < 90) return "AT_RISK";
    if (input.plannedProgressPercent >= 90 && input.actualProgressPercent < 75) return "AT_RISK";
    return "ON_TRACK";
  }

  private classifyLineStage(line: {
    orderQuantity: number;
    cuttingTotalQty: number;
    lineLoadingQty: number;
    totalLineOutQty: number;
    lineInBalanceQty: number;
    productionStatus: string | null;
  }) {
    const status = line.productionStatus?.toUpperCase() ?? "";

    if (status.includes("DISPATCH")) return "DISPATCH";
    if (line.totalLineOutQty >= line.orderQuantity && line.orderQuantity > 0) return "DISPATCH";
    if (line.totalLineOutQty > 0 || line.lineLoadingQty > 0 || line.lineInBalanceQty > 0) return "STITCHING";
    if (line.cuttingTotalQty > 0) return "PANEL_CUTTING";
    return "NOT_STARTED";
  }

  private getLineProgress(line: {
    orderQuantity: number;
    cuttingTotalQty: number;
    lineLoadingQty: number;
    totalLineOutQty: number;
    productionStatus: string | null;
  }) {
    if (line.orderQuantity <= 0) return 0;

    const status = line.productionStatus?.toUpperCase() ?? "";
    if (status.includes("DISPATCH")) return 100;

    const cuttingProgress = Math.min(line.cuttingTotalQty / line.orderQuantity, 1) * 35;
    const lineLoadingProgress = Math.min(line.lineLoadingQty / line.orderQuantity, 1) * 20;
    const lineOutProgress = Math.min(line.totalLineOutQty / line.orderQuantity, 1) * 45;

    return clampPercent(cuttingProgress + lineLoadingProgress + lineOutProgress);
  }

  private getExpectedLineStage(plannedProgressPercent: number) {
    if (plannedProgressPercent >= 95) return "DISPATCH";
    if (plannedProgressPercent >= 40) return "STITCHING";
    if (plannedProgressPercent > 0) return "PANEL_CUTTING";
    return "NOT_STARTED";
  }

  private getSamplingDelay(input: {
    approvals: Array<{ status: string; approvedAt: Date | null }>;
    createdAt: Date;
    now: Date;
    plannedSamplingDays: number;
  }): SamplingDelaySummary {
    const approvalsTotal = input.approvals.length;
    const approvalsComplete = input.approvals.filter((approval) => approval.status === "APPROVED").length;
    const progressPercent = approvalsTotal > 0
      ? clampPercent((approvalsComplete / approvalsTotal) * 100)
      : 100;
    const complete = approvalsTotal === 0 || approvalsComplete === approvalsTotal;
    const latestApproval = input.approvals
      .map((approval) => approval.approvedAt)
      .filter((approvedAt): approvedAt is Date => Boolean(approvedAt))
      .sort((left, right) => right.getTime() - left.getTime())[0];
    const actualSamplingDays = elapsedDaysSince(input.createdAt, complete && latestApproval ? latestApproval : input.now);
    const samplingDeficit = complete ? 0 : Math.max(0, actualSamplingDays - input.plannedSamplingDays);
    const status: DelayStatus = complete
      ? "ON_TRACK"
      : samplingDeficit >= 3
        ? "DELAYED"
        : samplingDeficit > 0
          ? "AT_RISK"
          : "ON_TRACK";

    return {
      status,
      approvalsComplete,
      approvalsTotal,
      plannedSamplingDays: input.plannedSamplingDays,
      actualSamplingDays,
      progressPercent,
      reason: complete
        ? "Sampling approvals are complete."
        : `Sampling has ${approvalsComplete}/${approvalsTotal} approvals complete after ${actualSamplingDays} day(s).`
    };
  }

  private getPlannedSamplingDays(stageExpectations: StageDelayExpectation[]) {
    const samplingStages = stageExpectations.filter((stage) => (
      stage.stageCode.includes("APPROVAL") ||
      stage.stageCode.includes("SAMPLE") ||
      stage.stageCode.includes("INQUIRY") ||
      stage.stageCode.includes("DEVELOPMENT") ||
      stage.stageCode.includes("PO")
    ));

    const expectedDays = samplingStages.reduce((sum, stage) => sum + stage.expectedDurationDays, 0);
    return Math.max(7, expectedDays || 14);
  }

  private getOrderLineDelaysForOrder(input: {
    order: {
      id: string;
      orderNumber: string;
      deliveryDate: Date;
      orderLines: Array<{
        id: string;
        buyerName: string;
        styleName: string;
        colorName: string;
        productionUnitId: string | null;
        productionUnit: { code: string; name: string } | null;
        orderQuantity: number;
        cuttingTotalQty: number;
        lineLoadingQty: number;
        totalLineOutQty: number;
        lineInBalanceQty: number;
        productionStatus: string | null;
        rowColorHex: string | null;
        lastUpdatedAt: Date;
      }>;
    };
    stageExpectations: StageDelayExpectation[];
    plannedProgressPercent: number;
    daysRemaining: number;
    samplingDelay: SamplingDelaySummary;
  }): OrderLineDelayReport[] {
    return input.order.orderLines.map((line) => {
      const actualProgressPercent = this.getLineProgress(line);
      const progressDeficitPercent = Math.max(0, input.plannedProgressPercent - actualProgressPercent);
      const currentStageCode = this.classifyLineStage(line);
      const expectedStageCode = this.getExpectedLineStage(input.plannedProgressPercent);
      let status = this.classifyStatus({
        orderStatus: "RUNNING",
        daysRemaining: input.daysRemaining,
        actualProgressPercent,
        plannedProgressPercent: input.plannedProgressPercent,
        progressDeficitPercent
      });

      if (input.samplingDelay.status === "DELAYED" && actualProgressPercent === 0) {
        status = "DELAYED";
      } else if (input.samplingDelay.status === "AT_RISK" && status === "ON_TRACK" && actualProgressPercent === 0) {
        status = "AT_RISK";
      }

      const reason = this.getLineReason({
        status,
        currentStageCode,
        expectedStageCode,
        progressDeficitPercent,
        actualProgressPercent,
        plannedProgressPercent: input.plannedProgressPercent,
        daysRemaining: input.daysRemaining,
        samplingDelay: input.samplingDelay
      });

      return {
        orderLineId: line.id,
        orderId: input.order.id,
        orderNumber: input.order.orderNumber,
        buyerName: line.buyerName,
        styleName: line.styleName,
        colorName: line.colorName,
        productionUnitId: line.productionUnitId,
        productionUnitCode: line.productionUnit?.code ?? null,
        productionUnitName: line.productionUnit?.name ?? null,
        productionStatus: line.productionStatus,
        rowColorHex: line.rowColorHex,
        status,
        reason,
        actualProgressPercent,
        plannedProgressPercent: input.plannedProgressPercent,
        progressDeficitPercent,
        daysRemaining: input.daysRemaining,
        currentStageCode,
        expectedStageCode,
        orderQuantity: line.orderQuantity,
        cuttingTotalQty: line.cuttingTotalQty,
        lineLoadingQty: line.lineLoadingQty,
        totalLineOutQty: line.totalLineOutQty,
        lineInBalanceQty: line.lineInBalanceQty,
        lastUpdatedAt: line.lastUpdatedAt
      };
    });
  }

  private getLineReason(input: {
    status: DelayStatus;
    currentStageCode: string;
    expectedStageCode: string;
    progressDeficitPercent: number;
    actualProgressPercent: number;
    plannedProgressPercent: number;
    daysRemaining: number;
    samplingDelay: SamplingDelaySummary;
  }) {
    if (input.samplingDelay.status !== "ON_TRACK" && input.actualProgressPercent === 0) {
      return input.samplingDelay.reason;
    }
    if (input.daysRemaining < 0) return `Delivery date passed ${Math.abs(input.daysRemaining)} day(s) ago.`;
    if (input.status === "AT_RISK" && input.daysRemaining <= 3 && input.actualProgressPercent < 90) {
      return `Delivery is in ${input.daysRemaining} day(s), but style/color progress is only ${input.actualProgressPercent}%.`;
    }
    if (input.progressDeficitPercent > 0) {
      return `Style/color progress is ${input.progressDeficitPercent}% behind planned progress.`;
    }
    if (input.currentStageCode !== input.expectedStageCode) {
      return `Current line stage is ${input.currentStageCode}, expected ${input.expectedStageCode}.`;
    }
    return "Style/color progress is aligned with the current plan.";
  }

  private getUnitDelaySummary(lineReports: OrderLineDelayReport[]) {
    const byUnit = new Map<string, OrderLineDelayReport[]>();

    for (const line of lineReports) {
      const key = line.productionUnitId ?? "UNMAPPED";
      byUnit.set(key, [...(byUnit.get(key) ?? []), line]);
    }

    return [...byUnit.values()].map((lines) => {
      const worstStatus = this.getWorstStatus(lines.map((line) => line.status));
      const first = lines[0];

      return {
        productionUnitId: first.productionUnitId,
        productionUnitCode: first.productionUnitCode,
        productionUnitName: first.productionUnitName,
        status: worstStatus,
        delayedLines: lines.filter((line) => line.status === "DELAYED").length,
        atRiskLines: lines.filter((line) => line.status === "AT_RISK").length,
        onTrackLines: lines.filter((line) => line.status === "ON_TRACK").length,
        totalLines: lines.length
      };
    });
  }

  private getWorstLine(lineReports: OrderLineDelayReport[]) {
    return [...lineReports].sort((left, right) => (
      delayRank[right.status] - delayRank[left.status] ||
      right.progressDeficitPercent - left.progressDeficitPercent
    ))[0];
  }

  private getWorstStatus(statuses: Array<DelayStatus | undefined>) {
    return statuses
      .filter((status): status is DelayStatus => Boolean(status))
      .sort((left, right) => delayRank[right] - delayRank[left])[0] ?? "ON_TRACK";
  }

  private getRolledUpReason(input: {
    baseReason: string;
    baseStatus: DelayStatus;
    samplingDelay: SamplingDelaySummary;
    worstLine?: OrderLineDelayReport;
  }) {
    if (input.samplingDelay.status === "DELAYED") return input.samplingDelay.reason;
    if (input.worstLine?.status === "DELAYED") {
      return `${input.worstLine.styleName} / ${input.worstLine.colorName} is delayed in ${input.worstLine.productionUnitName ?? "unmapped unit"}: ${input.worstLine.reason}`;
    }
    if (input.samplingDelay.status === "AT_RISK" && input.baseStatus === "ON_TRACK") return input.samplingDelay.reason;
    if (input.worstLine?.status === "AT_RISK" && input.baseStatus === "ON_TRACK") {
      return `${input.worstLine.styleName} / ${input.worstLine.colorName} is at risk in ${input.worstLine.productionUnitName ?? "unmapped unit"}: ${input.worstLine.reason}`;
    }

    return input.baseReason;
  }

  private getReason(input: {
    status: DelayStatus;
    currentStageCode: string | null;
    expectedStageCode: string | null;
    daysRemaining: number;
    progressDeficitPercent: number;
    actualProgressPercent: number;
    plannedProgressPercent: number;
  }) {
    if (input.status === "DISPATCHED") return "Order has been dispatched.";
    if (input.status === "CANCELLED") return "Order has been cancelled.";
    if (input.daysRemaining < 0) return `Delivery date passed ${Math.abs(input.daysRemaining)} day(s) ago.`;
    if (input.status === "AT_RISK" && input.daysRemaining <= 3 && input.actualProgressPercent < 90) {
      return `Delivery is in ${input.daysRemaining} day(s), but actual progress is only ${input.actualProgressPercent}%.`;
    }
    if (input.progressDeficitPercent > 0) {
      return `Actual progress is ${input.progressDeficitPercent}% behind planned progress.`;
    }
    if (input.currentStageCode && input.expectedStageCode && input.currentStageCode !== input.expectedStageCode) {
      return `Current stage is ${input.currentStageCode}, expected stage is ${input.expectedStageCode}.`;
    }
    return "Order progress is aligned with the current plan.";
  }
}
