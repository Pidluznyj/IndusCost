import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignFinanceDashboardAgingBucketKey,
  parseFinanceAgingBucketParam,
  resolveFinanceAgingBucketMeta,
  rowMatchesFinanceDashboardAgingBucket,
  rowMatchesFinanceHorizonDrilldownBucket,
} from "./financeDashboardAgingBuckets.js";
import { buildFinanceArTitlesPayload } from "./financeAccountsReceivableTitles.js";
import { buildFinanceApTitlesPayload } from "./financeAccountsPayableTitles.js";
import { parseFinanceArDashboardFilters } from "./financeAccountsReceivableDashboard.js";
import { parseFinanceApDashboardFilters } from "./financeAccountsPayableDashboard.js";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import type { FinanceApDashboardRow } from "./financeAccountsPayableDashboard.js";

const TODAY = new Date("2026-06-17T12:00:00.000Z");

function arRow(overrides: Partial<FinanceArDashboardRow> = {}): FinanceArDashboardRow {
  return {
    externalId: 1,
    companyName: "Empresa",
    personName: "Cliente",
    personCnpj: "123",
    description: null,
    dueDate: new Date("2026-06-20T12:00:00.000Z"),
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: 10,
    sourceInvoiceNumber: "NF-1",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: TODAY,
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceApDashboardRow> = {}): FinanceApDashboardRow {
  return {
    externalId: 2,
    companyName: "Empresa",
    personName: "Fornecedor",
    personCnpj: "456",
    description: null,
    dueDate: new Date("2026-06-20T12:00:00.000Z"),
    scheduleDate: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    documentNumber: "DOC-1",
    suspendPayment: false,
    nomusStatus: true,
    type: null,
    syncedAt: TODAY,
    ...overrides,
  };
}

describe("financeDashboardAgingBuckets", () => {
  it("classifica 0–7 dias no horizonte", () => {
    const due = new Date("2026-06-20T12:00:00.000Z");
    assert.equal(assignFinanceDashboardAgingBucketKey(due, TODAY), "upcoming");
    assert.ok(rowMatchesFinanceHorizonDrilldownBucket(due, "0_7", TODAY));
    assert.equal(rowMatchesFinanceHorizonDrilldownBucket(due, "8_15", TODAY), false);
  });

  it("classifica 8–15 dias no horizonte", () => {
    const due = new Date("2026-06-28T12:00:00.000Z");
    assert.ok(rowMatchesFinanceHorizonDrilldownBucket(due, "8_15", TODAY));
    assert.equal(rowMatchesFinanceHorizonDrilldownBucket(due, "0_7", TODAY), false);
  });

  it("classifica acima de 90 dias vencido", () => {
    const due = new Date("2026-03-01T12:00:00.000Z");
    assert.equal(assignFinanceDashboardAgingBucketKey(due, TODAY), "overdue90plus");
    assert.ok(rowMatchesFinanceDashboardAgingBucket(due, "overdue90plus", TODAY));
  });

  it("parseFinanceAgingBucketParam aceita dashboard e horizonte", () => {
    assert.equal(parseFinanceAgingBucketParam("overdue1to7"), "overdue1to7");
    assert.equal(parseFinanceAgingBucketParam("0_7"), "0_7");
    assert.equal(parseFinanceAgingBucketParam("invalid"), undefined);
  });

  it("resolveFinanceAgingBucketMeta retorna label", () => {
    assert.equal(resolveFinanceAgingBucketMeta("overdue8to15").label, "8 a 15 dias vencido");
    assert.equal(resolveFinanceAgingBucketMeta("16_30").label, "16–30 dias");
  });
});

describe("buildFinanceArTitlesPayload — agingBucket", () => {
  it("filtra faixa overdue1to7 e retorna totais", () => {
    const rows = [
      arRow({ externalId: 1, dueDate: new Date("2026-06-10T12:00:00.000Z"), balanceReceivable: 100 }),
      arRow({ externalId: 2, dueDate: new Date("2026-06-01T12:00:00.000Z"), balanceReceivable: 200 }),
      arRow({ externalId: 3, dueDate: new Date("2026-07-01T12:00:00.000Z"), balanceReceivable: 300 }),
    ];
    const payload = buildFinanceArTitlesPayload(
      rows,
      {
        page: 1,
        limit: 25,
        sortBy: "dueDate",
        sortDirection: "desc",
        filters: parseFinanceArDashboardFilters({}),
        localFilter: "all",
        agingBucket: "overdue1to7",
      },
      TODAY
    );
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0]?.externalId, 1);
    assert.equal(payload.bucketTotals?.titlesCount, 1);
    assert.equal(payload.bucketTotals?.openBalanceAmount, 100);
    assert.equal(payload.selectedBucket?.key, "overdue1to7");
  });
});

describe("buildFinanceApTitlesPayload — agingBucket", () => {
  it("filtra faixa overdue16to30", () => {
    const rows = [
      apRow({ externalId: 1, dueDate: new Date("2026-05-20T12:00:00.000Z"), balancePayable: 150 }),
      apRow({ externalId: 2, dueDate: new Date("2026-06-10T12:00:00.000Z"), balancePayable: 50 }),
    ];
    const payload = buildFinanceApTitlesPayload(
      rows,
      {
        page: 1,
        limit: 25,
        sortBy: "dueDate",
        sortDirection: "desc",
        filters: parseFinanceApDashboardFilters({}),
        localFilter: "all",
        agingBucket: "overdue16to30",
      },
      TODAY
    );
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0]?.externalId, 1);
    assert.equal(payload.bucketTotals?.openBalanceAmount, 150);
  });
});
