import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  buildFinanceArTitlesPayload,
  parseFinanceArTitlesQuery,
} from "./financeAccountsReceivableTitles.js";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import { buildAccountsReceivableOpenHorizon } from "./financeAccountsReceivableHorizon.js";
import { startOfLocalDay } from "./financeHorizonBuckets.js";
import {
  buildFinanceArHorizonAppliedFilterLines,
  buildFinanceArHorizonExportQueryString,
  FinanceArHorizonExportError,
  parseFinanceArHorizonExportQuery,
  type FinanceArHorizonExportPayload,
} from "./financeAccountsReceivableHorizonExport.js";
import {
  buildFinanceArHorizonExportFilename,
  buildFinanceArHorizonExportWorkbook,
  FINANCE_AR_HORIZON_EXPORT_TITLE,
  sanitizeArHorizonExportSlug,
} from "./financeAccountsReceivableHorizonExportXlsx.js";

const REF = startOfLocalDay(new Date(2026, 5, 19));

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function arRow(
  partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId" | "dueDate">
): FinanceArDashboardRow {
  return {
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "11111111000111",
    description: "Título teste",
    settlementDate: null,
    amountReceivable: partial.balanceReceivable ?? 100,
    amountReceived: 0,
    balanceReceivable: partial.balanceReceivable ?? 100,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: 10,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    nomusStatus: false,
    syncedAt: new Date("2026-06-18T10:00:00.000Z"),
    ...partial,
  };
}

function bucketExportItems(rows: FinanceArDashboardRow[], agingBucket: string) {
  const query = parseFinanceArHorizonExportQuery({ agingBucket });
  const first = buildFinanceArTitlesPayload(rows, query, REF);
  const all = buildFinanceArTitlesPayload(
    rows,
    { ...query, limit: Math.max(first.total, 1) },
    REF
  );
  return { query, first, all };
}

function mockPayload(
  items: FinanceArHorizonExportPayload["items"],
  bucketKey: string,
  bucketLabel: string
): FinanceArHorizonExportPayload {
  const horizon = buildAccountsReceivableOpenHorizon(
    items.map((item) =>
      arRow({
        externalId: item.externalId,
        dueDate: new Date(item.dueDate),
        balanceReceivable: item.balanceReceivable,
        personName: item.personName ?? "Cliente",
      })
    ),
    REF
  );
  const total = items.reduce((sum, item) => sum + item.balanceReceivable, 0);
  return {
    generatedAt: REF.toISOString(),
    operationalBaseDate: horizon.today,
    scope: "bucket",
    bucket: { key: bucketKey, label: bucketLabel },
    horizon: {
      title: horizon.title,
      subtitle: horizon.subtitle,
      scopeNote: horizon.scopeNote,
      overdueNote: horizon.overdueNote,
      today: horizon.today,
    },
    summary: {
      totalOpenBalance: total,
      titlesCount: items.length,
      overdueAmount: items
        .filter((i) => i.daysOverdue > 0)
        .reduce((s, i) => s + i.balanceReceivable, 0),
      upcomingAmount: items
        .filter((i) => i.daysOverdue <= 0)
        .reduce((s, i) => s + i.balanceReceivable, 0),
      maxTitleAmount: Math.max(...items.map((i) => i.balanceReceivable), 0),
      averageTicket: items.length ? total / items.length : 0,
      topCustomerName: items[0]?.personName ?? null,
    },
    bucketSummaries: [horizon.overdue, ...horizon.buckets, horizon.total60].map((b) => ({
      key: b.key,
      label: b.label,
      amount: b.amount,
      titlesCount: b.titlesCount,
    })),
    appliedFilters: buildFinanceArHorizonAppliedFilterLines({
      scope: "bucket",
      bucket: { key: bucketKey, label: bucketLabel },
    }),
    items,
    bucketTotals: { openBalanceAmount: total, titlesCount: items.length },
    userName: "Paulo",
  };
}

