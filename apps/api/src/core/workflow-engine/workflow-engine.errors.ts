export class InvalidTransitionError extends Error {
  constructor() {
    super("Transition not allowed");
  }
}

export class InsufficientInventoryError extends Error {
  constructor() {
    super("Insufficient inventory");
  }
}