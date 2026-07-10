export interface MoveForwardInput {
  orderId: string;
  fromStageId: string;
  toStageId: string;
  quantity: number;
  notes?: string;
  createdBy?: string;
}

export interface RollbackInput {
  orderId: string;
  fromStageId: string;
  toStageId: string;
  quantity: number;
  notes?: string;
  createdBy?: string;
}
