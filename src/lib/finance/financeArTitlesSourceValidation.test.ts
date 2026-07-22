/**
 * Validação end-to-end — fonte canônica AR (Títulos × Fluxo de Caixa).
 * Garante paridade de IDs, valores e consumo pelos principais motores.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { FinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";
import { buildFinanceArTitlesPayload } from "@/src/lib/financeAccountsReceivableTitles.js";
import {
  buildFinanceCashFlowDashboard,
  toCashFlowPortfolioArFilters,
} from "@/src/lib/financeCashFlowDashboard.js";
import { buildFinanceCashFlowDataset } from "@/src/lib/financeCashFlowDataset.js";
import { buildCashFlowAnnualComparison } from "@/src/lib/financeCashFlowAnnualComparison.js";
import {
  buildCashFlowDailyRadarData,
  filterDailyRadarPortfolioRows,
} from "@/src/lib/financeCashFlowDailyRadar.js";
import {
  filterCashFlowArRowsScoped,
  filterCashFlowArPortfolioRows,
} from "@/src/lib/financeCashFlowRowFilters.js";
import { resolveFinanceArCanonicalEffectiveTitles } from "./financeArEffectiveTitlesSource.js";

const REF = new Date(2026, 6, 17, 12, 0, 0, 0);
const CUSTOMER_ID = 88001;

const NFE_LINKS = [
  { sourceInvoiceId: 7311, orderCode: "PD 02719", salesOrderId: "so-pd-02719" },
  { sourceInvoiceId: 7382, orderCode: "PD 02719", salesOrderId: "so-pd-02719" },
];

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

function britaniaSeptemberRows(): FinanceArDashboardRow[] {
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
      description: "Pedido PD 02719 - Parcela 1 de 3",
      sourceInvoiceId: null,
      sourceInvoiceNumber: null,
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
      description: "Pedido PD 02719 - Parcela 3 de 3",
      sourceInvoiceId: null,
      sourceInvoiceNumber: null,
      amountReceivable: 161111,
      balanceReceivable: 161111,
      dueDate: new Date(2026, 8, 30),
    }),
  ];
}

const SEPT_CF_FILTERS = {
  viewMode: "projected" as const,
  dateBase: "due" as const,
  status: "all" as const,
  year: 2026,
  month: 9,
};

const AR_OPTIONS = { orderContexts: [], nfeOrderLinks: NFE_LINKS };

function titlesSeptember(rows: FinanceArDashboardRow[]) {
  return buildFinanceArTitlesPayload(
    rows,
    {
      page: 1,
      limit: 100,
      sortBy: "dueDate",
      sortDirection: "asc",
      filters: { status: "all", year: 2026, month: 9 },
      extended: {},
    },
    REF,
    null,
    AR_OPTIONS
  );
}

describe("financeArTitlesSourceValidation — entrega pedida", () => {
  it("Britania set/2026: 3 títulos, total aberto 464.835", () => {
    const rows = britaniaSeptemberRows();
    const titles = titlesSeptember(rows);
    assert.equal(titles.items.length, 3);
    assert.deepEqual(
      titles.items.map((i) => i.externalId).sort((a, b) => a - b),
      [17874, 18076, 18079]
    );
    assert.equal(
      titles.summary.totalOpenValue,
      464835,
      "156750 + 146974 + 161111"
    );
  });

  it("buildFinanceCashFlowDashboard set/2026 = mesmos IDs e inflow que Títulos", () => {
    const rows = britaniaSeptemberRows();
    const titles = titlesSeptember(rows);
    const payload = buildFinanceCashFlowDashboard(
      rows as import("@/src/lib/financeCashFlowDashboard.js").FinanceCashFlowArRow[],
      [],
      SEPT_CF_FILTERS,
      REF,
      null,
      null,
      AR_OPTIONS
    );

    const septInflow = payload.monthlySeries.find((p) => p.month === 9)?.inflowAmount ?? 0;
    assert.equal(septInflow, titles.summary.totalOpenValue);
    assert.equal(payload.cards.arRecords, 3);

    const scoped = filterCashFlowArRowsScoped(
      rows as import("@/src/lib/financeCashFlowDashboard.js").FinanceCashFlowArRow[],
      SEPT_CF_FILTERS,
      { status: "all", year: 2026, month: 9 },
      REF,
      null,
      AR_OPTIONS
    );
    assert.deepEqual(
      scoped.map((r) => r.externalId).sort((a, b) => a - b),
      titles.items.map((i) => i.externalId).sort((a, b) => a - b)
    );
  });

  it("buildFinanceCashFlowDataset usa motor canônico (arRowsSanitized)", () => {
    const rows = britaniaSeptemberRows();
    const titles = titlesSeptember(rows);
    const dataset = buildFinanceCashFlowDataset(
      rows as import("@/src/lib/financeCashFlowDashboard.js").FinanceCashFlowArRow[],
      [],
      SEPT_CF_FILTERS,
      { status: "all", year: 2026, month: 9 },
      { status: "all" },
      REF,
      null,
      null,
      AR_OPTIONS
    );
    const ids = dataset.arRowsSanitized.map((r) => r.externalId).sort((a, b) => a - b);
    assert.deepEqual(ids, titles.items.map((i) => i.externalId).sort((a, b) => a - b));
    assert.equal(
      dataset.blocks.totalReceivableOpen,
      titles.summary.totalOpenValue
    );
  });

  it("Radar diário e comparativo anual herdam paridade via arFilterOptions", () => {
    const rows = britaniaSeptemberRows() as import("@/src/lib/financeCashFlowDashboard.js").FinanceCashFlowArRow[];
    const arFilters = toCashFlowPortfolioArFilters(SEPT_CF_FILTERS);

    const radarPortfolio = filterDailyRadarPortfolioRows(
      rows,
      [],
      REF,
      null,
      null,
      SEPT_CF_FILTERS,
      AR_OPTIONS
    );
    const radar = buildCashFlowDailyRadarData({
      arRows: rows,
      apRows: [],
      baseDate: REF,
      referenceDate: REF,
      dashboardFilters: SEPT_CF_FILTERS,
      orderContexts: AR_OPTIONS.orderContexts,
      nfeOrderLinks: AR_OPTIONS.nfeOrderLinks,
    });
    const radarSeptReceivable = radar.ranges
      .flatMap((r) => (r.receivableTotal > 0 ? [r.receivableTotal] : []))
      .reduce((s, v) => s + v, 0);
    assert.ok(radarPortfolio.arRows.length >= 3);
    assert.ok(radarSeptReceivable > 0);

    const annual = buildCashFlowAnnualComparison(
      rows,
      [],
      2026,
      REF,
      null,
      null,
      AR_OPTIONS
    );
    const septAnnual = annual.months.find((m) => m.month === 9);
    assert.ok(septAnnual);
    assert.equal(septAnnual!.receivableOpenAmount, 464835);
  });

  it("filterCashFlowArPortfolioRows sem fallback legado isolado", () => {
    const rows = britaniaSeptemberRows() as import("@/src/lib/financeCashFlowDashboard.js").FinanceCashFlowArRow[];
    const portfolio = filterCashFlowArPortfolioRows(
      rows,
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      { status: "all" },
      REF,
      null,
      AR_OPTIONS
    );
    assert.deepEqual(
      portfolio.map((r) => r.externalId).sort((a, b) => a - b),
      [17874, 18076, 18079]
    );
  });

  it("resolveFinanceArCanonicalEffectiveTitles é o único motor antes da paginação em Títulos", () => {
    const rows = britaniaSeptemberRows();
    const canonical = resolveFinanceArCanonicalEffectiveTitles({
      rows,
      filters: { status: "all" },
      orderContexts: [],
      nfeOrderLinks: NFE_LINKS,
      referenceDate: REF,
      applyOperationalPortfolioFilter: false,
    });
    const titles = titlesSeptember(rows);
    assert.deepEqual(
      canonical.map((c) => c.externalId).sort((a, b) => a - b),
      titles.items.map((t) => t.externalId).sort((a, b) => a - b)
    );
  });

  it("wiring estático: consumidores referenciam fonte canônica", () => {
    const root = fileURLToPath(new URL("../../..", import.meta.url));
    const read = (rel: string) => readFileSync(`${root}/${rel}`, "utf8");

    assert.match(read("src/lib/financeAccountsReceivableTitles.ts"), /resolveFinanceArCanonicalEffectiveTitles/);
    assert.match(read("src/lib/finance/financeCashFlowEffectiveAr.ts"), /resolveFinanceArCanonicalEffectiveTitlesAsCashFlowRows/);
    assert.match(read("src/lib/financeCashFlowRowFilters.ts"), /buildFinanceCashFlowArRowsAlignedWithTitles/);
    assert.match(read("src/lib/financeCashFlowRoutes.ts"), /loadFinanceArTitlesSourceBundle/);
    assert.match(read("src/lib/financeExecutiveReportCashRadar.ts"), /loadFinanceArTitlesSourceBundle/);

    const rowFilters = read("src/lib/financeCashFlowRowFilters.ts");
    assert.doesNotMatch(
      rowFilters,
      /suppressInferiorPreNfNomusArRows/,
      "applyCashFlowArOperationalPortfolio não deve usar suppress legado"
    );
  });
});