describe("financeAccountsReceivableHorizonExport", () => {
  it("botões Exportar Excel/PDF aparecem quando uma faixa é selecionada", () => {
    const drilldown = read("src/components/finance/shared/FinanceAgingBucketDrilldownSection.tsx");
    assert.ok(drilldown.includes("FinanceArHorizonExportButtons"));
    assert.ok(drilldown.includes('testIdPrefix="finance-ar-horizon-bucket"'));
    assert.ok(drilldown.includes("horizonMode"));

    const buttons = read("src/components/finance/FinanceArHorizonExportButtons.tsx");
    assert.ok(buttons.includes("Exportar Excel"));
    assert.ok(buttons.includes("Exportar PDF"));
    assert.ok(buttons.includes('-export-excel`'));
    assert.ok(buttons.includes('-export-pdf`'));
  });

  it("exportação Excel envia a faixa selecionada", () => {
    const qs = buildFinanceArHorizonExportQueryString({ agingBucket: "8_15" });
    assert.match(qs, /agingBucket=8_15/);
    assert.doesNotMatch(qs, /scope=full/);

    const buttons = read("src/components/finance/FinanceArHorizonExportButtons.tsx");
    assert.ok(buttons.includes("/horizon/export.xlsx?"));
    assert.ok(buttons.includes("buildFinanceArHorizonExportQueryString"));
  });

  it("exportação PDF envia a faixa selecionada", () => {
    const buttons = read("src/components/finance/FinanceArHorizonExportButtons.tsx");
    assert.ok(buttons.includes("/horizon/export-data?"));
    assert.ok(buttons.includes("ar-horizon-print-route"));
    assert.ok(buttons.includes("window.print"));
  });

  it("exportação horizonte completo usa scope=full", () => {
    const section = read("src/components/finance/FinanceArOpenHorizonSection.tsx");
    assert.ok(section.includes('scope="full"'));
    assert.ok(section.includes("Exportar Horizonte Excel"));
    assert.ok(section.includes("Exportar Horizonte PDF"));
    const qs = buildFinanceArHorizonExportQueryString({ scope: "full" });
    assert.match(qs, /scope=full/);
  });

  it("rotas expõem export.xlsx e export-data do horizonte", () => {
    const routes = read("src/lib/financeAccountsReceivableRoutes.ts");
    assert.ok(routes.includes("/api/finance/accounts-receivable/horizon/export.xlsx"));
    assert.ok(routes.includes("/api/finance/accounts-receivable/horizon/export-data"));
    assert.ok(routes.includes("buildFinanceArHorizonExportPayloadDefault"));
  });

  it("parse exige faixa no modo bucket", () => {
    assert.throws(
      () => parseFinanceArHorizonExportQuery({}),
      (error: unknown) => error instanceof FinanceArHorizonExportError
    );
    const parsed = parseFinanceArHorizonExportQuery({ agingBucket: "overdue" });
    assert.equal(parsed.scope, "bucket");
    assert.equal(parsed.agingBucket, "overdue");
  });

  it("filtros aplicados são exibidos no relatório", () => {
    const lines = buildFinanceArHorizonAppliedFilterLines({
      scope: "bucket",
      bucket: { key: "8_15", label: "8–15 dias" },
      search: "",
    });
    assert.ok(lines.some((line) => line.label === "Faixa" && line.value === "8–15 dias"));
    assert.ok(lines.some((line) => line.label === "Busca" && line.value === "—"));

    const payload = mockPayload([], "8_15", "8–15 dias");
    const wb = buildFinanceArHorizonExportWorkbook(payload);
    const filtersSheet = wb.Sheets["Filtros aplicados"];
    assert.ok(filtersSheet);
    const filtersData = XLSX.utils.sheet_to_json<{ Filtro: string; Valor: string }>(filtersSheet);
    assert.ok(filtersData.some((row) => row.Filtro === "Faixa" && row.Valor === "8–15 dias"));
  });

  it("Excel e PDF contêm seção de filtros aplicados", () => {
    const printDoc = read("src/components/finance/FinanceArHorizonPrintDocument.tsx");
    assert.ok(printDoc.includes("Filtros aplicados"));
    assert.ok(printDoc.includes("payload.appliedFilters"));
  });

  it("exportação overdue funciona", () => {
    const rows = [
      arRow({ externalId: 1, dueDate: addDays(REF, -5), balanceReceivable: 200 }),
      arRow({ externalId: 2, dueDate: addDays(REF, 10), balanceReceivable: 300 }),
    ];
    const { all } = bucketExportItems(rows, "overdue");
    assert.equal(all.items.length, 1);
    assert.equal(all.items[0]?.balanceReceivable, 200);
  });

  it("exportação 0–7 dias funciona", () => {
    const rows = [
      arRow({ externalId: 1, dueDate: addDays(REF, 0), balanceReceivable: 50 }),
      arRow({ externalId: 2, dueDate: addDays(REF, 7), balanceReceivable: 70 }),
      arRow({ externalId: 3, dueDate: addDays(REF, 10), balanceReceivable: 90 }),
    ];
    const { all } = bucketExportItems(rows, "0_7");
    assert.equal(all.items.length, 2);
    assert.equal(all.bucketTotals?.titlesCount, 2);
  });

  it("exportação 8–15 dias funciona", () => {
    const rows = [
      arRow({ externalId: 1, dueDate: addDays(REF, 8), balanceReceivable: 100 }),
      arRow({ externalId: 2, dueDate: addDays(REF, 15), balanceReceivable: 150 }),
      arRow({ externalId: 3, dueDate: addDays(REF, 16), balanceReceivable: 200 }),
    ];
    const { all } = bucketExportItems(rows, "8_15");
    assert.equal(all.items.length, 2);
    assert.equal(
      all.items.reduce((sum, item) => sum + item.balanceReceivable, 0),
      250
    );
  });

  it("Excel exporta todos os títulos da faixa, não apenas os visíveis", () => {
    const rows = Array.from({ length: 30 }, (_, index) =>
      arRow({
        externalId: index + 1,
        dueDate: addDays(REF, 10),
        balanceReceivable: 100 + index,
        personName: `Cliente ${index + 1}`,
      })
    );
    const gridQuery = parseFinanceArTitlesQuery({ agingBucket: "8_15", page: "1", limit: "25" });
    const gridPayload = buildFinanceArTitlesPayload(rows, gridQuery, REF);
    const { all } = bucketExportItems(rows, "8_15");
    assert.equal(gridPayload.items.length, 25);
    assert.equal(all.items.length, 30);

    const payload = mockPayload(all.items, "8_15", "8–15 dias");
    const wb = buildFinanceArHorizonExportWorkbook(payload);
    const titlesSheet = wb.Sheets.Títulos;
    const table = XLSX.utils.sheet_to_json<Record<string, unknown>>(titlesSheet);
    const dataRows = table.filter((row) => row.Cliente && row.Cliente !== "");
    assert.equal(dataRows.length, 30);
  });

  it("totalizadores da exportação batem com o card selecionado", () => {
    const rows = [
      arRow({ externalId: 1, dueDate: addDays(REF, 12), balanceReceivable: 400 }),
      arRow({ externalId: 2, dueDate: addDays(REF, 14), balanceReceivable: 600 }),
    ];
    const { all } = bucketExportItems(rows, "8_15");
    const horizon = buildAccountsReceivableOpenHorizon(rows, REF);
    const card = horizon.buckets.find((b) => b.key === "8_15");
    assert.ok(card);
    assert.equal(all.bucketTotals?.openBalanceAmount, card.amount);
    assert.equal(all.bucketTotals?.titlesCount, card.titlesCount);
    assert.equal(
      all.items.reduce((sum, item) => sum + item.balanceReceivable, 0),
      card.amount
    );
  });

  it("nome de arquivo sanitiza faixa", () => {
    assert.equal(sanitizeArHorizonExportSlug("8–15 dias"), "8-15-dias");
    assert.match(
      buildFinanceArHorizonExportFilename("8–15 dias", new Date(2026, 5, 24)),
      /^contas-a-receber-horizonte-8-15-dias-2026\.xlsx$/
    );
  });

  it("workbook contém cabeçalho profissional e aba Resumo", () => {
    const rows = [arRow({ externalId: 1, dueDate: addDays(REF, 10), balanceReceivable: 500 })];
    const { all } = bucketExportItems(rows, "8_15");
    const payload = mockPayload(all.items, "8_15", "8–15 dias");
    const wb = buildFinanceArHorizonExportWorkbook(payload);
    const resumo = XLSX.utils.sheet_to_json<{ Campo: string; Valor: string | number }>(
      wb.Sheets.Resumo
    );
    assert.ok(resumo.some((row) => row.Campo === "Relatório" && row.Valor === FINANCE_AR_HORIZON_EXPORT_TITLE));
    assert.ok(resumo.some((row) => row.Campo === "Faixa selecionada" && row.Valor === "8–15 dias"));
  });

  it("frontend não importa Prisma nos componentes de exportação", () => {
    const files = [
      "src/components/finance/FinanceArHorizonExportButtons.tsx",
      "src/components/finance/FinanceArHorizonPrintDocument.tsx",
      "src/components/finance/shared/FinanceAgingBucketDrilldownSection.tsx",
      "src/components/finance/FinanceArOpenHorizonSection.tsx",
    ];
    for (const file of files) {
      const src = read(file);
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /lib\/prisma/);
    }
  });

  it("não altera cálculo dos cards do horizonte", () => {
    const rows = [
      arRow({ externalId: 1, dueDate: addDays(REF, -2), balanceReceivable: 100 }),
      arRow({ externalId: 2, dueDate: addDays(REF, 5), balanceReceivable: 200 }),
      arRow({ externalId: 3, dueDate: addDays(REF, 20), balanceReceivable: 300 }),
    ];
    const before = buildAccountsReceivableOpenHorizon(rows, REF);
    parseFinanceArTitlesQuery({ agingBucket: "8_15", page: "1", limit: "25" });
    bucketExportItems(rows, "8_15");
    const after = buildAccountsReceivableOpenHorizon(rows, REF);
    assert.deepEqual(
      [before.overdue.amount, before.total60.amount],
      [after.overdue.amount, after.total60.amount]
    );
  });
});
