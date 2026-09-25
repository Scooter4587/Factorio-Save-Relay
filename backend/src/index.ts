const SERVICE_NAME = "factorio-save-relay-api";
const SERVICE_VERSION = "0.1.0";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

export default {
  async fetch(request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        service: SERVICE_NAME,
        status: "ok",
        version: SERVICE_VERSION,
      });
    }

    if (request.method === "GET" && url.pathname === "/v1/version") {
      return json({ version: SERVICE_VERSION });
    }

    return json(
      {
        error: {
          code: "not_found",
          message: "The requested endpoint does not exist.",
        },
      },
      404,
    );
  },
} satisfies ExportedHandler;
