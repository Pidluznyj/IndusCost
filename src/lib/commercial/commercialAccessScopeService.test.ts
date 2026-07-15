import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  CRM_NO_COMMERCIAL_ACCESS_MESSAGE,
  requireCrmCommercialGeneralScope,
  resolveCrmCommercialAccessScope,
  resolveCrmSellerDashboardQueryScope,
} from "@/src/lib/crmCommercialAccessScope.js";
import {
  canViewAllCommercialCrm,
  getAllowedResponsibleIds,
  getCommercialAccessScope,
  resolveCommercialCrmScopeDto,
  resolveRequestedResponsibleFilter,
} from "@/src/lib/commercial/commercialAccessScopeService.js";

function mockAuth(overrides: {
  permissions?: string[];
  role?: AppAuthContext["role"];
  externalSellerId?: number | null;
  sellerResponsibleName?: string | null;
  sellerIdentityKey?: string | null;
}): AppAuthContext {
  const permissions = overrides.permissions ?? [];
  const role = overrides.role ?? "SELLER";
  return {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
    role,
    permissions,
    effectivePermissions:
      role === "SUPER_ADMIN"
        ? ["crm.general.view", "crm.seller.all", "crm.seller.own"]
        : permissions,
    accessProfileId: null,
    accessProfileName: null,
    employeeId: null,
    employeeName: null,
    employeeDepartment: null,
    isActive: true,
    externalSellerId: overrides.externalSellerId ?? null,
    externalSellerIds:
      overrides.externalSellerId != null ? [overrides.externalSellerId] : [],
    sellerResponsibleName: overrides.sellerResponsibleName ?? null,
    sellerIdentityKey: overrides.sellerIdentityKey ?? null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionId: "sess-1",
  };
}

describe("commercialAccessScopeService", () => {
  it("SUPER_ADMIN e ADMIN vêem CRM unrestricted", () => {
    const superAdmin = mockAuth({ role: "SUPER_ADMIN" });
    const admin = mockAuth({ role: "ADMIN", permissions: [] });
    assert.equal(getCommercialAccessScope(superAdmin).mode, "unrestricted");
    assert.equal(getCommercialAccessScope(admin).mode, "unrestricted");
    assert.equal(canViewAllCommercialCrm(admin), true);
    assert.equal(requireCrmCommercialGeneralScope(admin).ok, true);
    assert.equal(requireCrmCommercialGeneralScope(superAdmin).ok, true);
  });

  it("COMMERCIAL_MANAGER usa fallback unrestricted (TODO hierarquia)", () => {
    const auth = mockAuth({ role: "COMMERCIAL_MANAGER", permissions: [] });
    const scope = getCommercialAccessScope(auth);
    assert.equal(scope.mode, "unrestricted");
    assert.equal(scope.commercialManagerUsesTeamFallback, true);
    assert.ok(scope.hierarchyTodo?.includes("TODO(commercial-hierarchy)"));
  });

  it("SELLER só vê própria carteira e não burla query de outro responsável", () => {
    const auth = mockAuth({
      role: "SELLER",
      permissions: ["crm.seller.own"],
      externalSellerId: 464,
      sellerResponsibleName: "GISLENE LIMA",
    });
    const scope = getCommercialAccessScope(auth);
    assert.equal(scope.mode, "own_portfolio");
    assert.equal(scope.sellerLocked, true);
    assert.equal(requireCrmCommercialGeneralScope(auth).ok, false);

    const allowed = getAllowedResponsibleIds(auth);
    assert.equal(allowed.unrestricted, false);
    assert.ok(allowed.sellerIdentityKeys.includes("gislene lima"));

    const filtered = resolveRequestedResponsibleFilter(auth, {
      externalSellerId: 999,
      responsible: "OUTRO VENDEDOR",
      sellerIdentityKey: "outro",
    });
    assert.equal(filtered.ok, true);
    if (!filtered.ok || !filtered.sellerScope) throw new Error("expected ok");
    assert.equal(filtered.sellerScope.scopeMode, "own");
    assert.equal(filtered.sellerScope.sellerIdentityKey, "gislene lima");
  });

  it("SELLER com crm.seller.all indevido não abre visão unrestricted", () => {
    const auth = mockAuth({
      role: "SELLER",
      permissions: ["crm.seller.own", "crm.seller.all", "crm.general.view"],
      sellerResponsibleName: "GISLENE LIMA",
    });
    assert.equal(getCommercialAccessScope(auth).mode, "own_portfolio");
    assert.equal(canViewAllCommercialCrm(auth), false);
  });

  it("SELLER vê pedido do cliente sob responsabilidade mesmo com Nomus diferente (escopo own)", () => {
    const auth = mockAuth({
      permissions: ["crm.seller.own"],
      sellerResponsibleName: "GISLENE LIMA",
    });
    const dash = resolveCrmSellerDashboardQueryScope(
      auth,
      "1399",
      "Outro",
      (raw) => Number.parseInt(String(raw), 10),
      (raw) => (typeof raw === "string" ? raw : null),
      "outro"
    );
    assert.equal(dash.ok, true);
    if (!dash.ok || !dash.sellerScope) throw new Error("expected ok");
    assert.equal(dash.sellerScope.scopeMode, "own");
    assert.equal(dash.sellerScope.sellerIdentityKey, "gislene lima");
  });

  it("VIEWER sem permissão comercial não recebe dados", () => {
    const auth = mockAuth({ role: "VIEWER", permissions: [] });
    const scope = getCommercialAccessScope(auth);
    assert.equal(scope.mode, "none");
    assert.equal(scope.blockedMessage, CRM_NO_COMMERCIAL_ACCESS_MESSAGE);
    assert.match(
      resolveCrmCommercialAccessScope(auth).blockedMessage ?? "",
      /carteira comercial vinculada/
    );
    const dto = resolveCommercialCrmScopeDto(auth);
    assert.equal(dto.denied, true);
    assert.equal(dto.canViewAll, false);
    assert.ok(dto.reason);
  });

  it("DTO canônico: SUPER_ADMIN canViewAll; SELLER sem carteira denied=false vazio", () => {
    const adminDto = resolveCommercialCrmScopeDto(mockAuth({ role: "SUPER_ADMIN" }));
    assert.equal(adminDto.canViewAll, true);
    assert.equal(adminDto.denied, false);
    assert.deepEqual(adminDto.allowedCustomerIds, []);

    const sellerEmpty = resolveCommercialCrmScopeDto(
      mockAuth({ role: "SELLER", permissions: ["crm.seller.own"] })
    );
    assert.equal(sellerEmpty.canViewAll, false);
    assert.equal(sellerEmpty.denied, false);
    assert.deepEqual(sellerEmpty.allowedCustomerIds, []);
    assert.match(sellerEmpty.reason ?? "", /responsável comercial/);
  });

  it("arquivos de escopo não acoplam Proposal nem motor de comissão", () => {
    const serviceSrc = readFileSync(
      join(process.cwd(), "src/lib/commercial/commercialAccessScopeService.ts"),
      "utf8"
    );
    const scopeSrc = readFileSync(
      join(process.cwd(), "src/lib/crmCommercialAccessScope.ts"),
      "utf8"
    );
    assert.equal(serviceSrc.includes("materializeCommission"), false);
    assert.equal(scopeSrc.includes("materializeCommission"), false);
    assert.equal(serviceSrc.includes('from "Proposal"'), false);
    assert.equal(scopeSrc.includes('from "Proposal"'), false);
  });
});
