export class ReworkStageNotFoundError extends Error {
  constructor() {
    super("Rework stage not found in workflow");
    this.name = "ReworkStageNotFoundError";
  }
}

export class InvalidReworkQuantityError extends Error {
  constructor() {
    super("Rework quantity must be a positive integer");
    this.name = "InvalidReworkQuantityError";
  }
}

