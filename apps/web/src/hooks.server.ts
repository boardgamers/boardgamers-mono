import type { Handle, HandleFetch } from "@sveltejs/kit";
import { PUBLIC_SERVER } from "$env/static/public";
import z from "zod";

const safeJsonParse = (value: string | undefined) => {
  try {
    return value ? JSON.parse(value) : null;
  } catch (error) {
    return null;
  }
};

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.requestId = crypto.randomUUID();
  const sidebarOpen = event.cookies.get("sidebarOpen");
  const refreshToken = event.cookies.get("refreshToken");
  event.locals.sidebarOpen = z.boolean().safeParse(safeJsonParse(sidebarOpen)).data ?? false;
  event.locals.refreshToken =
    z.object({ code: z.string(), expiresAt: z.number() }).safeParse(safeJsonParse(refreshToken)).data ?? null;

  event.setHeaders({
    "X-Request-Id": event.locals.requestId,
  });
  const response = await resolve(event);

  return response;
};

export const handleFetch: HandleFetch = async ({ request, fetch }) => {
  const origin = new URL(request.url).origin;
  const path = new URL(request.url).pathname;

  if (path.startsWith("/api/gameplay")) {
    request = new Request(request.url.replace(origin, PUBLIC_SERVER || "http://localhost:50803"), request);
  } else if (path.startsWith("/api/")) {
    request = new Request(request.url.replace(origin, PUBLIC_SERVER || "http://localhost:50801"), request);
  }

  return fetch(request);
};
