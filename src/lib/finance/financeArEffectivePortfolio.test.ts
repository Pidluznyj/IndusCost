/**
 * Paridade CR Títulos × Fluxo de Caixa — motor compartilhado.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";
import { buildFinanceArTitlesPayload } from "@/src/lib/financeAccountsReceivableTitles.js";
import { buildFinanceCashFlowEffectiveArPortfolio } from "./financeCashFlowEffectiveAr.js";
import { buildFinanceArEffectivePortfolioItems } from "./financeArEffectivePortfolio.js";
import type { FinanceArNfeOrderLink } from "./financeArOperationalPortfolio.js";

const REF = new Date(2026, 6, 17, 12, 0, 0, 0);
const CUSTOMER_ID = 88001;

function nomusCr(
  partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">
): FinanceArDashboardRow {
  return {
    companyName: "KOPPETEL",
    personId: CUSTOMER_ID,
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

function pd02719DocumentoRows(): FinanceArDashboardRow[] {
  return [
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
      externalId: 18078,
      sourceInvoiceId: null,
      sourceInvoiceNumber: null,
      description: "Pedido PD 02719 - Parcela 2 de 3",
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
      dueDate: new Date(2026, 8, 30),
    }),
  ];
}

const PD02719_NFE_LINKS: FinanceArNfeOrderLink[] = [
  { sourceInvoiceId: 7311, orderCode: "PD 02719", salesOrderId: "so-pd-02719" },
  { sourceInvoiceId: 7382, orderCode: "PD 02719", salesOrderId: "so-pd-02719" },
];

describe("financeArEffectivePortfolio — paridade CR × FC", () => {
  it("sem FIN-05: vínculo NF→Pedido remove pré-NF substituído (Documento …)", () => {
    const rows = pd02719DocumentoRows();
    const filters = { status: "all" as const };

    const titles = buildFinanceArEffectivePortfolioItems({
      rows,
      filters,
      orderContexts: [],
      nfeOrderLinks: PD02719_NFE_LINKS,
      referenceDate: REF,
      applyOperationalPortfolioFilter: false,
    });
    const cashFlow = buildFinanceCashFlowEffectiveArPortfolio({
      rows,
      filters,
      orderContexts: [],
      nfeOrderLinks: PD02719_NFE_LINKS,
      referenceDate: REF,
    });

    const titleIds = titles.map((t) => t.externalId).sort((a, b) => a - b);
    const cashFlowIds = cashFlow.map((r) => r.externalId).sort((a, b) => a - b);
    assert.deepEqual(cashFlowIds, titleIds);
    assert.deepEqual(titleIds, [17874, 18076, 18079]);
    assert.equal(
      titles.reduce((s, t) => s + t.balanceReceivable, 0),
      464835
    );
  });

  it("buildFinanceArTitlesPayload e Fluxo de Caixa concordam nos externalId", () => {
    const rows = pd02719DocumentoRows();
    const query = {
      page: 1,
      limit: 50,
      sortBy: "dueDate" as const,
      sortDirection: "asc" as const,
      filters: { status: "all" as const },
      extended: {},
    };
    const titlesPayload = buildFinanceArTitlesPayload(rows, query, REF, null, {
      orderContexts: [],
      nfeOrderLinks: PD02719_NFE_LINKS,
    });
    const cashFlow = buildFinanceCashFlowEffectiveArPortfolio({
      rows,
      filters: query.filters,
      orderContexts: [],
      nfeOrderLinks: PD02719_NFE_LINKS,
      referenceDate: REF,
    });

    assert.deepEqual(
      titlesPayload.items.map((i) => i.externalId).sort((a, b) => a - b),
      cashFlow.map((r) => r.externalId).sort((a, b) => a - b)
    );
  });
});
