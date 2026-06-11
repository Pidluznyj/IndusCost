import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceBillingDashboardQuery,
  financeBillingSourceChip,
  FINANCE_BILLING_SOURCE_DEFAULT,
  parseFinanceBillingDateBase,
  parseFinanceBillingSource,
} from "./financeBillingSourceTypes.js";

describe("financeBillingSourceTypes", () => {
  it("billingSource padrão é nfe", () => {
    assert.equal(FINANCE_BILLING_SOURCE_DEFAULT, "nfe");
    assert.equal(parseFinanceBillingSource(undefined), "nfe");
    assert.equal(parseFinanceBillingSource("sales_order"), "sales_order");
    assert.equal(parseFinanceBillingSource("pedido"), "sales_order");
  });

  it("dateBase padrão é emissao", () => {
    assert.equal(parseFinanceBillingDateBase(undefined), "emissao");
    assert.equal(parseFinanceBillingDateBase("processamento"), "processamento");
  });

  it("query do dashboard inclui billingSource=nfe por padrão", () => {
    const qs = buildFinanceBillingDashboardQuery("2026");
    assert.match(qs, /year=2026/);
    assert.match(qs, /billingSource=nfe/);
  });

  it("chip descreve regra fiscal NF-e", () => {
    assert.match(financeBillingSourceChip("nfe"), /NF-e fiscal/);
    assert.match(financeBillingSourceChip("nfe"), /Autorizada/);
    assert.match(financeBillingSourceChip("sales_order"), /SalesOrder/);
  });

  it("FinanceBillingPage expõe seletor de fonte", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceBillingPage.tsx"),
      "utf8"
    );
    assert.match(page, /Fiscal NF-e/);
    assert.match(page, /Pedidos de venda/);
    assert.match(page, /FinanceBillingSourceBadge/);
    assert.match(page, /billingSource/);
  });

  it("motor roteia billingSource nfe para buildBillingDashboardFromNfes", () => {
    const service = readFileSync(
      join(process.cwd(), "src", "lib", "financeBillingDashboard.ts"),
      "utf8"
    );
    assert.match(service, /buildBillingDashboardFromNfes/);
    assert.match(service, /billingSource === "nfe"/);
  });
});
