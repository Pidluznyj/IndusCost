import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CRM_OFFICIAL_SOURCE_NOTE,
  CRM_UI_TOOLTIPS,
  collectCrmSourceWarnings,
  crmPortfolioListEmptyCopy,
  formatCrmSourceInfoLine,
  resolveCrmPortfolioListEmptyKind,
  resolveCrmSellerEmptyKind,
} from "@/src/components/crm/crmCommercialUiConcepts.js";

describe("crmCommercialUiConcepts", () => {
  it("tooltips separam responsável comercial e vendedor do pedido", () => {
    assert.match(CRM_UI_TOOLTIPS.commercialOwner, /relacionamento e follow-up/);
    assert.match(CRM_UI_TOOLTIPS.orderSeller, /comissionamento/);
    assert.match(CRM_UI_TOOLTIPS.orderValue, /fonte oficial/);
    assert.match(CRM_OFFICIAL_SOURCE_NOTE, /vendedor comissionável/);
  });

  it("formata sourceInfo e coleta warnings", () => {
    const line = formatCrmSourceInfoLine({
      pedidosFonte: "SalesOrder",
      eixo: "RESPONSAVEL_COMERCIAL_CLIENTE",
      comissionamentoAfetado: false,
      propostasUsadas: false,
    });
    assert.ok(line);
    assert.match(line!, /SalesOrder/);
    assert.match(line!, /Comissão não afetada/);
    assert.deepEqual(
      collectCrmSourceWarnings({ warning: "Atenção", warnings: ["Atenção", "Outro"] }),
      ["Atenção", "Outro"]
    );
  });

  it("empty states da carteira diferenciam responsável, filtros, erro e não carregado", () => {
    assert.equal(
      resolveCrmPortfolioListEmptyKind({
        loading: false,
        error: null,
        customerCount: 0,
        sellerFilterActive: true,
        hasOtherFilters: false,
        hasSourceInfo: true,
      }),
      "no_customers_for_owner"
    );
    assert.equal(
      resolveCrmPortfolioListEmptyKind({
        loading: false,
        error: null,
        customerCount: 0,
        sellerFilterActive: false,
        hasOtherFilters: false,
        hasSourceInfo: false,
      }),
      "not_loaded"
    );
    assert.match(
      crmPortfolioListEmptyCopy("no_match_filters").body,
      /responsável com os filtros aplicados/
    );
  });

  it("empty states do responsável diferenciam carteira sem clientes e sem pedidos", () => {
    assert.equal(
      resolveCrmSellerEmptyKind({
        sellerNotLinked: false,
        loading: false,
        error: null,
        hasData: true,
        emptyStateReason: "NO_CUSTOMERS_FOR_COMMERCIAL_OWNER",
      }),
      "no_customers_for_owner"
    );
    assert.equal(
      resolveCrmSellerEmptyKind({
        sellerNotLinked: false,
        loading: false,
        error: null,
        hasData: true,
        customerCount: 3,
        totalOrders: 0,
      }),
      "no_orders_in_period"
    );
  });
});
