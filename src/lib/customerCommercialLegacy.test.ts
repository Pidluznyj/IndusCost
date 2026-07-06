import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AppUserRole } from "@prisma/client";
import { hasAnyPermission } from "./appAuth.js";
import {
  LEGACY_MATERIAL_DEMAND_PERMISSION,
  MATERIAL_DEMAND_VIEW_PERMISSION,
  MATERIAL_DEMAND_VIEW_PERMISSIONS,
  canViewMaterialDemand,
} from "./commercialMaterialDemandPermissions.js";
import { computeCommercialPhase2FromSalesOrders } from "./customerCommercialSalesOrderView.js";
import { buildPortfolioAbcFromSalesOrders } from "./customerCommercialSalesOrderView.js";

const ROOT = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("customerCommercial legacy isolation", () => {
  it("nenhum endpoint ativo chama computeCommercialPhase2 legado", () => {
    const server = readSrc("server.ts");
    assert.equal(server.includes("computeCommercialPhase2("), false);
    assert.match(server, /computeCommercialPhase2FromSalesOrders|buildPortfolioAbcFromSalesOrders|salesOrder\.findMany/);
  });

  it("computeCommercialPhase2 legado está marcado deprecated e isolado", () => {
    const legacy = readSrc("src/lib/customerCommercialProposalLegacy.ts");
    assert.match(legacy, /@deprecated.*computeCommercialPhase2/s);
    assert.match(legacy, /proxy por proposta Aprovada/);
    const shim = readSrc("src/lib/customerCommercialIntel.ts");
    assert.match(shim, /@deprecated/);
    assert.match(shim, /customerCommercialProposalLegacy/);
  });

  it("motor SalesOrder continua funcionando com labels de Pedidos de Venda", () => {
    const orders = [
      {
        id: "so-1",
        orderCode: "PV-1",
        status: "SENT_TO_NOMUS" as const,
        issueDate: "2025-01-15T00:00:00.000Z",
        updatedAt: "2025-01-16T00:00:00.000Z",
        totalNetValue: 100000,
        totalMarginPerc: 15,
        responsible: "Ana",
        hasInvoicing: true,
      },
    ];
    const abc = buildPortfolioAbcFromSalesOrders(
      [{ customerId: "c1", revenue: 100000 }],
      "c1"
    );
    const intel = computeCommercialPhase2FromSalesOrders(orders, abc);
    assert.match(abc.basisLabel, /pedidos de venda/i);
    assert.match(intel.proxyNote, /Pedidos de Venda/i);
    assert.match(intel.repurchase.basis, /pedidos de venda/i);
  });

  it("Commercial 360 UI fala em Pedidos de Venda", () => {
    const modal = readSrc("src/components/customers/CustomerCommercial360.tsx");
    assert.equal(modal.includes("Aprovadas como proxy"), false);
    assert.equal(modal.includes("proxy por proposta"), false);
    assert.match(modal, /Histórico de pedidos de venda|Pedidos de Venda/i);
  });
});

describe("commercialMaterialDemandPermissions", () => {
  const checker = (permissions: string[]) => ({
    hasPermission: (p: string) => permissions.includes(p),
  });

  it("permissão legada proposals.material_report.view continua funcionando", () => {
    assert.ok(canViewMaterialDemand(checker([LEGACY_MATERIAL_DEMAND_PERMISSION])));
    assert.ok(
      hasAnyPermission(
        { role: AppUserRole.SELLER, permissions: [LEGACY_MATERIAL_DEMAND_PERMISSION] },
        [...MATERIAL_DEMAND_VIEW_PERMISSIONS]
      )
    );
  });

  it("nova permissão reports.material_demand.view também funciona", () => {
    assert.ok(canViewMaterialDemand(checker([MATERIAL_DEMAND_VIEW_PERMISSION])));
    assert.ok(
      hasAnyPermission(
        { role: AppUserRole.SELLER, permissions: [MATERIAL_DEMAND_VIEW_PERMISSION] },
        [...MATERIAL_DEMAND_VIEW_PERMISSIONS]
      )
    );
  });

  it("usuário sem permissão não acessa relatório de demanda", () => {
    assert.equal(canViewMaterialDemand(checker(["customers.view"])), false);
    assert.equal(
      hasAnyPermission({ role: AppUserRole.SELLER, permissions: ["customers.view"] }, [...MATERIAL_DEMAND_VIEW_PERMISSIONS]),
      false
    );
  });

  it("server.ts usa MATERIAL_DEMAND_VIEW_PERMISSIONS centralizado", () => {
    const server = readSrc("server.ts");
    const perms = readSrc("src/lib/commercialMaterialDemandPermissions.ts");
    assert.match(server, /MATERIAL_DEMAND_VIEW_PERMISSIONS/);
    assert.match(server, /commercialMaterialDemandPermissions/);
    assert.match(perms, /proposals\.material_report\.view/);
    assert.match(perms, /reports\.material_demand\.view/);
  });
});
