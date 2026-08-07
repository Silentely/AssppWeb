import type { Request, Response, NextFunction } from "express";
import { getRequestId, logError, safeErrorMessage } from "../utils/requestLog.js";

const ERROR_SCOPE = "ErrorHandler";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  logError(ERROR_SCOPE, getRequestId(res), "unhandled error", {
    method: req.method,
    path: req.originalUrl || req.url,
    message: safeErrorMessage(err),
    stack: err.stack,
  });
  res.status(500).json({ error: "Internal server error" });
}
