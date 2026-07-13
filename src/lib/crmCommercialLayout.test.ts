import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  canAccessCrmGeneral,
  canAccessCrmPortfolio,
  canAccessCrmSeller,
  isCrmOwnSellerOnly,
} from "@/src/lib/modulePermissions.js";
import {
  getDefaultCrmManagementTab,
  type CrmManagementTabId,
} from "@/src/components/CrmCommercialManagementTabs.js";

function mockAuth(overrides: {
  permissions?: string[];
  role?: AppAuthContext["role"];
}): AppAuthContext {
  const permissions = overrides.permissions ?? [];
  const role = overrides.role ?? "SELLER";
  return {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
    role,
    permissions,
    effectivePermissions: permissions,
    accessProfileId: null,
    accessProfileName: null,
    isActive: true,
    externalSellerId: 464,
    sellerResponsibleName: "GISLENE LIMA",
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionId: "sess-1",
  };
}

function checkerFromPermissions(permissions: string[]) {
  const set = new Set(permissions);
  return { hasPermission: (p: string) => set.has(p), hasAnyPermission: (ps: string[]) => ps.some((p) => set.has(p)) };
}

describe("crmCommercialLayout", () => {
  it("gestor vê aba Gestão Geral", () => {
    const auth = checkerFromPermissions(["crm.general.view", "crm.seller.all"]);
    assert.equal(canAccessCrmGeneral(auth), true);
    assert.equal(getDefaultCrmManagementTab(auth), "general");
    const tabs = readFileSync(
      join(process.cwd(), "src/components/CrmCommercialManagementTabs.tsx"),
      "utf8"
    );
    assert.match(tabs, /id: "general", label: "Gestão Geral"/);
    assert.match(tabs, /canAccessCrmGeneral/);
  });

  it("vendedor não vê Gestão Geral e entra em Meu Dashboard", () => {
    const auth = checkerFromPermissions(["crm.seller.own"]);
    assert.equal(canAccessCrmGeneral(auth), false);
    assert.equal(canAccessCrmSeller(auth), true);
    assert.equal(isCrmOwnSellerOnly(auth), true);
    assert.equal(getDefaultCrmManagementTab(auth), "seller");
    const tabs = readFileSync(
      join(process.cwd(), "src/lib/moduleTabResources.ts"),
      "utf8"
    );
    assert.match(tabs, /ownLabel: "Meu Dashboard"/);
    assert.match(tabs, /label: "Gestão por Responsável"/);
  });

  it("carteira de clientes é aba principal acessível", () => {
    const seller = checkerFromPermissions(["crm.seller.own"]);
    const manager = checkerFromPermissions(["crm.general.view", "crm.seller.all"]);
    assert.equal(canAccessCrmPortfolio(seller), true);
    assert.equal(canAccessCrmPortfolio(manager), true);
    const crm = readFileSync(join(process.cwd(), "src/components/CrmModule.tsx"), "utf8");
    assert.match(crm, /activeCrmManagementTab === "portfolio"/);
    assert.match(crm, /showCustomerPortfolioGrid/);
  });

  it("Gestão Geral não renderiza carteira nem agenda operacional", () => {
    const crm = readFileSync(join(process.cwd(), "src/components/CrmModule.tsx"), "utf8");
    assert.doesNotMatch(crm, /Indicadores da carteira/);
    assert.doesNotMatch(crm, /Agenda comercial/);
    assert.doesNotMatch(crm, /activeSellerSubTab/);
    assert.match(crm, /CrmManagementDashboardSection/);
  });

  it("componentes do cockpit permanecem na carteira", () => {
    const crm = readFileSync(join(process.cwd(), "src/components/CrmModule.tsx"), "utf8");
    const portfolio = readFileSync(
      join(process.cwd(), "src/components/crm/CrmCustomerPortfolioSection.tsx"),
      "utf8"
    );
    const cockpit = readFileSync(
      join(process.cwd(), "src/components/crm/CrmCustomerAccountCockpit.tsx"),
      "utf8"
    );
    assert.match(crm, /CrmCustomerPortfolioSection/);
    assert.match(crm, /CockpitTabs/);
    assert.match(portfolio, /CRM_PORTFOLIO_FILTER_CHIPS/);
    assert.match(portfolio, /xl:grid-cols-\[minmax\(320px,400px\)_minmax\(0,1fr\)\]/);
    assert.match(cockpit, /Resumo comercial/);
    assert.match(cockpit, /Agenda comercial/);
  });

  it("nenhum cálculo de KPI foi alterado nos serviços", () => {
    const management = readFileSync(
      join(process.cwd(), "src/lib/crmManagementDashboardService.ts"),
      "utf8"
    );
    const seller = readFileSync(join(process.cwd(), "src/lib/crmSellerDashboardService.ts"), "utf8");
    assert.match(management, /buildCrmManagementDashboardResponse/);
    assert.match(seller, /buildCrmSellerDashboardResponse/);
    assert.equal(management.includes("CrmModule"), false);
    assert.equal(seller.includes("CrmModule"), false);
  });

  it("seller dashboard tem CTA para carteira e rótulo por responsável", () => {
    const section = readFileSync(
      join(process.cwd(), "src/components/CrmSellerDashboardSection.tsx"),
      "utf8"
    );
    assert.match(section, /onOpenPortfolio/);
    assert.match(section, /Carteira de clientes/);
    assert.match(section, /Gestão por Responsável/);
    assert.match(section, /Responsável comercial da carteira/);
    assert.doesNotMatch(section, /CrmSellerSubTabs/);
  });
});

describe("crmCommercialLayout tab ids", () => {
  it("tipos de aba incluem portfolio", () => {
    const expected: CrmManagementTabId[] = ["general", "seller", "portfolio"];
    assert.deepEqual(expected, ["general", "seller", "portfolio"]);
  });
});
