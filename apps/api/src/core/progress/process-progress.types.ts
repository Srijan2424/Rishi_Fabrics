export type ProductionProcessKey =
  | "KNITTING"
  | "DYEING"
  | "CUTTING"
  | "STITCHING"
  | "FINISHING"
  | "PACKING";

export interface ProcessProgressInput {
  orderQuantity: number;
  quantities: Partial<Record<ProductionProcessKey, number>>;
}

export interface ProcessProgressComponent {
  process: ProductionProcessKey;
  quantity: number;
  cappedQuantity: number;
  completionPercent: number;
  weightPercent: number;
  contributionPercent: number;
}

export interface ProcessProgressReport {
  orderQuantity: number;
  overallProgressPercent: number;
  components: ProcessProgressComponent[];
}
