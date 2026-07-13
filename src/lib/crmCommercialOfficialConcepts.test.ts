import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CRM_OFFICIAL_ORDER_KPI_KEYS,
  CRM_OFFICIAL_UI_MESSAGES,
  CRM_PORTFOLIO_AXIS,
  SALES_ORDER_SELLER_AXIS,
} from "./crmCommercialOfficialConcepts.ts";

describe("crmCommercialOfficialConcepts", () => {
  it("separa eixo de carteira CRM do eixo Nomus de pedidos/comissões", () => {
    assert.equal(CRM_PORTFOLIO_AXIS, "commercial_owner");
    assert.equal(SALES_ORDER_SELLER_AXIS, "nomus_order_seller");
    assert.notEqual(CRM_PORTFOLIO_AXIS, SALES_ORDER_SELLER_AXIS);
  });

  it("expõe mensagens oficiais de divergência e ausência", () => {
    assert.match(CRM_OFFICIAL_UI_MESSAGES.customerWithoutCommercialOwner, /responsável comercial/i);
    assert.match(CRM_OFFICIAL_UI_MESSAGES.orderWithoutNomusSeller, /Nomus/i);
    assert.match(CRM_OFFICIAL_UI_MESSAGES.ownerDiffersFromOrderSeller, /diferente/i);
  });

  it("lista KPIs de pedido exigidos pela norma", () => {
    assert.ok(CRM_OFFICIAL_ORDER_KPI_KEYS.includes("ordersIssued"));
    assert.ok(CRM_OFFICIAL_ORDER_KPI_KEYS.includes("openPortfolioCount"));
    assert.ok(CRM_OFFICIAL_ORDER_KPI_KEYS.includes("topProduct"));
  });
});
