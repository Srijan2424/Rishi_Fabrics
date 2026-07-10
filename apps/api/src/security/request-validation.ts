import type { Request, Response, NextFunction } from "express";

export function rejectOversizedJson(req: Request, res: Response, next: NextFunction) {
  const contentLength = Number(req.header("content-length") ?? 0);

  if (contentLength > 2 * 1024 * 1024) {
    res.status(413).json({ error: "Request body too large" });
    return;
  }

  next();
}
