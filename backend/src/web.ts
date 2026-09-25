import { ApiError, json, readBody, textField } from "./http";
import { authenticate, validToken } from "./identity";
import { PAGE, SCRIPT, STYLE } from "./web-assets";

const PREFIX = "/factorio-relay";
const COOKIE = "fsr_browser";

function sameOrigin(request: Request): void {
  if (["GET", "HEAD"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin) {
    throw new ApiError(403, "invalid_origin", "The browser request must come from this site.");
  }
}

function cookieToken(request: Request): string | undefined {
  const part = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim())
    .find(value => value.startsWith(`${COOKIE}=`));
  const token = part?.slice(COOKIE.length + 1);
  return token && validToken(token, "device") ? token : undefined;
}

function sessionCookie(request: Request, token?: string): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token ?? ""}; Path=${PREFIX}; HttpOnly; SameSite=Strict${secure}; Max-Age=${token ? 604800 : 0}`;
}

export function browserAsset(kind: "page" | "script" | "style"): Response {
  const body = kind === "page" ? PAGE : kind === "script" ? SCRIPT : STYLE;
  const mime = kind === "page" ? "text/html; charset=utf-8" : kind === "script"
    ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8";
  const headers: Record<string, string> = {
    "content-type": mime,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
  if (kind === "page") {
    headers["content-security-policy"] = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
  }
  return new Response(body, { headers });
}

export async function browserSession(request: Request, db: D1Database): Promise<Response> {
  sameOrigin(request);
  if (request.method === "DELETE") {
    const response = json({ signedOut: true });
    response.headers.set("set-cookie", sessionCookie(request));
    return response;
  }
  if (request.method !== "POST") throw new ApiError(404, "not_found", "The requested endpoint does not exist.");
  const token = textField(await readBody(request), "token", 160);
  const authRequest = new Request(request.url, { headers: { authorization: `Bearer ${token}` } });
  const identity = await authenticate(authRequest, db);
  const response = json({ identity });
  response.headers.set("set-cookie", sessionCookie(request, token));
  return response;
}

export async function browserRequest<T>(request: Request, env: T,
  dispatch: (request: Request, env: T) => Promise<Response>): Promise<Response> {
  sameOrigin(request);
  const url = new URL(request.url);
  url.pathname = url.pathname.slice(PREFIX.length);
  const registration = request.method === "POST" && url.pathname === "/v1/devices/register";
  const token = cookieToken(request);
  if (!registration && !token) throw new ApiError(401, "unauthorized", "Sign in to continue.");
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const forwarded = new Request(url, { method: request.method, headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    // Cloudflare supports request streaming. Browser uploads remain bounded by the transfer API.
    duplex: "half" } as RequestInit);
  const response = await dispatch(forwarded, env);
  if (!registration || response.status !== 201) return response;
  const result = await response.clone().json() as { token?: string };
  if (result.token && validToken(result.token, "device")) {
    response.headers.set("set-cookie", sessionCookie(request, result.token));
  }
  return response;
}
