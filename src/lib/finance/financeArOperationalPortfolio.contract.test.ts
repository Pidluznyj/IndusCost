/**
 * Contrato: Contas a Receber (FIN-08 / portfolio) e Fluxo de Caixa usam o mesmo suppress FIN-02.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";
import { buildFinanceArEffectiveTitles } from "./financeAccountsReceivableEffectiveTitles.js";
import {
  filterFinanceArOperationalPortfolioRows,
  suppressInferiorPreNfNomusArRows,
} from "./financeArOperationalPortfolio.js";
import { buildCashFlowAnnualComparison } from "@/src/lib/financeCashFlowAnnualComparison.js";
import { buildExecutiveMonthlyTimeline } from "@/src/lib/financeCashFlowExecutiveSummary.js";
import type { FinanceCashFlowArRow } from "@/src/lib/financeCashFlowDashboard.js";
import { buildSalesOrderEffectiveFinancialSchedule } from "./salesOrderEffectiveFinancialSchedule.js";

const REF = new Date(2026, 6, 17, 12, 0, 0, 0);
const CUSTOMER_ID = 88001;

function nomusCr(
  partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">
): FinanceArDashboardRow {
  return {
    companyName: "Empresa A",
    personId: CUSTOMER_ID,
    personName: "Cliente",
    personCnpj: "11222333000181",
    description: null,
    comments: null,
    dueDate: new Date(2026, 8, 10),
    competenceDate: new Date(2026, 6, 1),
    settlementDate: null,
    amountReceivable: 10000,
    amountReceived: 0,
    balanceReceivable: 10000,
    paymentMethodName: "Boleto",
    bankAccountName: "Bradesco",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: REF,
    ...partial,
  };
}

function pd02719Rows(): FinanceArDashboardRow[] {
  return [
    nomusCr({
      externalId: 17874,
      sourceInvoiceId: 7311,
      sourceInvoiceNumber: "7311",
      description: "Pedido PD 02719 NF 7311",
      amountReceivable: 158505,
      amountReceived: 1755,
      balanceReceivable: 156750,
      dueDate: new Date(2026, 8, 10),
    }),
    nomusCr({
      externalId: 18077,
      sourceInvoiceId: null,
      sourceInvoiceNumber: null,
      description: "Pedido PD 02719 — Depósito Bancário",
      amountReceivable: 158505,
      balanceReceivable: 158505,
      dueDate: new Date(2026, 8, 10),
    }),
    nomusCr({
      externalId: 18076,
      sourceInvoiceId: 7382,
      sourceInvoiceNumber: "7382",
      description: "Pedido PD 02719 NF 7382",
      amountReceivable: 146974,
      balanceReceivable: 146974,
      dueDate: new Date(2026, 8, 20),
    }),
    nomusCr({
      externalId: 18079,
      sourceInvoiceId: null,
      sourceInvoiceNumber: null,
      description: "Pedido PD 02719 — Depósito Bancário",
      amountReceivable: 161111,
      balanceReceivable: 161111,
      dueDate: new Date(2026, 8, 30),
    }),
  ];
}

describe("fonte única AR — Contas a Receber × Fluxo", () => {
  it("portfolio suppress e FIN-08 Concordam nos CR Nomus do PD 02719", () => {
    const rows = pd02719Rows();
    const portfolioIds = suppressInferiorPreNfNomusArRows(rows)
      .map((r) => r.externalId)
      .sort((a, b) => a - b);

    const schedule = buildSalesOrderEffectiveFinancialSchedule({
      salesOrderId: "so-pd-02719",
      orderCode: "PD 02719",
      originalInstallments: [
        { installmentNumber: 1, dueDate: "2026-09-10", amount: "155530.00" },
        { installmentNumber: 2, dueDate: "2026-09-20", amount: "155530.00" },
        { installmentNumber: 3, dueDate: "2026-09-30", amount: "155530.00" },
      ],
      items: [
        {
          salesOrderItemId: "item-1",
          plannedNetValue: "466590.00",
          status: 4,
          orderedQuantity: 100,
          fulfilledQuantity: 100,
          documentAllocations: [
            { allocationKey: "doc-7311", allocatedByOrderPrice: "158505.00" },
            { allocationKey: "doc-7382", allocatedByOrderPrice: "146974.00" },
          ],
          crAllocations: [
            {
              allocationKey: "cr-17874",
              amountReceivable: "158505.00",
              amountReceived: "1755.00",
              balanceReceivable: "156750.00",
            },
            {
              allocationKey: "cr-18076",
              amountReceivable: "146974.00",
              amountReceived: "0.00",
              balanceReceivable: "146974.00",
            },
          ],
        },
      ],
      documents: [
        {
          documentKey: "doc-7311",
          sourceInvoiceId: 7311,
          allocatedByOrderPrice: "158505.00",
          provenInstallments: [
            { installmentNumber: 1, dueDate: "2026-09-10", amount: "158505.00" },
          ],
        },
        {
          documentKey: "doc-7382",
          sourceInvoiceId: 7382,
          allocatedByOrderPrice: "146974.00",
          provenInstallments: [
            { installmentNumber: 2, dueDate: "2026-09-20", amount: "146974.00" },
          ],
        },
      ],
      realReceivables: [
        {
          externalId: 17874,
          sourceInvoiceId: 7311,
          dueDate: "2026-09-10",
          amountReceivable: "158505.00",
          amountReceived: "1755.00",
          balanceReceivable: "156750.00",
        },
        {
          externalId: 18076,
          sourceInvoiceId: 7382,
          dueDate: "2026-09-20",
          amountReceivable: "146974.00",
          amountReceived: "0.00",
          balanceReceivable: "146974.00",
        },
      ],
      referenceDate: REF,
    });

    const { items } = buildFinanceArEffectiveTitles({
      nomusRows: rows,
      orderContexts: [
        {
          schedule,
          personId: CUSTOMER_ID,
          personName: "Cliente",
          personCnpj: "11222333000181",
        },
      ],
      orderCode: "PD 02719",
      referenceDate: REF,
    });
    const fin08Ids = items
      .filter((i) => i.lineKind === "CR_REAL")
      .map((i) => i.externalId)
      .sort((a, b) => a - b);

    assert.deepEqual(portfolioIds, [17874, 18076]);
    assert.deepEqual(fin08Ids, portfolioIds);
  });

  it("timeline e comparativo anual não somam pré-NF duplicado no mês", () => {
    const arRows = pd02719Rows() as FinanceCashFlowArRow[];
    const timeline = buildExecutiveMonthlyTimeline(arRows, [], 2026, REF, {
      filters: {
        viewMode: "projected",
        dateBase: "due",
        status: "all",
        year: 2026,
      },
    });

    // Sem filtro operacional na timeline direta — o filtro está em filterArRowsForYtdReceived.
    // Simula o caminho do dashboard:
    const operational = filterFinanceArOperationalPortfolioRows(
      arRows,
      { status: "all" },
      REF
    ) as FinanceCashFlowArRow[];
    const timelineOp = buildExecutiveMonthlyTimeline(operational, [], 2026, REF, {
      filters: {
        viewMode: "projected",
        dateBase: "due",
        status: "all",
        year: 2026,
      },
    });

    const sep = timelineOp.find((m) => m.month === 9)!;
    // 156750 + 146974 = 303724 (sem 158505 + 161111 dos pré-NF)
    assert.equal(sep.receivableOpenDue, 303724);

    const annual = buildCashFlowAnnualComparison(arRows, [], 2026, REF);
    const sepAnnual = annual.months.find((m) => m.month === 9)!;
    assert.equal(sepAnnual.receivableOpenAmount, 303724);
    assert.ok(
      sepAnnual.receivableOpenAmount < timeline.find((m) => m.month === 9)!.receivableOpenDue,
      "anual (com YTD operacional) < timeline bruta sem suppress"
    );
  });
});
