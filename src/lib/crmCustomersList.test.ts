import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { CrmCommercialAccessScope } from "@/src/lib/crmCommercialAccessScope.js";
import {
  aggregateCustomerActivities,
  buildCrmCustomerListFilterWhere,
  buildCrmCustomerListScopeWhere,
  enrichCustomersFromSalesOrders,
  parseCrmCustomerListFilter,
  parseCrmCustomerListSellerQuery,
} from "@/src/lib/crmCustomersList.js";
import { CRM_CUSTOMER_LIST_FILTERS } from "@/src/lib/crmCustomersListTypes.js";
import {
  CRM_PORTFOLIO_FILTER_CHIPS,
  computePortfolioEmptySummary,
} from "@/src/components/crm/crmCustomerPortfolioUi.js";

const NOW = new Date("2026-06-17T12:00:00.000Z");

function ownScope(): CrmCommercialAccessScope {
  return {
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
}

function globalScope(): CrmCommercialAccessScope {
  return {
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
}

describe("crmCustomersList scope", () => {
  it("vendedor (own) aplica filtro de carteira do vendedor", () => {
    const where = buildCrmCustomerListScopeWhere(ownScope(), {
      externalSellerId: null,
      sellerIdentityKey: null,
    });
    assert.ok(where);
    assert.ok(where!.salesOrders);
    assert.equal("some" in (where!.salesOrders as object), true);
  });

  it("gestor sem filtro de vendedor não restringe por vendedor", () => {
    const where = buildCrmCustomerListScopeWhere(globalScope(), {
      externalSellerId: null,
      sellerIdentityKey: null,
    });
    assert.equal(where, undefined);
  });

  it("gestor com filtro de vendedor restringe por SalesOrder", () => {
    const where = buildCrmCustomerListScopeWhere(globalScope(), {
      externalSellerId: 99,
      sellerIdentityKey: null,
    });
    assert.ok(where);
    assert.ok(where!.salesOrders);
  });

  it("parseCrmCustomerListSellerQuery normaliza sellerIdentityKey", () => {
    const q = parseCrmCustomerListSellerQuery("12", "  GISLENE LIMA  ");
    assert.equal(q.externalSellerId, 12);
    assert.equal(q.sellerIdentityKey, "gislene lima");
  });
});

describe("crmCustomersList filters", () => {
  it("parseCrmCustomerListFilter aceita filtros da carteira", () => {
    for (const f of CRM_CUSTOMER_LIST_FILTERS) {
      assert.equal(parseCrmCustomerListFilter(f), f);
    }
    assert.equal(parseCrmCustomerListFilter("invalid"), "all");
  });

  it("filtro withoutContact30 exclui contatos recentes", () => {
    const where = buildCrmCustomerListFilterWhere("withoutContact30", NOW);
    assert.ok(where);
    assert.ok(where!.NOT);
  });

  it("filtro withPurchaseHistory exige pedidos válidos", () => {
    const where = buildCrmCustomerListFilterWhere("withPurchaseHistory", NOW);
    assert.deepEqual(where, {
      salesOrders: { some: { status: { notIn: ["CANCELLED", "ERROR"] } } },
    });
  });

  it("chips da UI cobrem filtros obrigatórios", () => {
    const values = CRM_PORTFOLIO_FILTER_CHIPS.map((c) => c.value);
    assert.ok(values.includes("withPurchaseHistory"));
    assert.ok(values.includes("withOpenPortfolio"));
    assert.ok(values.includes("overdueFollowUp"));
  });
});

describe("crmCustomersList enrichment", () => {
  it("aggregateCustomerActivities calcula último contato e follow-up atrasado", () => {
    const map = aggregateCustomerActivities(
      [
        {
          customerId: "c1",
          contactDate: new Date("2026-05-01T10:00:00.000Z"),
          createdAt: new Date("2026-05-01T10:00:00.000Z"),
          nextActionAt: new Date("2026-06-01T10:00:00.000Z"),
          status: "OPEN",
        },
      ],
      NOW
    );
    const agg = map.get("c1");
    assert.ok(agg);
    assert.equal(agg!.contactCount, 1);
    assert.equal(agg!.hasOverdueFollowUp, true);
  });

  it("enrichCustomersFromSalesOrders marca carteira aberta sem NF processada", () => {
    const map = enrichCustomersFromSalesOrders([
      {
        customerId: "c1",
        responsible: "Vendedor A",
        externalSellerId: 10,
        status: "SENT",
        issueDate: new Date("2026-06-01"),
        nomusRawResponse: { nfes: [] },
      },
    ]);
    const row = map.get("c1");
    assert.ok(row);
    assert.equal(row!.hasOpenPortfolio, true);
    assert.equal(row!.hasPurchaseHistory, true);
    assert.equal(row!.primarySellerResponsible, "Vendedor A");
  });
});

describe("crmCustomersList UI integration", () => {
  it("estado vazio resume carteira listada", () => {
    const summary = computePortfolioEmptySummary([
      {
        id: "1",
        displayName: "A",
        tradeName: null,
        taxId: "1",
        email: null,
        phone: null,
        city: null,
        state: null,
        address: null,
        lastContactAt: null,
        nextFollowUpAt: null,
        contactCount: 0,
        primarySellerResponsible: null,
        primaryExternalSellerId: null,
        hasPurchaseHistory: true,
        hasOpenPortfolio: true,
        hasOverdueFollowUp: false,
      },
    ]);
    assert.equal(summary.totalListed, 1);
    assert.equal(summary.withOpenPortfolio, 1);
    assert.equal(summary.withoutContact, 1);
  });

  it("CrmModule usa cockpit e filtro de vendedor na carteira", () => {
    const crm = readFileSync(join(process.cwd(), "src/components/CrmModule.tsx"), "utf8");
    const portfolio = readFileSync(
      join(process.cwd(), "src/components/crm/CrmCustomerPortfolioSection.tsx"),
      "utf8"
    );
    assert.match(crm, /CrmCustomerPortfolioSection/);
    assert.match(portfolio, /CrmCustomerAccountCockpit/);
    assert.match(crm, /portfolioSellerKey/);
    assert.match(crm, /sellerIdentityKey/);
    assert.match(crm, /showCustomerPortfolioGrid/);
  });

  it("endpoints de detalhe validam escopo do cliente", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(server, /isCustomerInCrmCommercialScope/);
  });

  it("endpoint lista clientes delega fetchCrmCustomersList com escopo", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const block = server.slice(
      server.indexOf('app.get("/api/crm/customers"'),
      server.indexOf('app.get("/api/crm/customers/:customerId/profile"')
    );
    assert.match(block, /fetchCrmCustomersList/);
    assert.match(block, /requireCrmCommercialDataScope/);
    assert.match(block, /parseCrmCustomerListSellerQuery/);
  });
});
