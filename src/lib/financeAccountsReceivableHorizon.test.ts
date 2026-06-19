import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceAccountsReceivableDashboard,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildAccountsReceivableOpenHorizon,
  accountsReceivableOpenHorizonIsFinite,
  FINANCE_AR_OPEN_HORIZON_SCOPE_NOTE,
} from "./financeAccountsReceivableHorizon.js";
import { startOfLocalDay } from "./financeHorizonBuckets.js";

const REF = startOfLocalDay(new Date(2026, 5, 19));

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function arRow(
  partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId" | "dueDate">
): FinanceArDashboardRow {
  return {
    companyName: "Empresa",
    personName: "Cliente",
    personCnpj: null,
    description: "Título",
    settlementDate: null,
    amountReceivable: partial.balanceReceivable ?? 100,
    amountReceived: 0,
    balanceReceivable: partial.balanceReceivable ?? 100,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    suspendCollection: false,
    nomusStatus: false,
    syncedAt: new Date("2026-06-18T10:00:00.000Z"),
    ...partial,
  };
}

function horizonForDueDays(days: number, balance = 100, externalId = 1) {
  return buildAccountsReceivableOpenHorizon(
    [arRow({ externalId, dueDate: addDays(REF, days), balanceReceivable: balance })],
    REF
  );
}

