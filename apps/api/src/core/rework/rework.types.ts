export interface CreateReworkInput {
  orderId: string;
  sourceStageId: string;
  quantity: number;
  reason: string;
  department?: string;
  severity?: string;
  rootCause?: string;
  correctiveAction?: string;
  createdBy?: string;
}

