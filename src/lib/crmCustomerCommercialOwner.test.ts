import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  consolidateSellerRowFragments,
} from "@/src/lib/crmSellerIdentityConsolidation.js";
import {
  adminSellerOptionToActiveCommercialSeller,
  buildManualCommercialOwnerPortfolioWhere,
  canAssignCustomerCommercialOwner,
  formatCommercialOwnerLabel,
  manualCommercialOwnerMatchesSellerScope,
  resolveCustomerCommercialOwner,
} from "@/src/lib/crmCustomerCommercialOwner.js";
import { buildCrmSellerCustomerPortfolioWhere } from "@/src/lib/crmCustomerSellerScope.js";
import { buildCrmCustomerListScopeWhere } from "@/src/lib/crmCustomersList.js";
import type { CrmCommercialAccessScope } from "@/src/lib/crmCommercialAccessScope.js";
import { consolidateAdminSellerMetricsRows } from "@/src/lib/adminSellerOptions.js";
import { CRM_CUSTOMER_COMMERCIAL_OWNER_ASSIGN_PERMISSION } from "@/src/lib/crmCustomerCommercialOwner.js";
import { ALL_PERMISSION_KEYS } from "@/src/lib/permissionCatalog.js";

function gestorAuth() {
  return {
    role: "COMMERCIAL_MANAGER" as const,
    permissions: [CRM_CUSTOMER_COMMERCIAL_OWNER_ASSIGN_PERMISSION],
    effectivePermissions: [CRM_CUSTOMER_COMMERCIAL_OWNER_ASSIGN_PERMISSION],
  };
}

function sellerAuth() {
  return {
    role: "SELLER" as const,
    permissions: ["crm.seller.own"],
    effectivePermissions: ["crm.seller.own"],
  };
}

function viewerAuth() {
  return {
    role: "VIEWER" as const,
    permissions: ["customers.view"],
    effectivePermissions: ["customers.view"],
  };
}

