import express from "express";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import { config } from "./config.js";
import { httpsRedirect } from "./middleware/httpsRedirect.js";
import { requestTrace } from "./middleware/requestTrace.js";
import { accessAuth } from "./middleware/accessAuth.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { setupWsProxy } from "./services/wsProxy.js";
import authRoutes from "./routes/auth.js";
import searchRoutes from "./routes/search.js";
import downloadRoutes from "./routes/downloads.js";
import packageRoutes from "./routes/packages.js";
import installRoutes from "./routes/install.js";
import settingsRoutes from "./routes/settings.js";
import bagRoutes from "./routes/bag.js";

const app = express();

// 中间件
app.use(httpsRedirect);
app.use(express.json({ limit: "50mb" }));

// API 路由
app.use("/api", requestTrace);
app.use("/api", accessAuth);
app.use("/api", authRoutes);
app.use("/api", searchRoutes);
app.use("/api", downloadRoutes);
app.use("/api", packageRoutes);
app.use("/api", installRoutes);
app.use("/api", settingsRoutes);
app.use("/api", bagRoutes);

// 托管前端静态文件
const publicDir = path.resolve(import.meta.dirname, "../public");
function setNoStoreForHtml(res: express.Response, filePath: string) {
  if (path.extname(filePath) === ".html") {
    res.setHeader("Cache-Control", "no-store");
  }
}

app.use(
  express.static(publicDir, {
    setHeaders: setNoStoreForHtml,
  }),
);

// SPA 兜底：非 API 路由一律返回 index.html
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) {
    return next();
  }
  const indexPath = path.join(publicDir, "index.html");
  if (fs.existsSync(indexPath)) {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(indexPath);
  } else {
    next();
  }
});

// 错误处理中间件（必须最后注册）
app.use(errorHandler);

// 创建 HTTP 服务器
const server = createServer(app);

// Apple TCP 连接的 WebSocket 代理
setupWsProxy(server);

// 确保数据目录存在
fs.mkdirSync(config.dataDir, { recursive: true });

server.listen(config.port, () => {
  console.log(`Server listening on port ${config.port}`);
  console.log(`Data directory: ${path.resolve(config.dataDir)}`);
});

export { app, server };
