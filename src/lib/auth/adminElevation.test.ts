import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_ELEVATION_COOKIE_NAME,
  ADMIN_ELEVATION_PURPOSE,
  ADMIN_ELEVATION_REQUIRED_CODE,
  ADMIN_ELEVATION_TTL_MS,
  BOOTSTRAP_ADMIN_REQUIRED_CODE,
  isNonSessionUnauthorizedCode,
} from "./adminElevation.shared.js";
import { APP_SESSION_COOKIE_NAME } from "./appAuth.shared.js";
import {
  createAdminElevationPayload,
  decodeAdminElevationToken,
  encodeAdminElevationToken,
  isAdminElevationBoundToSession,
  resolveAdminElevationSecret,
} from "./adminElevation.server.js";

describe("adminElevation — isolamento de sessão", () => {
  it("cookie de elevação é distinto da sessão principal e do bootstrap", () => {
    assert.equal(ADMIN_ELEVATION_COOKIE_NAME, "induscost_admin_elevation");
    assert.notEqual(ADMIN_ELEVATION_COOKIE_NAME, APP_SESSION_COOKIE_NAME);
    assert.notEqual(ADMIN_ELEVATION_COOKIE_NAME, "induscost_bootstrap_admin");
    assert.equal(ADMIN_ELEVATION_TTL_MS, 15 * 60 * 1000);
    assert.equal(ADMIN_ELEVATION_PURPOSE, "adminElevation");
  });

  it("401 de bootstrap/credencial inválida não é morte de sessão", () => {
    assert.equal(isNonSessionUnauthorizedCode(BOOTSTRAP_ADMIN_REQUIRED_CODE), true);
    assert.equal(isNonSessionUnauthorizedCode("INVALID_CREDENTIALS"), true);
    assert.equal(isNonSessionUnauthorizedCode("UNAUTHORIZED"), false);
    assert.equal(isNonSessionUnauthorizedCode(ADMIN_ELEVATION_REQUIRED_CODE), false);
  });

  it("token HMAC amarra userId+sessionId e expira", () => {
    const secret = "test-elevation-secret";
    const payload = createAdminElevationPayload({
      userId: "user-a",
      sessionId: "sess-1",
      nowMs: 1_000_000,
      ttlMs: 60_000,
    });
    const token = encodeAdminElevationToken(payload, secret);
    const decoded = decodeAdminElevationToken(token, secret, 1_000_000);
    assert.ok(decoded);
    assert.equal(decoded!.userId, "user-a");
    assert.equal(decoded!.sessionId, "sess-1");
    assert.equal(
      isAdminElevationBoundToSession(decoded, { userId: "user-a", sessionId: "sess-1", nowMs: 1_010_000 }),
      true
    );
    assert.equal(
      isAdminElevationBoundToSession(decoded, { userId: "user-b", sessionId: "sess-1", nowMs: 1_010_000 }),
      false
    );
    assert.equal(
      isAdminElevationBoundToSession(decoded, { userId: "user-a", sessionId: "sess-2", nowMs: 1_010_000 }),
      false
    );
    assert.equal(decodeAdminElevationToken(token, secret, payload.exp + 1), null);
    assert.equal(decodeAdminElevationToken(token, "other-secret", 1_000_000), null);
  });

  it("segredo de elevação não reutiliza o token bootstrap cru", () => {
    const env = "bootstrap-session-secret";
    const resolved = resolveAdminElevationSecret(env, "fallback");
    assert.match(resolved, /^induscost-admin-elevation:/);
    assert.notEqual(resolved, env);
  });
});
