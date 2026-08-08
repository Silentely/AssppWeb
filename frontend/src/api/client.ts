import { getAccessToken } from "../components/Auth/PasswordGate";

const BASE_URL = "";

export function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { "X-Access-Token": token } : {};
}

// 后端错误统一为 { error: "..." } 结构；解析出干净文案，
// 避免 toast 直接展示 {"error":"..."} 这类 JSON 原文
async function readErrorMessage(res: Response): Promise<string> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    return `Request failed with status ${res.status}`;
  }
  if (!text.trim()) {
    return `Request failed with status ${res.status}`;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const error = record.error;
      if (typeof error === "string" && error.trim()) {
        return error.trim();
      }
      const message = record.message;
      if (typeof message === "string" && message.trim()) {
        return message.trim();
      }
    }
  } catch {
    // 非 JSON 响应体按原文处理
  }
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json();
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json();
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
}
