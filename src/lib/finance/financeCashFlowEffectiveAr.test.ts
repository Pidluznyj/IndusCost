/**
 * Fluxo de Caixa × FIN-08 — paridade PD 02719.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";
import { buildFinanceCashFlowEffectiveArPortfolio } from "./financeCashFlowEffectiveAr.js";
import { buildSalesOrderEffectiveFinancialSchedule } from "./salesOrderEffectiveFinancialSchedule.js";
import { filterCashFlowArPortfolioRows } from "@/src/lib/financeCashFlowRowFilters.js";
import type { FinanceCashFlowArRow } from "@/src/lib/financeCashFlowDashboard.js";
import { toCashFlowPortfolioArFilters } from "@/src/lib/financeCashFlowDashboard.js";
import { createDailyRadarDashboardFilters } from "@/src/lib/financeCashFlowDailyRadar.js";

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

function pd02719NomusRowsDocumentoLabels(): FinanceArDashboardRow[] {
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

function pd02719Schedule() {
  return buildSalesOrderEffectiveFinancialSchedule({
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
}

describe("financeCashFlowEffectiveAr — PD 02719", () => {
  it("sem FIN-08: suppress falha quando CR vem como Documento (sem hint PD)", () => {
    const rows = pd02719NomusRowsDocumentoLabels() as FinanceCashFlowArRow[];
    const filters = createDailyRadarDashboardFilters();
    const legacy = filterCashFlowArPortfolioRows(
      rows,
      filters,
      toCashFlowPortfolioArFilters(filters),
      REF
    );
    assert.ok(legacy.some((r) => r.externalId === 18077), "pré-NF parcela 1 permanece no legado");
    assert.ok(legacy.some((r) => r.externalId === 18079), "pré-NF parcela 3 permanece no legado");
    assert.ok(legacy.length >= 4, "legado conta camadas duplicadas");
  });

  it("com FIN-08: 2 CR + 1 residual = 466.590 (sem parcela 1/3 duplicada)", () => {
    const rows = pd02719NomusRowsDocumentoLabels() as FinanceCashFlowArRow[];
    const schedule = pd02719Schedule();
    const effective = buildFinanceCashFlowEffectiveArPortfolio({
      rows,
      orderContexts: [
        {
          schedule,
          personId: CUSTOMER_ID,
          personName: "Britania Eletrodomesticos SA",
        },
      ],
      referenceDate: REF,
    });

    const crIds = effective
      .filter((r) => r.externalId > 0)
      .map((r) => r.externalId)
      .sort((a, b) => a - b);
    assert.deepEqual(crIds, [17874, 18076]);
    assert.ok(!effective.some((r) => r.externalId === 18077 || r.externalId === 18079));

    const openTotal = effective.reduce((s, r) => s + r.balanceReceivable, 0);
    assert.equal(openTotal, 464835, "156750 + 146974 + 161111 em aberto");
    const nominalTotal = effective.reduce((s, r) => s + r.amountReceivable, 0);
    assert.equal(nominalTotal, 466590, "valor comercial do pedido");
    assert.equal(
      effective.filter((r) => r.externalId < 0).length,
      1,
      "uma linha residual sintética"
    );
    assert.equal(
      effective.find((r) => r.externalId < 0)!.balanceReceivable,
      161111
    );
  });

  it("filterCashFlowArPortfolioRows repassa orderContexts (mesmo motor)", () => {
    const rows = pd02719NomusRowsDocumentoLabels() as FinanceCashFlowArRow[];
    const schedule = pd02719Schedule();
    const filters = createDailyRadarDashboardFilters();
    const effective = filterCashFlowArPortfolioRows(
      rows,
      filters,
      toCashFlowPortfolioArFilters(filters),
      REF,
      null,
      {
        orderContexts: [
          {
            schedule,
            personId: CUSTOMER_ID,
            personName: "Britania Eletrodomesticos SA",
          },
        ],
      }
    );

    assert.equal(
      effective.reduce((s, r) => s + r.balanceReceivable, 0),
      464835
    );
    assert.ok(!effective.some((r) => r.externalId === 18077));
  });
});
