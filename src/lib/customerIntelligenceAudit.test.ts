import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CUSTOMER_INTELLIGENCE_AUDIT_MAP,
  businessRules,
  currentDataSources,
  currentModalFiles,
  missingData,
  proposedEndpoint,
  proposedRoutes,
  proposedTabs,
  reusableFunctions,
  risks,
} from "./customerIntelligenceAudit.js";

describe("customerIntelligenceAudit — mapa de arquitetura Etapa 1", () => {
  it("mapa de arquitetura existe e está na etapa 1", () => {
    assert.ok(CUSTOMER_INTELLIGENCE_AUDIT_MAP);
    assert.equal(CUSTOMER_INTELLIGENCE_AUDIT_MAP.stage, "etapa_1_auditoria");
    assert.equal(CUSTOMER_INTELLIGENCE_AUDIT_MAP.screenName, "Inteligência do Cliente");
    assert.equal(CUSTOMER_INTELLIGENCE_AUDIT_MAP.screenAlias, "Central 360º do Cliente");
  });

  it("lista as fontes atuais do popup/modal", () => {
    assert.ok(currentModalFiles.length >= 3);
    const paths = currentModalFiles.map((f) => f.path);
    assert.ok(paths.includes("src/components/customers/CustomerCommercial360.tsx"));
    assert.ok(paths.includes("src/components/CustomerModule.tsx"));
    assert.ok(
      currentModalFiles.some((f) => f.role.includes("commercial-360") || f.path === "server.ts")
    );

    const modalSources = currentDataSources.filter((s) => s.usedBy === "modal" || s.usedBy === "both");
    assert.ok(modalSources.some((s) => s.id === "sales_order"));
    assert.ok(modalSources.some((s) => s.id === "customer"));
    assert.equal(CUSTOMER_INTELLIGENCE_AUDIT_MAP.currentModalEndpoint, "GET /api/customers/:id/commercial-360");
  });

  it("define rota frontend proposta (CRM primária + alternativa compatível)", () => {
    assert.ok(proposedRoutes.length >= 2);
    const primary = proposedRoutes.find((r) => r.preferred);
    assert.ok(primary);
    assert.match(primary!.path, /\/crm\/customers\/:customerId\/intelligence/);

    const compat = proposedRoutes.find((r) => !r.preferred);
    assert.ok(compat);
    assert.match(compat!.path, /\/customers\/:customerId\/intelligence/);
  });

  it("define endpoint backend proposto", () => {
    assert.equal(proposedEndpoint.method, "GET");
    assert.equal(proposedEndpoint.path, "/api/crm/customers/:customerId/intelligence");
    assert.ok(proposedEndpoint.composesExisting.length >= 2);
    assert.ok(
      proposedEndpoint.composesExisting.some((e) => e.includes("commercial-360"))
    );
  });

  it("documenta que SalesOrder é a fonte comercial principal", () => {
    assert.equal(CUSTOMER_INTELLIGENCE_AUDIT_MAP.commercialPrimarySource, "SalesOrder");
    assert.equal(CUSTOMER_INTELLIGENCE_AUDIT_MAP.proposalRole, "auxiliary_pre_sales_only");

    const rule = businessRules.find((r) => r.id === "sales_order_primary");
    assert.ok(rule);
    assert.equal(rule!.modalCompliant, true);

    const notProposal = businessRules.find((r) => r.id === "proposal_not_revenue");
    assert.ok(notProposal);
    assert.equal(notProposal!.modalCompliant, true);

    assert.ok(
      reusableFunctions.some(
        (f) => f.exportName === "isCommercialMetricsSalesOrder" && f.usedByModal
      )
    );
  });

  it("documenta que AR canônico é a fonte financeira", () => {
    assert.equal(
      CUSTOMER_INTELLIGENCE_AUDIT_MAP.financialPrimarySource,
      "NomusAccountsReceivable (AR canônico gerencial)"
    );

    const arSource = currentDataSources.find((s) => s.id === "ar_canonical");
    assert.ok(arSource);
    assert.match(arSource!.origin, /financeAccountsReceivableManagement/);

    const arRule = businessRules.find((r) => r.id === "ar_canonical");
    assert.ok(arRule);
  });

  it("documenta que popup será mantido como resumo rápido", () => {
    assert.equal(CUSTOMER_INTELLIGENCE_AUDIT_MAP.keepModalAsQuickSummary, true);
    assert.equal(CUSTOMER_INTELLIGENCE_AUDIT_MAP.currentModalTitle, "Visão comercial do cliente");

    const rule = businessRules.find((r) => r.id === "keep_modal_summary");
    assert.ok(rule);
    assert.equal(rule!.modalCompliant, true);
  });

  it("documenta que a tela completa terá abas", () => {
    assert.equal(CUSTOMER_INTELLIGENCE_AUDIT_MAP.fullScreenHasTabs, true);
    assert.ok(proposedTabs.length >= 4);

    const tabIds = proposedTabs.map((t) => t.id);
    assert.ok(tabIds.includes("commercial"));
    assert.ok(tabIds.includes("financial"));
    assert.ok(tabIds.includes("crm"));

    const tabsRule = businessRules.find((r) => r.id === "full_screen_tabs");
    assert.ok(tabsRule);
  });

  it("identifica funções reutilizáveis e lacunas conhecidas", () => {
    assert.ok(reusableFunctions.length >= 5);
    assert.ok(
      reusableFunctions.some((f) => f.exportName === "computeCommercialPhase2FromSalesOrders")
    );
    assert.ok(missingData.length >= 3);
    assert.ok(risks.length >= 2);
  });
});
