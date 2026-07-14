import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { prisma } from "./db.js";
import { ImportApplyError, ImportValidationError } from "./core/erp-import/erp-import.errors.js";
import { InsufficientInventoryError, InvalidInventoryQuantityError, InventoryNotFoundError } from "./core/inventory/inventory.errors.js";
import { captureError } from "./services/error-tracking.js";

export function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      issues: error.issues
    });
    return;
  }

  if (
    error instanceof ImportApplyError ||
    error instanceof ImportValidationError ||
    error instanceof InventoryNotFoundError ||
    error instanceof InsufficientInventoryError ||
    error instanceof InvalidInventoryQuantityError
  ) {
    res.status(400).json({
      error: error.message
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "This upload is too large. Upload PDFs one by one, or compress the tech pack before uploading."
        : error.code === "LIMIT_FILE_COUNT"
          ? "Too many files selected. Upload fewer tech packs at a time."
          : error.message;
    res.status(413).json({ error: message, code: error.code });
    return;
  }

  console.error(error);
  void captureError({
    error,
    route: req.originalUrl,
    method: req.method,
    userId: req.authUser?.id
  }).catch((captureError) => console.error("Failed to forward error to Sentry", captureError));

  const message = error instanceof Error ? error.message : "Unknown server error";
  const stack = error instanceof Error ? error.stack : undefined;
  if (req.authUser?.factoryId) {
    void prisma.systemError.create({
      data: {
        factoryId: req.authUser.factoryId,
        source: "api",
        message,
        stack,
        route: req.originalUrl,
        method: req.method,
        userId: req.authUser.id,
        metadata: { statusCode: 500 }
      }
    }).catch((captureError) => console.error("Failed to capture system error", captureError));
  }

  res.status(500).json({ error: "Internal server error" });
}