describe("crmCustomerCommercialOwner", () => {
  it("aba Responsável Comercial existe no cadastro de cliente", () => {
    const mod = readFileSync(join(process.cwd(), "src/components/CustomerModule.tsx"), "utf8");
    const tab = readFileSync(
      join(process.cwd(), "src/components/customers/CustomerCommercialOwnerTab.tsx"),
      "utf8"
    );
    assert.match(mod, /Responsável Comercial/);
    assert.match(mod, /CustomerCommercialOwnerTab/);
    assert.match(tab, /Responsável comercial/);
    assert.match(tab, /Histórico de alterações/);
  });

  it("permissão crm.customers.assign_seller está no catálogo", () => {
    assert.ok(ALL_PERMISSION_KEYS.includes("crm.customers.assign_seller"));
    const templates = readFileSync(join(process.cwd(), "src/lib/permissionCatalogUtils.ts"), "utf8");
    assert.match(templates, /crm\.customers\.assign_seller/);
  });

  it("Gestor comercial pode alterar responsável", () => {
    assert.equal(canAssignCustomerCommercialOwner(gestorAuth()), true);
  });

  it("ADMIN e SUPER_ADMIN podem alterar responsável", () => {
    assert.equal(
      canAssignCustomerCommercialOwner({ role: "ADMIN", permissions: [], effectivePermissions: [] }),
      true
    );
    assert.equal(
      canAssignCustomerCommercialOwner({
        role: "SUPER_ADMIN",
        permissions: [],
        effectivePermissions: [],
      }),
      true
    );
  });

  it("vendedor comum e visualizador não podem alterar", () => {
    assert.equal(canAssignCustomerCommercialOwner(sellerAuth()), false);
    assert.equal(canAssignCustomerCommercialOwner(viewerAuth()), false);
  });

  it("backend valida permissão no PATCH (service + rota)", () => {
    const service = readFileSync(
      join(process.cwd(), "src/lib/crmCustomerCommercialOwner.ts"),
      "utf8"
    );
    const routes = readFileSync(
      join(process.cwd(), "src/lib/crmCustomerCommercialOwnerRoutes.ts"),
      "utf8"
    );
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(service, /status: 403/);
    assert.match(service, /canAssignCustomerCommercialOwner/);
    assert.match(routes, /patchCustomerCommercialOwner/);
    assert.match(server, /registerCrmCustomerCommercialOwnerRoutes/);
    assert.match(routes, /commercial-owner/);
  });

  it("Gislene aparece uma única vez consolidando IDs 464, 646 e 645", () => {
    const consolidated = consolidateAdminSellerMetricsRows([
      {
        external_seller_id: 464,
        responsible: "GISLENE LIMA",
        orders_count: 100,
        orders_value: 0,
        proposals_count: 0,
        proposals_value: 0,
      },
      {
        external_seller_id: 646,
        responsible: "GISLENE LIMA",
        orders_count: 80,
        orders_value: 0,
        proposals_count: 0,
        proposals_value: 0,
      },
      {
        external_seller_id: 645,
        responsible: "GISLENE LIMA",
        orders_count: 20,
        orders_value: 0,
        proposals_count: 0,
        proposals_value: 0,
      },
    ]);
    assert.equal(consolidated.length, 1);
    const active = adminSellerOptionToActiveCommercialSeller(consolidated[0]!);
    assert.equal(active.canonicalName, "GISLENE LIMA");
    assert.deepEqual(active.aliasExternalSellerIds, [464, 645, 646]);
    assert.match(active.sublabel, /Alta confiança/);
    assert.match(active.sublabel, /464, 645, 646/);
  });

  it("Rodrigo duplicado é consolidado quando o nome normalizado é igual", () => {
    const options = consolidateSellerRowFragments([
      { external_seller_id: 1399, responsible: "Rodrigo Da Silva Ramos", orders_count: 10 },
      { external_seller_id: 646, responsible: "Rodrigo Da Silva Ramos", orders_count: 4 },
    ]);
    assert.equal(options.length, 1);
    assert.deepEqual(options[0]!.externalSellerIds, [646, 1399]);
  });

  it("nomes apenas parecidos não são consolidados", () => {
    const options = consolidateSellerRowFragments([
      { external_seller_id: 100, responsible: "Ana Souza", orders_count: 3 },
      { external_seller_id: 200, responsible: "Ana Souza Costa", orders_count: 2 },
    ]);
    assert.equal(options.length, 2);
  });

  it("responsável manual tem prioridade sobre inferido do Nomus", () => {
    const manual = {
      source: "MANUAL" as const,
      sellerCanonicalName: "GISLENE LIMA",
      sellerResponsibleName: "GISLENE LIMA",
      sellerExternalId: 464,
      sellerIdentityKey: "gislene lima",
      sellerAliasExternalIds: [464, 645, 646],
      confidence: "HIGH" as const,
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedByName: "Gestor",
    };
    const inferred = {
      source: "NOMUS_INFERRED" as const,
      sellerCanonicalName: "OUTRO VENDEDOR",
      sellerResponsibleName: "OUTRO VENDEDOR",
      sellerExternalId: 99,
      sellerIdentityKey: "outro vendedor",
      sellerAliasExternalIds: [99],
      confidence: "HIGH" as const,
      updatedAt: null,
      updatedByName: null,
    };
    const resolved = resolveCustomerCommercialOwner(manual, inferred);
    assert.equal(resolved.sellerCanonicalName, "GISLENE LIMA");
    assert.equal(resolved.source, "MANUAL");
  });

  it("sem manual usa responsável inferido do Nomus", () => {
    const inferred = {
      source: "NOMUS_INFERRED" as const,
      sellerCanonicalName: "Maria",
      sellerResponsibleName: "Maria",
      sellerExternalId: 10,
      sellerIdentityKey: "maria",
      sellerAliasExternalIds: [10],
      confidence: "HIGH" as const,
      updatedAt: null,
      updatedByName: null,
    };
    const resolved = resolveCustomerCommercialOwner(null, inferred);
    assert.equal(resolved.source, "NOMUS_INFERRED");
    assert.equal(resolved.sellerCanonicalName, "Maria");
  });

  it("cliente com responsável manual entra na carteira do vendedor (scope OR)", () => {
    const scope: CrmCommercialAccessScope = {
      dataScope: "own",
      externalSellerId: 464,
      responsible: "GISLENE LIMA",
      sellerIdentityKey: "gislene lima",
      canViewCommercialGeneral: false,
      canViewAllSellers: false,
      canViewOwnSellerData: true,
      sellerLocked: true,
      sellerLinked: true,
      blockedReason: null,
      blockedMessage: null,
    };
    const where = buildCrmSellerCustomerPortfolioWhere(scope);
    assert.ok(where?.OR);
    assert.equal(Array.isArray(where!.OR), true);
    const manualWhere = buildManualCommercialOwnerPortfolioWhere(scope);
    assert.ok(manualWhere);
    assert.equal(manualWhere!.sellerIdentityKey, "gislene lima");
  });

  it("gestor filtrando por responsável comercial usa só CrmCustomerCommercialOwner", () => {
    const global: CrmCommercialAccessScope = {
      dataScope: "global",
      externalSellerId: null,
      responsible: null,
      sellerIdentityKey: null,
      canViewCommercialGeneral: true,
      canViewAllSellers: true,
      canViewOwnSellerData: true,
      sellerLocked: false,
      sellerLinked: true,
      blockedReason: null,
      blockedMessage: null,
    };
    const where = buildCrmCustomerListScopeWhere(global, {
      externalSellerId: null,
      sellerIdentityKey: "gislene lima",
    });
    assert.ok(where?.CrmCustomerCommercialOwner);
    assert.equal(where?.OR, undefined);
    assert.equal(where?.salesOrders, undefined);
  });

  it("manual owner match por identidade consolidada", () => {
    assert.equal(
      manualCommercialOwnerMatchesSellerScope(
        {
          sellerIdentityKey: "gislene lima",
          sellerExternalId: 464,
          sellerAliasExternalIds: [464, 645, 646],
        },
        { externalSellerId: 645, responsible: null, sellerIdentityKey: "gislene lima" }
      ),
      true
    );
    assert.equal(
      manualCommercialOwnerMatchesSellerScope(
        {
          sellerIdentityKey: "gislene lima",
          sellerExternalId: 464,
          sellerAliasExternalIds: [464, 645, 646],
        },
        { externalSellerId: 999, responsible: null, sellerIdentityKey: "outro" }
      ),
      false
    );
  });

  it("auditoria usa CommercialAuditLog padrão", () => {
    const service = readFileSync(
      join(process.cwd(), "src/lib/crmCustomerCommercialOwner.ts"),
      "utf8"
    );
    assert.match(service, /writeCommercialAuditLog/);
    assert.match(service, /CrmCustomerCommercialOwner/);
  });

  it("não altera SalesOrder nem sync Nomus", () => {
    const service = readFileSync(
      join(process.cwd(), "src/lib/crmCustomerCommercialOwner.ts"),
      "utf8"
    );
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    assert.doesNotMatch(service, /salesOrder\.update/i);
    assert.doesNotMatch(service, /nomusSync/i);
    assert.match(schema, /CrmCustomerCommercialOwner/);
    assert.doesNotMatch(service, /customer\.update\([\s\S]*accountOwner/s);
  });

  it("frontend não importa Prisma", () => {
    const tab = readFileSync(
      join(process.cwd(), "src/components/customers/CustomerCommercialOwnerTab.tsx"),
      "utf8"
    );
    const mod = readFileSync(join(process.cwd(), "src/components/CustomerModule.tsx"), "utf8");
    assert.doesNotMatch(tab, /@prisma|prisma/);
    assert.doesNotMatch(mod, /@prisma|prisma/);
  });

  it("sem hardcode Gislene no código da feature", () => {
    const tab = readFileSync(
      join(process.cwd(), "src/components/customers/CustomerCommercialOwnerTab.tsx"),
      "utf8"
    );
    const service = readFileSync(
      join(process.cwd(), "src/lib/crmCustomerCommercialOwner.ts"),
      "utf8"
    );
    assert.doesNotMatch(tab, /GISLENE|464|646|645/);
    assert.doesNotMatch(service, /GISLENE|464|646|645/);
  });

  it("formatCommercialOwnerLabel inclui IDs consolidados", () => {
    const label = formatCommercialOwnerLabel({
      source: "MANUAL",
      sellerCanonicalName: "GISLENE LIMA",
      sellerResponsibleName: "GISLENE LIMA",
      sellerExternalId: 464,
      sellerIdentityKey: "gislene lima",
      sellerAliasExternalIds: [464, 645, 646],
      confidence: "HIGH",
      updatedAt: null,
      updatedByName: null,
    });
    assert.match(label, /GISLENE LIMA/);
    assert.match(label, /464, 645, 646/);
  });
});
