import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceApHorizonRows,
  buildFinanceArHorizonRows,
  buildFinanceBillingHorizonSummary,
} from "./financeHorizonAggregation.js";
import { buildNomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import type { FinanceApDashboardRow } from "./financeAccountsPayableDashboard.js";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import {
  assignFinanceHorizonBucketKey,
  bucketizeFinanceHorizonRows,
  computeDaysFromToday,
  financeHorizonAggregationIsFinite,
  startOfLocalDay,
} from "./financeHorizonBuckets.js";
import { isAccountsPayablePurchaseOrderSchedule } from "./financeAccountsPayableOperational.js";

const REF = new Date(2026, 5, 9);

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function apRow(partial: Partial<FinanceApDashboardRow> & Pick<FinanceApDashboardRow, "externalId">): FinanceApDashboardRow {
  return {
    companyName: "Empresa",
    personName: "Fornecedor",
    personCnpj: null,
    description: "Serviço",
    dueDate: addDays(REF, 5),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 100,
    amountPaid: 0,
    balancePayable: 100,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    documentNumber: null,
    suspendPayment: false,
    nomusStatus: false,
    syncedAt: new Date(),
    ...partial,
  };
}

function arRow(partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">): FinanceArDashboardRow {
  return {
    companyName: "Empresa",
    personName: "Cliente",
    personCnpj: null,
    description: "Serviço",
    dueDate: addDays(REF, 5),
    settlementDate: null,
    amountReceivable: 100,
    amountReceived: 0,
    balanceReceivable: 100,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    suspendCollection: false,
    nomusStatus: false,
    syncedAt: new Date(),
    ...partial,
  };
}

describe("financeHorizonBuckets", () => {
  it("classifica buckets não acumulativos", () => {
    assert.equal(assignFinanceHorizonBucketKey(0), "0_7");
    assert.equal(assignFinanceHorizonBucketKey(7), "0_7");
    assert.equal(assignFinanceHorizonBucketKey(8), "8_15");
    assert.equal(assignFinanceHorizonBucketKey(16), "16_30");
    assert.equal(assignFinanceHorizonBucketKey(31), "31_45");
    assert.equal(assignFinanceHorizonBucketKey(46), "46_60");
    assert.equal(assignFinanceHorizonBucketKey(61), null);
    assert.equal(assignFinanceHorizonBucketKey(-1), null);
  });

  it("distribui valores por faixa e totaliza sem duplicidade", () => {
    const today = startOfLocalDay(REF);
    const agg = bucketizeFinanceHorizonRows(
      [
        { value: 100, operationalDate: addDays(today, 0) },
        { value: 200, operationalDate: addDays(today, 8) },
        { value: 300, operationalDate: addDays(today, 16) },
        { value: 400, operationalDate: addDays(today, 31) },
        { value: 500, operationalDate: addDays(today, 46) },
        { value: 999, operationalDate: addDays(today, 61) },
      ],
      today
    );

    assert.equal(agg.buckets.find((b) => b.key === "0_7")?.amount, 100);
    assert.equal(agg.buckets.find((b) => b.key === "8_15")?.amount, 200);
    assert.equal(agg.buckets.find((b) => b.key === "16_30")?.amount, 300);
    assert.equal(agg.buckets.find((b) => b.key === "31_45")?.amount, 400);
    assert.equal(agg.buckets.find((b) => b.key === "46_60")?.amount, 500);
    assert.equal(agg.total.amount, 1500);
    assert.equal(agg.total.count, 5);
    assert.equal(financeHorizonAggregationIsFinite(agg), true);
  });

  it("ignora valores inválidos sem NaN", () => {
    const agg = bucketizeFinanceHorizonRows(
      [
        { value: NaN, operationalDate: addDays(REF, 1) },
        { value: 100, operationalDate: null },
        { value: Infinity, operationalDate: addDays(REF, 2) },
      ],
      REF
    );
    assert.equal(agg.total.amount, 0);
    assert.doesNotMatch(String(agg.total.amount), /NaN/);
  });
});

describe("financeHorizonAggregation AP", () => {
  it("usa data operacional max(dueDate, scheduleDate)", () => {
    const row = apRow({
      externalId: 1,
      dueDate: addDays(REF, 2),
      scheduleDate: addDays(REF, 10),
      balancePayable: 250,
    });
    const rows = buildFinanceApHorizonRows([row], { status: "all" }, REF);
    const agg = bucketizeFinanceHorizonRows(rows, REF);
    assert.equal(agg.buckets.find((b) => b.key === "8_15")?.amount, 250);
  });

  it("exclui pedido de compra da visão gerencial", () => {
    const po = apRow({
      externalId: 2,
      description: "PEDIDO DE COMPRA PC 123",
      dueDate: addDays(REF, 3),
      balancePayable: 500,
    });
    assert.equal(isAccountsPayablePurchaseOrderSchedule(po), true);
    const rows = buildFinanceApHorizonRows([po], { status: "all" }, REF);
    assert.equal(rows.length, 0);
  });

  it("horizonte ignora filtro de mês mas respeita fornecedor", () => {
    const rows = [
      apRow({ externalId: 1, personName: "Alpha", dueDate: addDays(REF, 4), balancePayable: 100 }),
      apRow({ externalId: 2, personName: "Beta", dueDate: addDays(REF, 20), balancePayable: 200 }),
    ];
    const horizonRows = buildFinanceApHorizonRows(
      rows,
      { status: "all", year: 2026, month: 6, personName: "Alpha" },
      REF
    );
    assert.equal(horizonRows.length, 1);
    assert.equal(horizonRows[0]?.value, 100);
  });
});

describe("financeHorizonAggregation AR", () => {
  it("usa vencimento e saldo em aberto", () => {
    const rows = buildFinanceArHorizonRows(
      [arRow({ externalId: 1, dueDate: addDays(REF, 16), balanceReceivable: 180 })],
      { status: "all" },
      REF
    );
    const agg = bucketizeFinanceHorizonRows(rows, REF);
    assert.equal(agg.buckets.find((b) => b.key === "16_30")?.amount, 180);
  });

  it("exclui títulos stale Nomus quando syncCutoff é informado", () => {
    const latestSync = new Date("2026-06-16T10:00:00.000Z");
    const staleSync = new Date("2026-06-08T10:00:00.000Z");
    const cutoff = buildNomusArReportSyncCutoff(latestSync)!;
    const horizonRows = buildFinanceArHorizonRows(
      [
        arRow({
          externalId: 1,
          dueDate: addDays(REF, 10),
          balanceReceivable: 200,
          syncedAt: latestSync,
        }),
        arRow({
          externalId: 2,
          dueDate: addDays(REF, 12),
          balanceReceivable: 500,
          syncedAt: staleSync,
        }),
      ],
      { status: "all" },
      REF,
      cutoff
    );
    assert.equal(horizonRows.length, 1);
    assert.equal(horizonRows[0]?.value, 200);
  });
});

describe("financeHorizonAggregation Billing", () => {
  it("previsto usa expectedDeliveryDate e não troca fonte NF-e do realizado", () => {
    const summary = buildFinanceBillingHorizonSummary(
      [
        { totalNetValue: 1000, expectedDeliveryDate: addDays(REF, 3) },
        { totalNetValue: 2000, expectedDeliveryDate: addDays(REF, 20) },
        { totalNetValue: 500, expectedDeliveryDate: null },
      ],
      REF
    );
    assert.equal(summary.buckets.find((b) => b.key === "0_7")?.amount, 1000);
    assert.equal(summary.buckets.find((b) => b.key === "16_30")?.amount, 2000);
    assert.equal(summary.total.count, 2);
    assert.match(summary.title, /Horizonte de faturamento/);
  });
});

describe("financeHorizonUx", () => {
  it("páginas financeiras exibem seção de horizonte", () => {
    for (const [file, pattern] of [
      ["FinanceAccountsPayablePage.tsx", /FinanceHorizonSection/],
      ["FinanceAccountsReceivablePage.tsx", /FinanceArOpenHorizonSection/],
      ["FinanceBillingPage.tsx", /FinanceHorizonSection/],
    ] as const) {
      const src = readFileSync(join(process.cwd(), "src", "components", "finance", file), "utf8");
      assert.match(src, pattern);
      assert.match(src, /financialHorizon/);
    }
  });

  it("computeDaysFromToday posiciona limites de bucket", () => {
    const today = startOfLocalDay(REF);
    assert.equal(computeDaysFromToday(addDays(today, 8), today), 8);
    assert.equal(computeDaysFromToday(addDays(today, 46), today), 46);
  });
});
