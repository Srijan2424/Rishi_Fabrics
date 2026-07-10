export class InventoryNotFoundError extends Error {
  constructor() {
    super("Inventory not found");
    this.name = "InventoryNotFoundError";
  }
}

export class InsufficientInventoryError extends Error {
  constructor() {
    super("Insufficient inventory");
    this.name = "InsufficientInventoryError";
  }
}

export class InvalidInventoryQuantityError extends Error {
  constructor() {
    super("Inventory quantity must be a positive integer");
    this.name = "InvalidInventoryQuantityError";
  }
}
