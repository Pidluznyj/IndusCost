import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APP_PASSWORD_MIN_LENGTH,
  APP_SESSION_COOKIE_NAME,
  filterKnownPermissions,
  getEffectivePermissions,
  hasAnyPermission,
  hasPermission,
  isValidEmail,
  normalizeEmail,
  validatePasswordMin,
  type SafeAppUser,
} from "./appAuth.shared.js";
import {
  createOpaqueSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "./appAuth.server.js";

describe("appAuth.shared — contrato autenticado", () => {
  it("constantes e validadores de e-mail/senha permanecem estáveis", () => {
    assert.equal(APP_SESSION_COOKIE_NAME, "induscost_session");
    assert.equal(APP_PASSWORD_MIN_LENGTH, 8);
    assert.equal(normalizeEmail("  A@B.C  "), "a@b.c");
    assert.equal(isValidEmail("a@b.c"), true);
    assert.equal(isValidEmail("x"), false);
    assert.equal(validatePasswordMin("short"), "A senha deve ter no mínimo 8 caracteres.");
    assert.equal(validatePasswordMin("longenough"), null);
  });

  it("roles/permissões efetivas — SUPER_ADMIN recebe catálogo; demais filtram", () => {
    const adminEff = getEffectivePermissions({
      role: "SUPER_ADMIN",
      permissions: [],
    });
    assert.ok(adminEff.length > 10);
    assert.equal(hasPermission({ role: "SUPER_ADMIN", permissions: [] }, adminEff[0]!), true);

    const sellerPerms = filterKnownPermissions(["sales_orders.view", "not.a.real.key", "sales_orders.view"]);
    assert.deepEqual(sellerPerms, ["sales_orders.view"]);
    assert.equal(
      hasPermission(
        { role: "SELLER", permissions: sellerPerms },
        "sales_orders.view"
      ),
      true
    );
    assert.equal(
      hasAnyPermission(
        { role: "SELLER", permissions: sellerPerms },
        ["reports.view", "sales_orders.view"]
      ),
      true
    );
  });

  it("shape SafeAppUser permanece compatível com /api/auth/me", () => {
    const sample: SafeAppUser = {
      id: "u1",
      name: "Teste",
      email: "t@x.com",
      role: "VIEWER",
      permissions: [],
      effectivePermissions: [],
      permissionsVersion: 1,
      accessProfileId: null,
      accessProfileName: null,
      employeeId: null,
      employeeName: null,
      employeeDepartment: null,
      isActive: true,
      externalSellerId: null,
      externalSellerIds: [],
      sellerResponsibleName: null,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    assert.equal(sample.role, "VIEWER");
    assert.equal(typeof sample.permissionsVersion, "number");
  });
});

describe("appAuth.server — hash / sessão", () => {
  it("hash e verificação de senha (scrypt:v1) funcionam", async () => {
    const stored = await hashPassword("senha-segura-1");
    assert.match(stored, /^scrypt:v1:/);
    assert.equal(await verifyPassword("senha-segura-1", stored), true);
    assert.equal(await verifyPassword("outra", stored), false);
    assert.equal(await verifyPassword("x", "plain"), false);
  });

  it("token de sessão opaco e hash estável", () => {
    const a = createOpaqueSessionToken();
    const b = createOpaqueSessionToken();
    assert.equal(a.length, 64);
    assert.notEqual(a, b);
    assert.equal(hashSessionToken(a), hashSessionToken(a));
    assert.notEqual(hashSessionToken(a), hashSessionToken(b));
  });
});
