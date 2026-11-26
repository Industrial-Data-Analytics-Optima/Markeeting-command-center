import { readJsonObject } from "../security/request.ts";
import { env } from "../platform";
import { AccessError } from "./core";
export function database() {
  if (!env.DB)
    throw new AccessError(503, "Workspace storage is not configured yet.");
  return env.DB as D1Database;
}
export function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      ...headers,
    },
  });
}
export function failure(error: unknown) {
  if (!(error instanceof AccessError))
    console.error("Workspace request failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
  return json(
    {
      message:
        error instanceof AccessError
          ? error.message
          : "The request could not be completed. Please try again.",
    },
    error instanceof AccessError ? error.status : 500,
  );
}
export async function body(request: Request, maxBytes = 16384) {
  return readJsonObject(request, maxBytes);
}
