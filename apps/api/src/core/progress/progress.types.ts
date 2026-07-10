export type PipelineName = "SAMPLING" | "FABRIC" | "GARMENT";

export interface StageProgress {
  stageId: string;
  stageCode: string;
  stageName: string;
  category: string;
  pipeline: PipelineName;
  sequence: number;
  plannedQuantity: number;
  activeQuantity: number;
  completedQuantity: number;
  reworkedQuantity: number;
  scrappedQuantity: number;
  stageCompletionPercent: number;
  positionPercent: number;
}

export interface PipelineProgress {
  pipeline: PipelineName;
  plannedQuantity: number;
  activeQuantity: number;
  completedQuantity: number;
  reworkedQuantity: number;
  scrappedQuantity: number;
  progressPercent: number;
}

export interface MaterialAccountability {
  orderQuantity: number;
  activeInventoryQuantity: number;
  openReworkQuantity: number;
  scrappedQuantity: number;
  accountedQuantity: number;
  missingQuantity: number;
  overageQuantity: number;
  isBalanced: boolean;
}

export interface OrderProgressReport {
  orderId: string;
  orderNumber: string;
  orderQuantity: number;
  currentStageCode: string | null;
  overallProgressPercent: number;
  stageProgress: StageProgress[];
  pipelineProgress: PipelineProgress[];
  materialAccountability: MaterialAccountability;
}
