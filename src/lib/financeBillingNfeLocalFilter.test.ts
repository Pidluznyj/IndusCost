import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { NomusNfeBillingClassification } from "@prisma/client";
import {
  filterBillingNfeRowsByLocalFilter,
  isBillingNfeIncludedInDashboard,
} from "./financeBillingNfeLocalFilter.js";
import type { FinanceBillingNfeListItem } from "./financeBillingNfeList.js";
import { NOMUS_NFE_STATUS_AUTHORIZED, NOMUS_NFE_STATUS_CANCELLED } from "./nomusNfeClassification.js";

function row(partial: Partial<FinanceBillingNfeListItem> & Pick<FinanceBillingNfeListItem, "id">): FinanceBillingNfeListItem {
  return {
    externalId: 1,
    numero: "100",
    serie: "1",
    status: NOMUS_NFE_STATUS_AUTHORIZED,
    billingClassification: NomusNfeBillingClassification.MARKET_REVENUE,
    xmlDestCnpjCpf: "123",
    xmlNatOp: "Venda",
    fiscalDate: new Date(2026, 5, 10).toISOString(),
    dataProcessamento: null,
    valorLiquido: 1000,
    isMarketSale: true,
    syncedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("financeBillingNfeLocalFilter", () => {
  const rows = [
    row({ id: "1" }),
    row({
      id: "2",
      status: NOMUS_NFE_STATUS_CANCELLED,
      billingClassification: null,
      isMarketSale: false,
    }),
    row({
      id: "3",
      billingClassification: NomusNfeBillingClassification.INTERCOMPANY,
      isMarketSale: false,
    }),
    row({
      id: "4",
      fiscalDate: new Date(2026, 4, 15).toISOString(),
    }),
  ];

  it("Todas retorna conjunto completo", () => {
    assert.equal(filterBillingNfeRowsByLocalFilter(rows, "all").length, 4);
  });

  it("Autorizadas filtra status autorizado", () => {
    assert.equal(filterBillingNfeRowsByLocalFilter(rows, "authorized").length, 3);
  });

  it("Canceladas filtra status cancelado", () => {
    const cancelled = filterBillingNfeRowsByLocalFilter(rows, "cancelled");
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0]!.id, "2");
  });

  it("Incluídas filtra regra do dashboard NF-e", () => {
    const included = filterBillingNfeRowsByLocalFilter(rows, "included");
    assert.equal(included.length, 2);
    assert.ok(included.every(isBillingNfeIncludedInDashboard));
  });

  it("Excluídas filtra fora da regra fiscal", () => {
    assert.equal(filterBillingNfeRowsByLocalFilter(rows, "excluded").length, 2);
  });

  it("Fora do período respeita mês aplicado", () => {
    const out = filterBillingNfeRowsByLocalFilter(rows, "outOfPeriod", { year: 2026, month: 6 });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.id, "4");
  });

  it("Grupo interno filtra INTERCOMPANY", () => {
    const internal = filterBillingNfeRowsByLocalFilter(rows, "internalGroup");
    assert.equal(internal.length, 1);
    assert.equal(internal[0]!.id, "3");
  });

  it("UI NF-e possui filtros locais sem alterar globais", () => {
    const table = readFileSync(
      join(process.cwd(), "src", "components", "finance", "billing", "FinanceBillingNfeDetailsTable.tsx"),
      "utf8"
    );
    assert.match(table, /FINANCE_BILLING_NFE_LOCAL_FILTER_OPTIONS/);
    assert.match(table, /localFilter/);
    assert.match(table, /Filtros locais/);
  });

  it("página billing usa design executivo e abas inferiores", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceBillingPage.tsx"),
      "utf8"
    );
    assert.match(page, /FinanceDetailTabs/);
    assert.match(page, /FINANCE_BILLING_EXECUTIVE_TABS/);
    assert.match(page, /FinanceBillingActionCenter/);
    assert.match(page, /title="Faturamento"/);
    assert.match(page, /FINANCE_BILLING_SOURCE_DEFAULT/);
    assert.match(page, /SalesOrder aparece apenas/);
  });
});
