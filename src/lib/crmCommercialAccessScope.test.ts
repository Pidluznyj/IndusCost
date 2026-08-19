import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  crmCommercialSellerMatchFilters,
  resolveCrmCommercialAccessScope,
  resolveCrmSellerDashboardQueryScope,
} from "@/src/lib/crmCommercialAccessScope.js";
import { salesOrderMatchesCrmSellerScope } from "@/src/lib/crmCustomerSellerScope.js";
import {
  canAccessCrmGeneral,
  canAccessCrmSeller,
  canFilterAllCrmSellers,
  isCrmOwnSellerOnly,
} from "@/src/lib/modulePermissions.js";
import { getDefaultCrmManagementTab } from "@/src/components/CrmCommercialManagementTabs.js";

function mockAuth(overrides: {
  permissions?: string[];
  role?: AppAuthContext["role"];
  externalSellerId?: number | null;
  sellerResponsibleName?: string | null;
  sellerIdentityKey?: string | null;
  canonicalViewResources?: string[];
}): AppAuthContext {
  const permissions = overrides.permissions ?? [];
  // VIEWER por padrão: SELLER agora é global por role (independe da bag), então
  // os testes de mecânica "own scope via permissão" usam um role não-global.
  const role = overrides.role ?? "VIEWER";
  return {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
    role,
    permissions,
    effectivePermissions: role === "SUPER_ADMIN" ? ["crm.general.view", "crm.seller.all", "crm.seller.own"] : permissions,
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
    canonicalAccess: overrides.canonicalViewResources
      ? { viewResources: overrides.canonicalViewResources }
      : undefined,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionId: "sess-1",
  };
}

function checkerFromPermissions(permissions: string[]) {
  const set = new Set(permissions);
  return {
    hasPermission: (p: string) => set.has(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => set.has(p)),
  };
}