describe("financeAccountsReceivableHorizon", () => {
  it("horizonte ignora filtro de mês no dashboard", () => {
    const june = arRow({ externalId: 1, dueDate: addDays(REF, 3), balanceReceivable: 100 });
    const july = arRow({ externalId: 2, dueDate: addDays(REF, 25), balanceReceivable: 200 });
    const august = arRow({ externalId: 3, dueDate: addDays(REF, 40), balanceReceivable: 300 });
    const allRows = [june, july, august];

    const filteredJune = buildFinanceAccountsReceivableDashboard(
      [june],
      { status: "all", year: 2026, month: 6 },
      REF,
      null,
      { horizonSourceRows: allRows }
    );
    const filteredJuly = buildFinanceAccountsReceivableDashboard(
      [july],
      { status: "all", year: 2026, month: 7 },
      REF,
      null,
      { horizonSourceRows: allRows }
    );

    assert.equal(filteredJune.financialHorizon.total60.amount, 600);
    assert.equal(filteredJuly.financialHorizon.total60.amount, 600);
    assert.equal(filteredJune.financialHorizon.buckets.find((b) => b.key === "16_30")?.amount, 200);
    assert.equal(filteredJune.financialHorizon.buckets.find((b) => b.key === "31_45")?.amount, 300);
  });

  it("horizonte ignora filtro de ano", () => {
    const rows = [
      arRow({ externalId: 1, dueDate: addDays(REF, 10), balanceReceivable: 150 }),
      arRow({ externalId: 2, dueDate: addDays(REF, 35), balanceReceivable: 250 }),
    ];
    const dash2026 = buildFinanceAccountsReceivableDashboard(rows, { status: "all", year: 2026 }, REF, null, {
      horizonSourceRows: rows,
    });
    const dash2027 = buildFinanceAccountsReceivableDashboard(rows, { status: "all", year: 2027 }, REF, null, {
      horizonSourceRows: rows,
    });
    assert.equal(dash2026.financialHorizon.total60.amount, 400);
    assert.equal(dash2027.financialHorizon.total60.amount, 400);
  });

  it("título recebido integralmente não entra", () => {
    const horizon = buildAccountsReceivableOpenHorizon(
      [
        arRow({
          externalId: 1,
          dueDate: addDays(REF, 5),
          balanceReceivable: 0,
          amountReceived: 100,
          settlementDate: addDays(REF, -1),
        }),
      ],
      REF
    );
    assert.equal(horizon.total60.amount, 0);
    assert.equal(horizon.audit.excludedBecauseSettled, 1);
  });

  it("título com saldo aberto entra e usa balanceReceivable", () => {
    const horizon = buildAccountsReceivableOpenHorizon(
      [
        arRow({
          externalId: 1,
          dueDate: addDays(REF, 5),
          balanceReceivable: 42.5,
          amountReceivable: 100,
          amountReceived: 57.5,
        }),
      ],
      REF
    );
    assert.equal(horizon.buckets.find((b) => b.key === "0_7")?.amount, 42.5);
    assert.equal(horizon.usesOpenBalance, true);
  });

  it("título vencido entra em Vencidos", () => {
    const horizon = buildAccountsReceivableOpenHorizon(
      [
        arRow({
          externalId: 1,
          dueDate: addDays(REF, -5),
          balanceReceivable: 80,
          sourceInvoiceNumber: "NF-100",
        }),
      ],
      REF
    );
    assert.equal(horizon.overdue.amount, 80);
    assert.equal(horizon.overdue.titlesCount, 1);
    assert.equal(horizon.total60.amount, 0);
  });

  it("classifica limites de buckets futuros", () => {
    assert.equal(horizonForDueDays(0).buckets.find((b) => b.key === "0_7")?.amount, 100);
    assert.equal(horizonForDueDays(7).buckets.find((b) => b.key === "0_7")?.amount, 100);
    assert.equal(horizonForDueDays(8).buckets.find((b) => b.key === "8_15")?.amount, 100);
    assert.equal(horizonForDueDays(15).buckets.find((b) => b.key === "8_15")?.amount, 100);
    assert.equal(horizonForDueDays(16).buckets.find((b) => b.key === "16_30")?.amount, 100);
    assert.equal(horizonForDueDays(30).buckets.find((b) => b.key === "16_30")?.amount, 100);
    assert.equal(horizonForDueDays(31).buckets.find((b) => b.key === "31_45")?.amount, 100);
    assert.equal(horizonForDueDays(45).buckets.find((b) => b.key === "31_45")?.amount, 100);
    assert.equal(horizonForDueDays(46).buckets.find((b) => b.key === "46_60")?.amount, 100);
    assert.equal(horizonForDueDays(60).buckets.find((b) => b.key === "46_60")?.amount, 100);
  });

  it("título em 61 dias não entra no total 60", () => {
    const horizon = horizonForDueDays(61, 500);
    assert.equal(horizon.total60.amount, 0);
    assert.equal(horizon.totals.totalOpenTitlesCount, 1);
  });

  it("total 60 é soma dos buckets 0–60", () => {
    const horizon = buildAccountsReceivableOpenHorizon(
      [
        arRow({ externalId: 1, dueDate: addDays(REF, 2), balanceReceivable: 10 }),
        arRow({ externalId: 2, dueDate: addDays(REF, 10), balanceReceivable: 20 }),
        arRow({ externalId: 3, dueDate: addDays(REF, 20), balanceReceivable: 30 }),
        arRow({ externalId: 4, dueDate: addDays(REF, 40), balanceReceivable: 40 }),
        arRow({ externalId: 5, dueDate: addDays(REF, 55), balanceReceivable: 50 }),
      ],
      REF
    );
    const sumBuckets = horizon.buckets.reduce((sum, b) => sum + b.amount, 0);
    assert.equal(horizon.total60.amount, sumBuckets);
    assert.equal(horizon.total60.amount, 150);
  });

  it("não retorna NaN/Infinity", () => {
    const horizon = buildAccountsReceivableOpenHorizon([], REF);
    assert.equal(accountsReceivableOpenHorizonIsFinite(horizon), true);
  });

  it("payload informa que filtros de período foram ignorados", () => {
    const horizon = buildAccountsReceivableOpenHorizon([], REF);
    assert.equal(horizon.ignoresPagePeriodFilters, true);
    assert.ok(horizon.audit.periodFiltersIgnored.includes("year"));
    assert.ok(horizon.audit.periodFiltersIgnored.includes("month"));
  });

  it("UI mostra texto independente dos filtros de mês/ano", () => {
    const component = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceArOpenHorizonSection.tsx"),
      "utf8"
    );
    assert.match(component, /scopeNote/);
    assert.match(FINANCE_AR_OPEN_HORIZON_SCOPE_NOTE, /independente dos filtros de mês\/ano/i);
  });

  it("cards mostram valor e quantidade de títulos", () => {
    const horizon = buildAccountsReceivableOpenHorizon(
      [arRow({ externalId: 1, dueDate: addDays(REF, 4), balanceReceivable: 100 })],
      REF
    );
    const bucket = horizon.buckets.find((b) => b.key === "0_7");
    assert.equal(bucket?.amount, 100);
    assert.equal(bucket?.titlesCount, 1);
    assert.ok((bucket?.shareOfTotal60 ?? 0) > 0);
  });

  it("componente prepara tabela de títulos por bucket", () => {
    const horizon = buildAccountsReceivableOpenHorizon(
      [arRow({ externalId: 1, dueDate: addDays(REF, 20), balanceReceivable: 100, personName: "Cliente X" })],
      REF
    );
    assert.equal(horizon.titlesByBucket["16_30"].length, 1);
    assert.equal(horizon.titlesByBucket["16_30"][0]?.customerName, "Cliente X");
    const component = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceArOpenHorizonSection.tsx"),
      "utf8"
    );
    assert.match(component, /titlesByBucket/);
    assert.match(component, /Valor em aberto/);
  });

  it("página AR usa FinanceArOpenHorizonSection", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsReceivablePage.tsx"),
      "utf8"
    );
    assert.match(page, /FinanceArOpenHorizonSection/);
    assert.doesNotMatch(page, /FinanceHorizonSection/);
  });
});
