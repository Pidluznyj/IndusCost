import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceAccountsReceivableDashboard,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceAccountsPayableDashboard,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import {
  buildFinanceCashFlowDashboard,
  mapPrismaRowToFinanceCashFlowApRow,
  mapPrismaRowToFinanceCashFlowArRow,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";
import {
  buildExecutiveReportApFilters,
  buildExecutiveReportArFilters,
  buildExecutiveReportCashFlowFilters,
  buildExecutiveReportModuleSections,
  parseFinanceExecutiveReportQuery,
  resolveExecutiveReportReferenceDate,
  sliceExecutiveReportTopN,
} from "./financeExecutiveReport.js";
import {
  auditExecutiveReportApOperationalRules,
  auditExecutiveReportApParity,
  auditExecutiveReportArOverdueRules,
  auditExecutiveReportArParity,
  auditExecutiveReportArStaleExclusion,
  auditExecutiveReportCalendarParity,
  auditExecutiveReportCashFlowParity,
  auditExecutiveReportFullParity,
  auditExecutiveReportHeadlineParity,
  buildOfficialModulesForExecutiveReport,
} from "./financeExecutiveReportConsistency.js";
import { buildNomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import { isNomusArStaleForReports } from "./financeNomusArReportFreshness.js";

const LATEST_SYNC = new Date("2026-06-17T10:00:00.000Z");
const STALE_SYNC = new Date("2026-06-01T10:00:00.000Z");

function arCutoff() {
  return buildNomusArReportSyncCutoff(LATEST_SYNC)!;
}

function arRow(
  partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">
): FinanceArDashboardRow {
  return {
    companyName: "Empresa A",
    personName: "Cliente Alpha",
    personCnpj: "11.111.111/0001-11",
    dueDate: new Date(2026, 5, 1),
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "PIX",
    bankAccountName: "Bradesco",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    description: null,
    nomusStatus: null,
    syncedAt: new Date("2026-06-06T12:00:00.000Z"),
    ...partial,
  };
}

function apRow(
  partial: Partial<FinanceApDashboardRow> & Pick<FinanceApDashboardRow, "externalId">
): FinanceApDashboardRow {
  return {
    companyName: "Empresa A",
    personName: "Fornecedor Beta",
    personCnpj: "22.222.222/0001-22",
    dueDate: new Date(2026, 5, 10),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 800,
    amountPaid: 0,
    balancePayable: 800,
    paymentMethodName: "PIX",
    bankAccountName: "Bradesco",
    sourceInvoiceId: 200,
    documentNumber: "DOC-200",
    suspendPayment: false,
    description: null,
    nomusStatus: null,
    syncedAt: new Date("2026-06-06T12:00:00.000Z"),
    ...partial,
  };
}

function toCashFlowAr(row: FinanceArDashboardRow): FinanceCashFlowArRow {
  return mapPrismaRowToFinanceCashFlowArRow({
    externalId: row.externalId,
    companyName: row.companyName,
    personName: row.personName,
    personCnpj: row.personCnpj,
    dueDate: row.dueDate,
    settlementDate: row.settlementDate,
    amountReceivable: row.amountReceivable,
    amountReceived: row.amountReceived,
    balanceReceivable: row.balanceReceivable,
    paymentMethodName: row.paymentMethodName,
    bankAccountName: row.bankAccountName,
    sourceInvoiceId: row.sourceInvoiceId,
    sourceInvoiceNumber: row.sourceInvoiceNumber,
    suspendCollection: row.suspendCollection,
    description: row.description,
    nomusStatus: row.nomusStatus,
    syncedAt: row.syncedAt,
  } as never);
}

function toCashFlowAp(row: FinanceApDashboardRow): FinanceCashFlowApRow {
  return mapPrismaRowToFinanceCashFlowApRow({
    externalId: row.externalId,
    companyName: row.companyName,
    personName: row.personName,
    personCnpj: row.personCnpj,
    dueDate: row.dueDate,
    scheduleDate: row.scheduleDate,
    type: row.type,
    settlementDate: row.settlementDate,
    paymentDate: row.paymentDate,
    amountPayable: row.amountPayable,
    amountPaid: row.amountPaid,
    balancePayable: row.balancePayable,
    paymentMethodName: row.paymentMethodName,
    bankAccountName: row.bankAccountName,
    sourceInvoiceId: row.sourceInvoiceId,
    documentNumber: row.documentNumber,
    suspendPayment: row.suspendPayment,
    description: row.description,
    nomusStatus: row.nomusStatus,
    syncedAt: row.syncedAt,
  } as never);
}

describe("financeExecutiveReportConsistency — AR", () => {
  const arRows = [
    arRow({ externalId: 1, balanceReceivable: 500, dueDate: new Date(2026, 4, 15) }),
    arRow({ externalId: 2, balanceReceivable: 300, dueDate: new Date(2026, 5, 20) }),
    arRow({
      externalId: 3,
      balanceReceivable: 0,
      settlementDate: new Date(2026, 4, 1),
      amountReceived: 1000,
      dueDate: new Date(2026, 4, 1),
    }),
    arRow({
      externalId: 4,
      balanceReceivable: 200,
      syncedAt: STALE_SYNC,
      dueDate: new Date(2026, 4, 10),
    }),
  ];

  it("cards AR do relatório batem com dashboard oficial (mesmo ano/mês/filtros)", () => {
    const filters = parseFinanceExecutiveReportQuery({
      year: "2026",
      month: "6",
      asOfDate: "2026-06-09",
      company: "all",
      customerType: "external",
      topN: "50",
    });
    const referenceDate = resolveExecutiveReportReferenceDate(filters);
    const official = buildOfficialModulesForExecutiveReport({
      filters,
      referenceDate,
      arRows,
      apRows: [],
      cashFlowArRows: arRows.map(toCashFlowAr),
      cashFlowApRows: [],
      arSyncCutoff: arCutoff(),
      apSyncCutoff: null,
    });
    const sections = buildExecutiveReportModuleSections(official);
    const parity = auditExecutiveReportArParity(
      sections.accountsReceivable.payload,
      official.arPayload,
      filters.topN
    );
    assert.equal(parity.ok, true, parity.mismatches.join("; "));
  });

  it("topN limita listas do relatório sem alterar cards oficiais", () => {
    const rows = [
      arRow({ externalId: 1, balanceReceivable: 500, dueDate: new Date(2026, 4, 15) }),
      arRow({ externalId: 2, balanceReceivable: 300, dueDate: new Date(2026, 4, 20) }),
    ];
    const filters10 = parseFinanceExecutiveReportQuery({
      year: "2026",
      asOfDate: "2026-06-09",
      topN: "10",
    });
    const filtersAll = parseFinanceExecutiveReportQuery({
      year: "2026",
      asOfDate: "2026-06-09",
      topN: "all",
    });
    const ref = resolveExecutiveReportReferenceDate(filters10);
    const official = buildOfficialModulesForExecutiveReport({
      filters: filters10,
      referenceDate: ref,
      arRows: rows,
      apRows: [],
      cashFlowArRows: rows.map(toCashFlowAr),
      cashFlowApRows: [],
      arSyncCutoff: arCutoff(),
      apSyncCutoff: null,
    });

    const sampleList = Array.from({ length: 15 }, (_, i) => ({ rank: i }));
    assert.equal(sliceExecutiveReportTopN(sampleList, 10).length, 10);
    assert.equal(sliceExecutiveReportTopN(sampleList, undefined).length, 15);

    const s10 = buildExecutiveReportModuleSections({ ...official, filters: filters10 });
    const sAll = buildExecutiveReportModuleSections({ ...official, filters: filtersAll });
    assert.equal(s10.accountsReceivable.payload.cards.totalOpenAmount, sAll.accountsReceivable.payload.cards.totalOpenAmount);
    assert.equal(s10.accountsReceivable.payload.cards.totalOpenAmount, official.arPayload.cards.totalOpenAmount);
    assert.equal(
      s10.accountsReceivable.payload.criticalTitles.length,
      sliceExecutiveReportTopN(official.arPayload.criticalTitles, 10).length
    );
  });

  it("AR atrasado exclui stale, settlementDate, recebido e balance <= 0", () => {
    const filters = parseFinanceExecutiveReportQuery({ year: "2026", asOfDate: "2026-06-09" });
    const ref = resolveExecutiveReportReferenceDate(filters);
    const arFilters = buildExecutiveReportArFilters(filters);
    const cutoff = arCutoff();
    const staleRow = arRows.find((r) => r.externalId === 4)!;
    assert.equal(isNomusArStaleForReports(staleRow, cutoff), true);

    const rules = auditExecutiveReportArOverdueRules(arRows, arFilters, ref, cutoff);
    assert.equal(rules.ok, true, rules.mismatches.join("; "));
  });

  it("filtro with-nfe mapeia para invoiceIssued yes no AR oficial", () => {
    const filters = parseFinanceExecutiveReportQuery({
      year: "2026",
      asOfDate: "2026-06-09",
      nfeFilter: "with-nfe",
    });
    assert.equal(filters.invoiceIssuedFilter, "with-nfe");
    const arFilters = buildExecutiveReportArFilters(filters);
    assert.equal(arFilters.invoiceIssued, "yes");
  });
});

describe("financeExecutiveReportConsistency — AP", () => {
  const apRows = [
    apRow({ externalId: 1, balancePayable: 400 }),
    apRow({ externalId: 2, type: 2, balancePayable: 900, description: "Pedido de compra" }),
    apRow({ externalId: 3, balancePayable: 0, settlementDate: new Date(2026, 4, 1) }),
  ];

  it("cards AP do relatório batem com dashboard oficial", () => {
    const filters = parseFinanceExecutiveReportQuery({
      year: "2026",
      month: "6",
      asOfDate: "2026-06-09",
    });
    const ref = resolveExecutiveReportReferenceDate(filters);
    const official = buildOfficialModulesForExecutiveReport({
      filters,
      referenceDate: ref,
      arRows: [],
      apRows,
      cashFlowArRows: [],
      cashFlowApRows: apRows.map(toCashFlowAp),
      arSyncCutoff: null,
      apSyncCutoff: null,
    });
    const sections = buildExecutiveReportModuleSections(official);
    const parity = auditExecutiveReportApParity(
      sections.accountsPayable.payload,
      official.apPayload,
      filters.topN
    );
    assert.equal(parity.ok, true, parity.mismatches.join("; "));
  });

  it("AP respeita exclusão de pedido de compra (type=2) na agenda", () => {
    const filters = parseFinanceExecutiveReportQuery({ year: "2026", asOfDate: "2026-06-09" });
    const ref = resolveExecutiveReportReferenceDate(filters);
    const apFilters = buildExecutiveReportApFilters(filters);
    const rules = auditExecutiveReportApOperationalRules(apRows, apFilters, ref, null);
    assert.equal(rules.ok, true, rules.mismatches.join("; "));
  });
});

describe("financeExecutiveReportConsistency — Fluxo e Calendário", () => {
  const arRows = [arRow({ externalId: 1, balanceReceivable: 500 })];
  const apRows = [apRow({ externalId: 10, balancePayable: 300 })];

  it("fluxo do relatório bate com motor saneado oficial", () => {
    const filters = parseFinanceExecutiveReportQuery({
      year: "2026",
      month: "6",
      asOfDate: "2026-06-09",
    });
    const ref = resolveExecutiveReportReferenceDate(filters);
    const official = buildOfficialModulesForExecutiveReport({
      filters,
      referenceDate: ref,
      arRows,
      apRows,
      cashFlowArRows: arRows.map(toCashFlowAr),
      cashFlowApRows: apRows.map(toCashFlowAp),
      arSyncCutoff: arCutoff(),
      apSyncCutoff: null,
    });
    const sections = buildExecutiveReportModuleSections(official);
    const cashParity = auditExecutiveReportCashFlowParity(
      sections.cashFlow.payload,
      official.cashFlowPayload
    );
    assert.equal(cashParity.ok, true, cashParity.mismatches.join("; "));
  });

  it("calendário/agenda bate com calendário financeiro consolidado", () => {
    const filters = parseFinanceExecutiveReportQuery({ year: "2026", asOfDate: "2026-06-09" });
    const ref = resolveExecutiveReportReferenceDate(filters);
    const official = buildOfficialModulesForExecutiveReport({
      filters,
      referenceDate: ref,
      arRows,
      apRows,
      cashFlowArRows: arRows.map(toCashFlowAr),
      cashFlowApRows: apRows.map(toCashFlowAp),
      arSyncCutoff: arCutoff(),
      apSyncCutoff: null,
    });
    const sections = buildExecutiveReportModuleSections(official);
    const calParity = auditExecutiveReportCalendarParity(sections.calendarAgenda, official.cashFlowPayload);
    assert.equal(calParity.ok, true, calParity.mismatches.join("; "));
  });

  it("loadCashFlowRows usa referenceDate do asOfDate, não Date() atual", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/financeExecutiveReport.ts"), "utf8");
    assert.ok(src.includes("loadCashFlowRows(db, cashFlowFilters, referenceDate)"));
    assert.ok(!src.includes("const referenceDate = new Date();"));
  });

  it("stale AR não aparece no fluxo nos mesmos filtros", () => {
    const staleAr = arRow({ externalId: 99, syncedAt: STALE_SYNC, balanceReceivable: 1000 });
    const filters = parseFinanceExecutiveReportQuery({ year: "2026", asOfDate: "2026-06-09" });
    const ref = resolveExecutiveReportReferenceDate(filters);
    const official = buildOfficialModulesForExecutiveReport({
      filters,
      referenceDate: ref,
      arRows: [staleAr],
      apRows: [],
      cashFlowArRows: [toCashFlowAr(staleAr)],
      cashFlowApRows: [],
      arSyncCutoff: arCutoff(),
      apSyncCutoff: null,
    });
    const staleAudit = auditExecutiveReportArStaleExclusion(
      [staleAr],
      [toCashFlowAr(staleAr)],
      official.arFilters,
      official.cashFlowFilters,
      ref,
      arCutoff()
    );
    assert.equal(staleAudit.ok, true, staleAudit.mismatches.join("; "));
  });
});

describe("financeExecutiveReportConsistency — paridade completa", () => {
  it("auditExecutiveReportFullParity passa quando seções espelham payloads oficiais", () => {
    const arRows = [arRow({ externalId: 1 })];
    const apRows = [apRow({ externalId: 2 })];
    const filters = parseFinanceExecutiveReportQuery({
      year: "2026",
      asOfDate: "2026-06-09",
      topN: "50",
    });
    const ref = resolveExecutiveReportReferenceDate(filters);
    const official = buildOfficialModulesForExecutiveReport({
      filters,
      referenceDate: ref,
      arRows,
      apRows,
      cashFlowArRows: arRows.map(toCashFlowAr),
      cashFlowApRows: apRows.map(toCashFlowAp),
      arSyncCutoff: arCutoff(),
      apSyncCutoff: null,
    });
    const sections = buildExecutiveReportModuleSections(official);
    const full = auditExecutiveReportFullParity(sections, official);
    assert.equal(full.ok, true, full.mismatches.join("; "));

    const headline = auditExecutiveReportHeadlineParity(sections.executiveSummary, {
      arCards: official.arPayload.cards,
      apCards: official.apPayload.cards,
      cashFlowCards: official.cashFlowPayload.cards,
      billingTarget: null,
    });
    assert.equal(headline.ok, true, headline.mismatches.join("; "));
  });
});

describe("financeExecutiveReportConsistency — compliance", () => {
  it("não referencia clientes hardcoded Mexican/Mexichem/Energy", () => {
    const forbidden = ["Mexican", "Mexichem", "Energy"];
    const paths = [
      "src/lib/financeExecutiveReport.ts",
      "src/lib/financeExecutiveReportConsistency.ts",
    ];
    for (const p of paths) {
      const src = readFileSync(join(process.cwd(), p), "utf8");
      for (const token of forbidden) {
        assert.ok(!src.includes(token), `${p} contém ${token}`);
      }
    }
  });

  it("filtros executivos não filtram por nome de cliente/fornecedor", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/financeExecutiveReport.ts"), "utf8");
    assert.ok(!src.includes("personName:"));
    assert.ok(!src.includes("personCnpj:"));
  });
});
