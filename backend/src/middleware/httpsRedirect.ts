import { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

export function httpsRedirect(req: Request, res: Response, next: NextFunction) {
  if (config.disableHttpsRedirect) return next();
  if (req.headers["x-forwarded-proto"] === "http") {
    // 仅使用 Host 头（而非 x-forwarded-host），防止开放重定向
    const host = (req.headers["host"] || "").replace(/[^\w.\-:]/g, "");
    if (!host) return next();
    return res.redirect(301, `https://${host}${req.url}`);
  }
  next();
}
