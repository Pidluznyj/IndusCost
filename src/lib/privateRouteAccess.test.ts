/**
 * P11 — registry de rotas públicas / privadas.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveModuleIdFromPath } from "@/src/lib/modulePermissions.js";
import {
  AUTHENTICATED_ALLOWLIST_PATH_PREFIXES,
  isAuthenticatedAllowlistPath,
  isPublicRoutePath,
  listPrivateRouteCoveredModules,
  resolvePrivateRouteModuleId,
} from "@/src/lib/privateRouteAccess.js";

describe("privateRouteAccess — públicos e allowlist", () => {
  it("landing e login são públicos", () => {
    assert.equal(isPublicRoutePath("/"), true);
    assert.equal(isPublicRoutePath("/login"), true);
  });

  it("prints e frota pública são públicos", () => {
    assert.equal(isPublicRoutePath("/proposals/x/print"), true);
    assert.equal(isPublicRoutePath("/sales-orders/x/print"), true);
    assert.equal(isPublicRoutePath("/public/fleet/reservation/tok"), true);
    assert.equal(
      isPublicRoutePath("/finance/suppliers/s1/service-terminations/t1/print"),
      true
    );
  });

  it("módulos privados não são públicos", () => {
    assert.equal(isPublicRoutePath("/finance/accounts-payable"), false);
    assert.equal(isPublicRoutePath("/employees"), false);
    assert.equal(isPublicRoutePath("/machines"), false);
  });

  it("allowlist autenticada inclui home pós-login", () => {
    assert.deepEqual(AUTHENTICATED_ALLOWLIST_PATH_PREFIXES, ["/home"]);
    assert.equal(isAuthenticatedAllowlistPath("/home"), true);
    assert.equal(isAuthenticatedAllowlistPath("/anything"), false);
  });
});

describe("privateRouteAccess — path → módulo", () => {
  it("mapeia finance especiais e crm deep links", () => {
    assert.equal(resolvePrivateRouteModuleId("/finance/suppliers"), "suppliers");
    assert.equal(
      resolvePrivateRouteModuleId("/finance/suppliers/abc"),
      "suppliers"
    );
    assert.equal(
      resolvePrivateRouteModuleId("/finance/portfolio-reconciliation"),
      "portfolio-reconciliation"
    );
    assert.equal(resolvePrivateRouteModuleId("/finance/accounts-payable"), "finance");
    assert.equal(
      resolvePrivateRouteModuleId("/crm/customers/id/intelligence"),
      "customers"
    );
    assert.equal(resolvePrivateRouteModuleId("/crm/foo"), "crm-commercial");
  });

  it("alias resolveModuleIdFromPath permanece alinhado", () => {
    assert.equal(
      resolveModuleIdFromPath("/finance/portfolio-reconciliation"),
      resolvePrivateRouteModuleId("/finance/portfolio-reconciliation")
    );
    assert.equal(
      resolveModuleIdFromPath("/crm/customers/1/intelligence"),
      "customers"
    );
  });

  it("desconhecido → null (DENY no evaluatePathViewAccess)", () => {
    assert.equal(resolvePrivateRouteModuleId("/area-inexistente"), null);
  });

  it("cobre todos os módulos da sidebar", () => {
    assert.ok(listPrivateRouteCoveredModules().length >= 20);
  });
});
