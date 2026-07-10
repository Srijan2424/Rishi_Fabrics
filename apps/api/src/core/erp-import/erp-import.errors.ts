export class ImportValidationError extends Error {
  constructor(message = "Import validation failed") {
    super(message);
    this.name = "ImportValidationError";
  }
}

export class ImportApplyError extends Error {
  constructor(message = "Import could not be applied") {
    super(message);
    this.name = "ImportApplyError";
  }
}

