import { authHeaders } from "../api/client";
import { parsePlist } from "./plist";
import { defaultAuthURL, normalizeAuthURL } from "./authEndpoint";
import { log } from "../utils/log";

export { defaultAuthURL };

export interface BagOutput {
  authURL: string;
}

// 通过后端代理拉取 bag：后端使用 Node.js 原生 HTTPS 请求，
// bag 响应为公开数据（Apple 服务地址，不含任何凭据）。
export async function fetchBag(deviceId: string): Promise<BagOutput> {
  try {
    const resp = await fetch(`/api/bag?guid=${encodeURIComponent(deviceId)}`, {
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      log.warn(
        "Bag",
        "Proxy request failed, using default auth endpoint",
        { error: err.error || `HTTP ${resp.status}` },
      );
      return { authURL: defaultAuthURL };
    }

    const xml = await resp.text();
    const dict = parsePlist(xml) as Record<string, any>;

    // authenticateAccount 可能位于顶层或 urlBag 字典内，优先取顶层值
    let authURL = dict.authenticateAccount as string | undefined;
    if (!authURL) {
      const urlBag = dict.urlBag as Record<string, any> | undefined;
      authURL = urlBag?.authenticateAccount as string | undefined;
    }

    if (!authURL) {
      log.warn(
        "Bag",
        "authenticateAccount URL not found in bag, using default auth endpoint",
      );
      return { authURL: defaultAuthURL };
    }

    return { authURL: normalizeAuthURL(authURL) };
  } catch (error) {
    log.warn("Bag", "Failed to fetch/parse bag, using default auth endpoint", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { authURL: defaultAuthURL };
  }
}
