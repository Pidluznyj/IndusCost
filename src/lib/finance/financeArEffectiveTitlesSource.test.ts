/**
 * Contrato — fonte canônica AR: Títulos e Fluxo de Caixa devem compartilhar o mesmo motor.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";
import { buildFinanceArTitlesPayload } from "@/src/lib/financeAccountsReceivableTitles.js";
import { filterCashFlowArRowsScoped } from "@/src/lib/financeCashFlowRowFilters.js";
import { toCashFlowPortfolioArFilters } from "@/src/lib/financeCashFlowDashboard.js";
import {
  resolveFinanceArCanonicalEffectiveTitles,
  resolveFinanceArCanonicalEffectiveTitlesAsCashFlowRows,
} from "./financeArEffectiveTitlesSource.js";

const REF = new Date(2026, 6, 17, 12, 0, 0, 0);

function nomusCr(
  partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">
): FinanceArDashboardRow {
  return {
    companyName: "KOPPETEL",
    personId: 88001,
    personName: "Britania Eletrodomesticos SA",
    personCnpj: "11222333000181",
    description: null,
    comments: null,
    dueDate: new Date(2026, 8, 10),
    competenceDate: new Date(2026, 6, 1),
    settlementDate: null,
    amountReceivable: 10000,
    amountReceived: 0,
    balanceReceivable: 10000,
    paymentMethodName: "Depósito Bancário",
    bankAccountName: "Bradesco",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "100",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: REF,
    ...partial,
  };
}

describe("financeArEffectiveTitlesSource", () => {
  it("resolveFinanceArCanonicalEffectiveTitlesAsCashFlowRows delega ao motor compartilhado", () => {
    const rows = [
      nomusCr({ externalId: 1, balanceReceivable: 500 }),
      nomusCr({ externalId: 2, balanceReceivable: 300 }),
    ];
    const filters = toCashFlowPortfolioArFilters({
      year: 2026,
      month: 9,
      viewMode: "projected",
      dateBase: "due",
      status: "open",
    });
    const canonical = resolveFinanceArCanonicalEffectiveTitles({
      rows,
      filters,
      referenceDate: REF,
    });
    const asCashFlow = resolveFinanceArCanonicalEffectiveTitlesAsCashFlowRows({
      rows,
      filters,
      referenceDate: REF,
    });
    assert.equal(canonical.length, asCashFlow.length);
    assert.deepEqual(
      canonical.map((i) => i.externalId).sort(),
      asCashFlow.map((r) => r.externalId).sort()
    );
  });

  it("Títulos e Fluxo de Caixa (setembro) compartilham externalIds quando FIN-08 ativo", () => {
    const rows = [
      nomusCr({
        externalId: 17874,
        sourceInvoiceId: 7311,
        sourceInvoiceNumber: "7311",
        description: "Documento 4461 - Parcela 1 de 1",
        amountReceivable: 158505,
        amountReceived: 1755,
        balanceReceivable: 156750,
        dueDate: new Date(2026, 8, 10),
      }),
      nomusCr({
        externalId: 18077,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        description: "Pedido PD 02719 - Parcela 1 de 3",
        amountReceivable: 158505,
        balanceReceivable: 158505,
        dueDate: new Date(2026, 8, 10),
      }),
      nomusCr({
        externalId: 18076,
        sourceInvoiceId: 7382,
        sourceInvoiceNumber: "7382",
        description: "Documento 4513 - Parcela 1 de 1",
        amountReceivable: 146974,
        balanceReceivable: 146974,
        dueDate: new Date(2026, 8, 20),
      }),
      nomusCr({
        externalId: 18079,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        description: "Pedido PD 02719 - Parcela 3 de 3",
        amountReceivable: 161111,
        balanceReceivable: 161111,
        dueDate: new Date(2026, 8, 25),
      }),
    ];

    const filters = {
      year: 2026,
      month: 9,
      viewMode: "projected" as const,
      dateBase: "due" as const,
      status: "open" as const,
    };
    const arFilters = toCashFlowPortfolioArFilters(filters);

    const titlesPayload = buildFinanceArTitlesPayload(
      rows,
      {
        page: 1,
        limit: 100,
        sortBy: "dueDate",
        sortDirection: "asc",
        filters: arFilters,
        extended: {},
        localFilter: "all",
      },
      REF,
      null,
      { orderContexts: [], nfeOrderLinks: [] }
    );

    const cashFlowRows = filterCashFlowArRowsScoped(
      rows as import("@/src/lib/financeCashFlowDashboard.js").FinanceCashFlowArRow[],
      filters,
      arFilters,
      REF,
      null,
      { orderContexts: [], nfeOrderLinks: [] }
    );

    const titleIds = new Set(titlesPayload.items.map((i) => i.externalId));
    const cfIds = new Set(cashFlowRows.map((r) => r.externalId));
    assert.equal(titleIds.size, cfIds.size);
    for (const id of titleIds) {
      assert.ok(cfIds.has(id), `FC deve incluir externalId ${id} presente em Títulos`);
    }
  });
});
