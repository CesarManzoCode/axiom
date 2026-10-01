// Thin client for the RPC endpoint. The token is a per-browser convenience; all access
// decisions are made server-side.
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const TOKEN_KEY = "axiom.token";
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session stays anonymous */
  }
}

export async function rpc<T = any>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body?.error?.code ?? "error", body?.error?.message ?? res.statusText, body?.error?.details);
  return body.result as T;
}
