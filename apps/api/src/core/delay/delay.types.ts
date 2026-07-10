export type DelayStatus = "ON_TRACK" | "AT_RISK" | "DELAYED" | "DISPATCHED" | "CANCELLED";

export interface StageDelayExpectation {
  stageCode: string;
  stageName: string;
  sequence: number;
  expectedDurationDays: number;
  expectedStartDay: number;
  expectedEndDay: number;
}

export interface OrderDelayReport {
  orderId: string;
  orderNumber: string;
  status: DelayStatus;
  reason: string;
  currentStageCode: string | null;
  expectedStageCode: string | null;
  expectedStageName: string | null;
  actualProgressPercent: number;
  plannedProgressPercent: number;
  progressDeficitPercent: number;
  daysElapsed: number;
  daysRemaining: number;
  totalPlannedDays: number;
  deliveryDate: Date;
  stageExpectations: StageDelayExpectation[];
  lineDelayReports: OrderLineDelayReport[];
  unitDelaySummary: UnitDelaySummary[];
  samplingDelay: SamplingDelaySummary;
}

export interface SamplingDelaySummary {
  status: DelayStatus;
  approvalsComplete: number;
  approvalsTotal: number;
  plannedSamplingDays: number;
  actualSamplingDays: number;
  progressPercent: number;
  reason: string;
}

export interface OrderLineDelayReport {
  orderLineId: string;
  orderId: string;
  orderNumber: string;
  buyerName: string;
  styleName: string;
  colorName: string;
  productionUnitId: string | null;
  productionUnitCode: string | null;
  productionUnitName: string | null;
  productionStatus: string | null;
  rowColorHex: string | null;
  status: DelayStatus;
  reason: string;
  actualProgressPercent: number;
  plannedProgressPercent: number;
  progressDeficitPercent: number;
  daysRemaining: number;
  currentStageCode: string;
  expectedStageCode: string;
  orderQuantity: number;
  cuttingTotalQty: number;
  lineLoadingQty: number;
  totalLineOutQty: number;
  lineInBalanceQty: number;
  lastUpdatedAt: Date;
}

export interface UnitDelaySummary {
  productionUnitId: string | null;
  productionUnitCode: string | null;
  productionUnitName: string | null;
  status: DelayStatus;
  delayedLines: number;
  atRiskLines: number;
  onTrackLines: number;
  totalLines: number;
}
