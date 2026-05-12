/**
 * Constant-time token guard for admin-only endpoints.
 *
 * The token is read from ADMIN_JOB_TOKEN. When unset the guard returns
 * `disabled` so callers can respond with 503 — admin endpoints stay closed
 * until an operator manually sets the env var in Render. Tokens are never
 * logged or echoed back to the client.
 */
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export type AdminAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 503; reason: string };

function extractToken(req: Request): string | undefined {
  const header = req.header("x-admin-token");
  if (typeof header === "string" && header.length > 0) return header;
  const auth = req.header("authorization");
  if (typeof auth === "string" && auth.length > 0) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  return undefined;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function checkAdminToken(req: Request): AdminAuthResult {
  const expected = process.env.ADMIN_JOB_TOKEN?.trim();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      reason: "admin-disabled: ADMIN_JOB_TOKEN is not configured on the server",
    };
  }
  const provided = extractToken(req);
  if (!provided) {
    return {
      ok: false,
      status: 401,
      reason: "missing-token: provide x-admin-token header or Bearer auth",
    };
  }
  if (!safeEqual(provided, expected)) {
    return { ok: false, status: 403, reason: "invalid-token" };
  }
  return { ok: true };
}

export function adminAuthEnabled(): boolean {
  return Boolean(process.env.ADMIN_JOB_TOKEN?.trim());
}
