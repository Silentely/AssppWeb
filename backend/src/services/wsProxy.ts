import { Server as HttpServer } from "http";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { accessPasswordHash, verifyAccessToken } from "../config.js";
import { logWarn } from "../utils/requestLog.js";

// 仅放行 bag/auth/purchase/version 流程所需的 Apple 主机
wisp.options.hostname_whitelist = [
  /^auth\.itunes\.apple\.com$/,
  /^buy\.itunes\.apple\.com$/,
  /^init\.itunes\.apple\.com$/,
  /^p\d+-buy\.itunes\.apple\.com$/,
];
wisp.options.port_whitelist = [443];
wisp.options.allow_direct_ip = false;
// allow_private_ips 必须为 true：Docker/容器 DNS 可能把白名单主机解析到保留网段
// （如 OrbStack 中的 198.18.x.x）。上方的 hostname 白名单是主要安全控制。
wisp.options.allow_private_ips = true;
wisp.options.allow_loopback_ips = false;

const WISP_SCOPE = "WsProxy";

export function setupWsProxy(server: HttpServer) {
  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith("/wisp")) {
      if (accessPasswordHash) {
        const url = new URL(req.url, "http://localhost");
        // Cloudflare 的 URL 规范化可能给查询串追加尾部斜杠
        // （如 ?token=abc/ 而非 ?token=abc），这里将其去掉。
        const token = (url.searchParams.get("token") || "").replace(/\/+$/, "");
        if (!verifyAccessToken(token)) {
          // 记录来源与结果，便于排查异常连接与未授权探测
          logWarn(WISP_SCOPE, "system", "wisp upgrade rejected: bad token", {
            remote: req.socket.remoteAddress ?? "",
            url: req.url.slice(0, 160),
          });
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
      }

      wisp.routeRequest(req, socket, head);
    } else {
      logWarn(WISP_SCOPE, "system", "websocket upgrade rejected: not /wisp", {
        remote: req.socket.remoteAddress ?? "",
        url: (req.url ?? "").slice(0, 160),
      });
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
    }
  });
}
