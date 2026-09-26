export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...(status === 401 ? { "www-authenticate": "Bearer" } : {}),
    },
  });
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", "Use application/json.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "invalid_body", "A JSON object is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new ApiError(413, "body_too_large", "Request body must not exceed 4096 bytes.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw new ApiError(400, "invalid_body", "A valid JSON object is required.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "invalid_body", "A JSON object is required.");
  }
  return body as Record<string, unknown>;
}

export function textField(body: Record<string, unknown>, key: string, max = 80): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ApiError(400, "invalid_field", `${key} must be non-empty text of at most ${max} characters without control characters.`);
  }
  return value.trim();
}