describe("crmCommercialAccessScope", () => {
  it("gestor comercial tem escopo global e pode filtrar todos os vendedores", () => {
    const auth = mockAuth({
      role: "COMMERCIAL_MANAGER",
      permissions: ["crm.general.view", "crm.seller.view", "crm.seller.all"],
    });
    const scope = resolveCrmCommercialAccessScope(auth);
    assert.equal(scope.canViewCommercialGeneral, true);
    assert.equal(scope.canViewAllSellers, true);
    assert.equal(scope.dataScope, "global");
    assert.equal(scope.sellerLocked, false);
    assert.equal(canFilterAllCrmSellers(checkerFromPermissions(auth.permissions)), true);
    assert.equal(getDefaultCrmManagementTab(checkerFromPermissions(auth.permissions)), "general");
  });

  it("perfil gestor (role VIEWER) com crm.seller.all/general vê carteira de todos", () => {
    const auth = mockAuth({
      role: "VIEWER",
      permissions: [
        "crm.view",
        "crm.general.view",
        "crm.seller.view",
        "crm.seller.all",
      ],
    });
    const scope = resolveCrmCommercialAccessScope(auth);
    assert.equal(scope.dataScope, "global");
    assert.equal(scope.sellerLocked, false);
    assert.equal(scope.canViewCommercialGeneral, true);
  });

  it("perfil VIEWER incoerente com own + all permanece own sem Gestão Geral", () => {
    const scope = resolveCrmCommercialAccessScope(
      mockAuth({
        role: "VIEWER",
        permissions: [
          "crm.view",
          "crm.seller.view",
          "crm.seller.own",
          "crm.seller.all",
        ],
        externalSellerId: 464,
      })
    );
    assert.equal(scope.dataScope, "own");
    assert.equal(scope.canViewAllSellers, false);
  });

  it("fotografia canônica prevalece sobre bag AppUser desatualizada", () => {
    const scope = resolveCrmCommercialAccessScope(
      mockAuth({
        role: "VIEWER",
        permissions: ["crm.view", "crm.seller.view", "crm.seller.all"],
        canonicalViewResources: [
          "commercial.crm",
          "commercial.crm.seller",
          "commercial.crm.portfolio",
          "commercial.crm.scope.own",
        ],
        externalSellerId: 464,
      })
    );
    assert.equal(scope.dataScope, "own");
    assert.equal(scope.canViewAllSellers, false);
  });

  it("SELLER agora recebe escopo global mesmo sem permissões elevadas na bag", () => {
    const auth = mockAuth({
      role: "SELLER",
      permissions: ["crm.view", "crm.seller.view"],
      externalSellerId: 464,
      sellerResponsibleName: "GISLENE LIMA",
    });
    const scope = resolveCrmCommercialAccessScope(auth);
    assert.equal(scope.dataScope, "global");
    assert.equal(scope.sellerLocked, false);
    assert.equal(scope.canViewAllSellers, true);
    assert.equal(scope.canViewCommercialGeneral, true);

    const checker = {
      ...checkerFromPermissions(auth.permissions),
      authUser: { role: "SELLER" as const, effectivePermissions: auth.permissions },
    };
    assert.equal(canFilterAllCrmSellers(checker), true);
    assert.equal(isCrmOwnSellerOnly(checker), false);

    const dash = resolveCrmSellerDashboardQueryScope(
      auth,
      "999",
      "OUTRO VENDEDOR",
      (raw) => Number.parseInt(String(raw), 10),
      (raw) => (typeof raw === "string" ? raw : null),
      "outro"
    );
    assert.equal(dash.ok, true);
    if (!dash.ok || !dash.sellerScope) throw new Error("expected ok");
    assert.equal(dash.sellerScope.scopeMode, "all");
    assert.equal(dash.sellerScope.sellerIdentityKey, "outro");
  });

  it("admin com crm.seller.all enxerga todos os vendedores no dashboard", () => {
    const auth = mockAuth({
      role: "ADMIN",
      permissions: ["crm.general.view", "crm.seller.all"],
    });
    const result = resolveCrmSellerDashboardQueryScope(
      auth,
      "999",
      null,
      (raw) => (raw === "999" ? 999 : null),
      (raw) => (typeof raw === "string" ? raw : null)
    );
    assert.equal(result.ok, true);
    if (!result.ok || !result.sellerScope) throw new Error("expected ok");
    assert.equal(result.sellerScope.scopeMode, "all");
    assert.equal(result.sellerScope.externalSellerId, 999);
  });

  it("vendedor com crm.seller.own ignora query de outro vendedor", () => {
    const auth = mockAuth({
      permissions: ["crm.seller.view", "crm.seller.own"],
      externalSellerId: 464,
      sellerResponsibleName: "GISLENE LIMA",
    });
    const scope = resolveCrmCommercialAccessScope(auth);
    assert.equal(scope.canViewCommercialGeneral, false);
    assert.equal(scope.dataScope, "own");
    assert.equal(scope.sellerLocked, true);
    assert.equal(canAccessCrmGeneral(checkerFromPermissions(auth.permissions)), false);
    assert.equal(canAccessCrmSeller(checkerFromPermissions(auth.permissions)), true);
    assert.equal(isCrmOwnSellerOnly(checkerFromPermissions(auth.permissions)), true);
    assert.equal(getDefaultCrmManagementTab(checkerFromPermissions(auth.permissions)), "seller");

    const result = resolveCrmSellerDashboardQueryScope(
      auth,
      "1399",
      "Rodrigo Da Silva Ramos",
      (raw) => Number.parseInt(String(raw), 10),
      (raw) => (typeof raw === "string" ? raw : null)
    );
    assert.equal(result.ok, true);
    if (!result.ok || !result.sellerScope) throw new Error("expected ok");
    assert.equal(result.sellerScope.scopeMode, "own");
    assert.equal(result.sellerScope.sellerIdentityKey, "gislene lima");
    assert.equal(result.sellerScope.externalSellerId, null);
    assert.equal(result.sellerScope.responsible, null);
  });

  it("vendedor sem vínculo comercial: carteira vazia (own), não 403/500", () => {
    const auth = mockAuth({ permissions: ["crm.seller.own"] });
    const scope = resolveCrmCommercialAccessScope(auth);
    // Escopo own + sinalização SELLER_NOT_LINKED — dashboards retornam vazio.
    assert.equal(scope.dataScope, "own");
    assert.equal(scope.blockedReason, "SELLER_NOT_LINKED");
    assert.match(scope.blockedMessage ?? "", /responsável comercial/);

    const dash = resolveCrmSellerDashboardQueryScope(
      auth,
      null,
      null,
      () => null,
      () => null
    );
    assert.equal(dash.ok, true);
    if (!dash.ok || !dash.sellerScope) throw new Error("expected empty own scope");
    assert.equal(dash.sellerScope.scopeMode, "own");
    assert.equal(dash.sellerScope.sellerIdentityKey, null);
    assert.equal(dash.sellerScope.externalSellerId, null);
  });

  it("usuário só com crm.view não recebe escopo de dados comerciais", () => {
    const auth = mockAuth({ role: "VIEWER", permissions: ["crm.view"] });
    const scope = resolveCrmCommercialAccessScope(auth);
    assert.equal(scope.dataScope, "none");
    assert.equal(canAccessCrmSeller(checkerFromPermissions(auth.permissions)), false);
  });

  it("crmCommercialSellerMatchFilters prioriza sellerIdentityKey quando informado", () => {
    assert.deepEqual(crmCommercialSellerMatchFilters(464, "GISLENE LIMA", "gislene lima"), {
      externalSellerId: null,
      responsible: null,
      sellerIdentityKey: "gislene lima",
    });
    assert.deepEqual(crmCommercialSellerMatchFilters(464, "GISLENE LIMA"), {
      externalSellerId: null,
      responsible: null,
      sellerIdentityKey: "gislene lima",
    });
    assert.deepEqual(crmCommercialSellerMatchFilters(464, null), {
      externalSellerId: 464,
      responsible: null,
      sellerIdentityKey: null,
    });
  });

  it("salesOrderMatchesCrmSellerScope restringe pedidos no escopo own com identidade consolidada", () => {
    const ownScope = resolveCrmCommercialAccessScope(
      mockAuth({
        permissions: ["crm.seller.own"],
        externalSellerId: 464,
        sellerResponsibleName: "GISLENE LIMA",
      })
    );
    assert.equal(ownScope.sellerIdentityKey, "gislene lima");
    assert.equal(
      salesOrderMatchesCrmSellerScope({ externalSellerId: 464, responsible: "GISLENE LIMA" }, ownScope),
      true
    );
    assert.equal(
      salesOrderMatchesCrmSellerScope({ externalSellerId: 646, responsible: "GISLENE LIMA" }, ownScope),
      true
    );
    assert.equal(
      salesOrderMatchesCrmSellerScope({ externalSellerId: 1399, responsible: "RODRIGO" }, ownScope),
      false
    );
  });

  it("vendedor só com ID usa sellerIdentityKey enriquecido na sessão", () => {
    const ownScope = resolveCrmCommercialAccessScope(
      mockAuth({
        permissions: ["crm.seller.own"],
        externalSellerId: 464,
        sellerIdentityKey: "gislene lima",
      })
    );
    assert.equal(ownScope.sellerIdentityKey, "gislene lima");
    assert.equal(ownScope.externalSellerId, null);
    assert.equal(
      salesOrderMatchesCrmSellerScope({ externalSellerId: 645, responsible: "GISLENE LIMA" }, ownScope),
      true
    );
  });

  it("CrmModule só carrega gestão geral quando canCrmGeneral", () => {
    const src = readFileSync(join(process.cwd(), "src/components/CrmModule.tsx"), "utf8");
    assert.match(
      src,
      /activeCrmManagementTab === "general" && canCrmGeneral[\s\S]*loadManagementDashboard/
    );
    assert.match(src, /activeCrmManagementTab === "portfolio"/);
    assert.match(src, /canAccessCrmGeneral/);
    assert.doesNotMatch(src, /Indicadores da carteira/);
  });

  it("seller-dashboard exige resource tab + escopo comercial no server", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(
      server,
      /\/api\/crm\/seller-dashboard[\s\S]*?requireResource\("commercial\.crm\.seller", "view"\)/
    );
    assert.match(server, /requireCrmCommercialDataScope/);
    assert.match(server, /requireCrmCommercialGeneralScope/);
    assert.match(server, /resolveSellerDashboardScope/);
  });

  it("CrmSellerDashboardSection só mostra combo com showSellerFilter", () => {
    const section = readFileSync(
      join(process.cwd(), "src/components/CrmSellerDashboardSection.tsx"),
      "utf8"
    );
    assert.match(section, /showSellerFilter/);
    assert.match(section, /Todos os responsáveis \(visão geral\)/);
    assert.match(section, /ownScopeOnly/);
    assert.match(section, /Responsável da carteira/);
    assert.match(section, /Vendedor do pedido/);
  });
});
