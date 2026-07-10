export interface AddInventoryInput {
  orderId: string;
  workflowStageId: string;
  quantity: number;
}

export interface RemoveInventoryInput {
  orderId: string;
  workflowStageId: string;
  quantity: number;
}

export interface TransferInventoryInput {
  orderId: string;
  fromStageId: string;
  toStageId: string;
  quantity: number;
  movementType?: "FORWARD" | "ROLLBACK" | "REWORK" | "SCRAP" | "DISPATCH";
  notes?: string;
  eventMessage?: string;
  createdBy?: string;
  source?: string;
}
