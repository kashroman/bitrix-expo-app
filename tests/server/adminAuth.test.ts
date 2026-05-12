import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { checkAdminToken, adminAuthEnabled } from "../../server/lib/adminAuth.ts";

function makeReq(headers: Record<string, string | undefined>): Request {
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

const ENV_KEY = "ADMIN_JOB_TOKEN";

describe("checkAdminToken", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
  });

  it("returns 503 when ADMIN_JOB_TOKEN is unset", () => {
    const r = checkAdminToken(makeReq({}));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.status, 503);
    assert.equal(adminAuthEnabled(), false);
  });

  it("returns 503 when ADMIN_JOB_TOKEN is blank", () => {
    process.env[ENV_KEY] = "   ";
    const r = checkAdminToken(makeReq({ "x-admin-token": "anything" }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.status, 503);
  });

  it("returns 401 when no token header is provided", () => {
    process.env[ENV_KEY] = "secret-abc";
    const r = checkAdminToken(makeReq({}));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.status, 401);
    assert.ok(adminAuthEnabled());
  });

  it("returns 403 when the token does not match", () => {
    process.env[ENV_KEY] = "secret-abc";
    const r = checkAdminToken(makeReq({ "x-admin-token": "wrong" }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.status, 403);
  });

  it("accepts a matching x-admin-token", () => {
    process.env[ENV_KEY] = "secret-abc";
    const r = checkAdminToken(makeReq({ "x-admin-token": "secret-abc" }));
    assert.equal(r.ok, true);
  });

  it("accepts a Bearer token in Authorization header", () => {
    process.env[ENV_KEY] = "secret-abc";
    const r = checkAdminToken(
      makeReq({ authorization: "Bearer secret-abc" }),
    );
    assert.equal(r.ok, true);
  });

  it("rejects a Bearer token with the wrong value", () => {
    process.env[ENV_KEY] = "secret-abc";
    const r = checkAdminToken(
      makeReq({ authorization: "Bearer something-else" }),
    );
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.status, 403);
  });

  it("rejects tokens of different lengths without leaking timing", () => {
    process.env[ENV_KEY] = "secret-abc";
    const r = checkAdminToken(makeReq({ "x-admin-token": "x" }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.status, 403);
  });
});
