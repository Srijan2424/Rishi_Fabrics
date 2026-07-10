import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { prisma } from "./db.js";
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
