import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  buildFinanceAccountsReceivableDashboard,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceArOverdueExportWorkbook,
  financeArOverdueWorkbookToBytes,
} from "./financeAccountsReceivableOverdueExport.js";
import {
  buildFinanceAccountsReceivableOverdueRows,
  buildFinanceArOverduePayload,
  isFinanceArOverdueOpenTitle,
  isFinanceArOverdueRow,
  resolveOverdueAgingLabel,
  sumFinanceArOverdueOpenAmount,
} from "./financeAccountsReceivableOverdue.js";
import {
  formatArOverduePrintPeriod,
  groupArOverdueTitlesByCustomer,
} from "./financeAccountsReceivableOverduePrintMeta.js";
import { buildNomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";

const LATEST_SYNC = new Date("2026-06-17T10:00:00.000Z");
const STALE_SYNC = new Date("2026-06-12T10:00:00.000Z");
const REF = new Date(2026, 5, 17);

function cutoff() {
  return buildNomusArReportSyncCutoff(LATEST_SYNC)!;
}

function arRow(overrides: Partial<FinanceArDashboardRow> = {}): FinanceArDashboardRow {
  return {
    externalId: 1,
    companyName: "KOPPETEL",
    personName: "Cliente Alpha Ltda",
    personCnpj: "11.111.111/0001-11",
    description: "Pedido 100",
    dueDate: new Date(2026, 5, 10),
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: null,
    sourceInvoiceId: 500,
    sourceInvoiceNumber: "NF-500",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: LATEST_SYNC,
    ...overrides,
  };
}

const MEXICHEM_CNPJ = "33.081.704/0001-00";

function mexichemReceivedRow(overrides: Partial<FinanceArDashboardRow> = {}): FinanceArDashboardRow {
  return arRow({
    externalId: 98001,
    personName: "MEXICHEM BRASIL LTDA",
    personCnpj: MEXICHEM_CNPJ,
    dueDate: new Date(2026, 2, 15),
    amountReceivable: 98000,
    amountReceived: 98000,
    balanceReceivable: 0,
    settlementDate: new Date(2026, 5, 10),
    syncedAt: LATEST_SYNC,
    ...overrides,
  });
}

function mexichemOpenOverdueRow(overrides: Partial<FinanceArDashboardRow> = {}): FinanceArDashboardRow {
  return arRow({
    externalId: 98002,
    personName: "MEXICHEN INDUSTRIA QUIMICA LTDA",
    personCnpj: MEXICHEM_CNPJ,
    dueDate: new Date(2026, 2, 15),
    amountReceivable: 98000,
    amountReceived: 0,
    balanceReceivable: 98000,
    settlementDate: null,
    syncedAt: LATEST_SYNC,
    ...overrides,
  });
}

function assertMexichemAbsentFromOverduePayload(payload: ReturnType<typeof buildFinanceArOverduePayload>) {
  const haystack = [
    payload.summary.totalOverdueAmount,
    payload.summary.overdueTitlesCount,
    payload.summary.topOverdueCustomer?.name ?? "",
    ...payload.agingBuckets.map((b) => b.amount),
    ...payload.customerRanking.map((r) => r.customerName),
    ...payload.overdueTitles.map((r) => r.customerName),
  ].join("|");
  assert.ok(!haystack.toUpperCase().includes("MEXICHEM"));
  assert.ok(!haystack.toUpperCase().includes("MEXICHEN"));
  assert.equal(payload.summary.totalOverdueAmount, 0);
  assert.equal(payload.summary.overdueTitlesCount, 0);
  assert.equal(payload.overdueTitles.length, 0);
  assert.equal(payload.customerRanking.length, 0);
}

describe("financeAccountsReceivableOverdue", () => {
  it("dueDate anterior + saldo aberto aparece como atrasado", () => {
    const row = arRow({ dueDate: new Date(2026, 5, 1), balanceReceivable: 500 });
    assert.equal(isFinanceArOverdueOpenTitle(row, REF), true);
  });

  it("título pago/baixado não aparece", () => {
    const row = arRow({
      balanceReceivable: 0,
      amountReceived: 1000,
      settlementDate: new Date(2026, 5, 12),
    });
    assert.equal(isFinanceArOverdueRow(row, REF), false);
    assert.equal(isFinanceArOverdueOpenTitle(row, REF), false);
  });

  it("título com settlementDate preenchido não entra em Atrasados mesmo com saldo residual", () => {
    const row = arRow({
      balanceReceivable: 12.5,
      amountReceived: 987.5,
      amountReceivable: 1000,
      settlementDate: new Date(2026, 5, 12),
    });
    assert.equal(isFinanceArOverdueRow(row, REF), false);
  });

  it("título com amountReceived >= amountReceivable não entra em Atrasados", () => {
    const row = arRow({
      balanceReceivable: 50,
      amountReceived: 1000,
      amountReceivable: 1000,
      settlementDate: null,
    });
    assert.equal(isFinanceArOverdueRow(row, REF), false);
  });

  it("título com balanceReceivable <= 0 não entra em Atrasados", () => {
    const row = arRow({ balanceReceivable: 0, amountReceived: 500, amountReceivable: 500 });
    assert.equal(isFinanceArOverdueRow(row, REF), false);
  });

  it("fixture Mexichem/Mexichen 98k recebido não aparece em cards, ranking, aging, tabela, Excel e PDF", () => {
    const rows = [mexichemReceivedRow()];
    const payload = buildFinanceArOverduePayload(
      rows,
      { status: "all", year: 2026 },
      REF,
      cutoff(),
      { paginate: false }
    );
    assertMexichemAbsentFromOverduePayload(payload);

    const exportPayload = buildFinanceArOverduePayload(
      rows,
      { status: "all", year: 2026, page: 1, limit: 5000 },
      REF,
      cutoff(),
      { paginate: false }
    );
    const wb = buildFinanceArOverdueExportWorkbook(exportPayload, exportPayload.overdueTitles);
    const titlesSheet = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets["Títulos Atrasados"]!
    );
    assert.equal(titlesSheet.length, 0);

    const groups = groupArOverdueTitlesByCustomer(exportPayload.overdueTitles);
    assert.equal(groups.length, 0);
  });

  it("fixture Mexichem/Mexichen 98k vencido e aberto aparece em Atrasados", () => {
    const rows = [mexichemOpenOverdueRow()];
    const payload = buildFinanceArOverduePayload(
      rows,
      { status: "all", year: 2026 },
      REF,
      cutoff(),
      { paginate: false }
    );
    assert.equal(payload.summary.overdueTitlesCount, 1);
    assert.equal(payload.summary.totalOverdueAmount, 98000);
    assert.equal(payload.overdueTitles[0]!.balanceReceivable, 98000);
    assert.equal(payload.customerRanking[0]!.overdueAmount, 98000);
    assert.ok(payload.agingBuckets.some((b) => b.amount === 98000));
  });

  it("total vencido da aba bate com a soma da tabela detalhada", () => {
    const rows = [
      arRow({ externalId: 1, balanceReceivable: 1200 }),
      arRow({ externalId: 2, balanceReceivable: 800, dueDate: new Date(2026, 4, 1) }),
      mexichemReceivedRow(),
    ];
    const payload = buildFinanceArOverduePayload(
      rows,
      { status: "all", year: 2026 },
      REF,
      cutoff(),
      { paginate: false }
    );
    const tableTotal = payload.overdueTitles.reduce((sum, row) => sum + row.balanceReceivable, 0);
    assert.equal(payload.summary.totalOverdueAmount, tableTotal);
  });

  it("ranking por cliente bate com a mesma base da tabela", () => {
    const rows = [
      arRow({
        externalId: 1,
        personName: "Cliente A",
        personCnpj: "11.111.111/0001-11",
        balanceReceivable: 800,
      }),
      arRow({
        externalId: 2,
        personName: "Cliente A",
        personCnpj: "11.111.111/0001-11",
        balanceReceivable: 200,
      }),
    ];
    const payload = buildFinanceArOverduePayload(
      rows,
      { status: "all", year: 2026 },
      REF,
      cutoff(),
      { paginate: false }
    );
    const rankingTotal = payload.customerRanking.reduce((sum, row) => sum + row.overdueAmount, 0);
    const tableTotal = payload.overdueTitles.reduce((sum, row) => sum + row.balanceReceivable, 0);
    assert.equal(rankingTotal, tableTotal);
    assert.equal(rankingTotal, payload.summary.totalOverdueAmount);
  });

  it("buildFinanceAccountsReceivableOverdueRows é a base única do payload", () => {
    const rows = [mexichemOpenOverdueRow(), mexichemReceivedRow()];
    const filters = { status: "all" as const, year: 2026 };
    const baseRows = buildFinanceAccountsReceivableOverdueRows(rows, filters, REF, cutoff());
    const payload = buildFinanceArOverduePayload(rows, filters, REF, cutoff(), { paginate: false });
    assert.equal(baseRows.length, payload.overdueTitles.length);
    assert.deepEqual(
      baseRows.map((r) => r.externalId),
      payload.overdueTitles.map((r) => r.externalId)
    );
  });

  it("título futuro não aparece", () => {
    const row = arRow({ dueDate: new Date(2026, 6, 1) });
    assert.equal(isFinanceArOverdueOpenTitle(row, REF), false);
  });

  it("AR stale não aparece em Atrasados", () => {
    const rows = [
      arRow({ externalId: 1, syncedAt: LATEST_SYNC }),
      arRow({ externalId: 2, syncedAt: STALE_SYNC, balanceReceivable: 9999 }),
    ];
    const payload = buildFinanceArOverduePayload(
      rows,
      { status: "all", year: 2026, month: 6 },
      REF,
      cutoff()
    );
    assert.equal(payload.summary.overdueTitlesCount, 1);
    assert.equal(payload.overdueTitles[0]!.externalId, 1);
  });

  it("aging distribui faixas 1-7, 8-15, 16-30, 31-60, 61-90 e 90+", () => {
    const rows = [
      arRow({ externalId: 1, dueDate: new Date(2026, 5, 16), balanceReceivable: 100 }),
      arRow({ externalId: 2, dueDate: new Date(2026, 5, 8), balanceReceivable: 200 }),
      arRow({ externalId: 3, dueDate: new Date(2026, 5, 1), balanceReceivable: 300 }),
      arRow({ externalId: 4, dueDate: new Date(2026, 4, 15), balanceReceivable: 400 }),
      arRow({ externalId: 5, dueDate: new Date(2026, 3, 10), balanceReceivable: 500 }),
      arRow({ externalId: 6, dueDate: new Date(2026, 2, 1), balanceReceivable: 600 }),
    ];
    const payload = buildFinanceArOverduePayload(
      rows,
      { status: "all", year: 2026 },
      REF,
      cutoff(),
      { paginate: false }
    );
    const byKey = new Map(payload.agingBuckets.map((b) => [b.key, b.titlesCount]));
    assert.equal(byKey.get("overdue1to7"), 1);
    assert.equal(byKey.get("overdue8to15"), 1);
    assert.equal(byKey.get("overdue16to30"), 1);
    assert.equal(byKey.get("overdue31to60"), 1);
    assert.equal(byKey.get("overdue61to90"), 1);
    assert.equal(byKey.get("overdue90plus"), 1);
  });

  it("ranking agrupa por cliente e calcula percentual sem NaN", () => {
    const rows = [
      arRow({
        externalId: 1,
        personName: "Cliente A",
        personCnpj: "11.111.111/0001-11",
        balanceReceivable: 800,
        dueDate: new Date(2026, 5, 5),
      }),
      arRow({
        externalId: 2,
        personName: "Cliente A",
        personCnpj: "11.111.111/0001-11",
        balanceReceivable: 200,
        dueDate: new Date(2026, 5, 1),
      }),
      arRow({
        externalId: 3,
        personName: "Cliente B",
        personCnpj: "22.222.222/0001-22",
        balanceReceivable: 1100,
      }),
    ];
    const payload = buildFinanceArOverduePayload(
      rows,
      { status: "all", year: 2026 },
      REF,
      cutoff(),
      { paginate: false }
    );
    // Total filtrado: 800 + 200 + 1100 = 2100
    // Cliente B: 1100 / 2100 × 100 = 52,38
    // Cliente A: 1000 / 2100 × 100 = 47,62
    assert.equal(payload.customerRanking.length, 2);
    assert.equal(payload.customerRanking[0]!.customerName, "Cliente B");
    assert.equal(payload.customerRanking[0]!.percentOfTotal, 52.38);
    assert.equal(payload.customerRanking[1]!.percentOfTotal, 47.62);
    assert.ok(payload.customerRanking.every((r) => Number.isFinite(r.percentOfTotal)));
    const sumPercent = payload.customerRanking.reduce((s, r) => s + r.percentOfTotal, 0);
    assert.ok(Math.abs(sumPercent - 100) < 0.02);
  });

  it("filtro com NF/sem NF respeita origem", () => {
    const rows = [
      arRow({ externalId: 1, sourceInvoiceId: 10, sourceInvoiceNumber: "NF-1" }),
      arRow({
        externalId: 2,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        balanceReceivable: 700,
      }),
    ];
    const withNf = buildFinanceArOverduePayload(
      rows,
      { status: "all", year: 2026, invoiceIssued: "yes" },
      REF,
      cutoff(),
      { paginate: false }
    );
    const withoutNf = buildFinanceArOverduePayload(
      rows,
      { status: "all", year: 2026, invoiceIssued: "no" },
      REF,
      cutoff(),
      { paginate: false }
    );
    assert.equal(withNf.summary.overdueTitlesCount, 1);
    assert.equal(withoutNf.summary.overdueTitlesCount, 1);
    assert.equal(withNf.overdueTitles[0]!.externalId, 1);
    assert.equal(withoutNf.overdueTitles[0]!.externalId, 2);
  });

  it("filtro faixa de atraso e mínimo de dias", () => {
    const rows = [
      arRow({ externalId: 1, dueDate: new Date(2026, 5, 16), balanceReceivable: 100 }),
      arRow({ externalId: 2, dueDate: new Date(2026, 4, 1), balanceReceivable: 900 }),
    ];
    const payload = buildFinanceArOverduePayload(
      rows,
      { status: "all", year: 2026, minDaysOverdue: 30 },
      REF,
      cutoff(),
      { paginate: false }
    );
    assert.equal(payload.summary.overdueTitlesCount, 1);
    assert.equal(payload.overdueTitles[0]!.externalId, 2);
  });

  it("paridade: total vencido bate com dashboard AR nos mesmos filtros", () => {
    const rows = [
      arRow({ externalId: 1, balanceReceivable: 1200 }),
      arRow({ externalId: 2, syncedAt: STALE_SYNC, balanceReceivable: 5000 }),
      arRow({ externalId: 3, dueDate: new Date(2026, 6, 1), balanceReceivable: 300 }),
    ];
    const filters = { status: "all" as const, year: 2026, month: 6 };
    const dash = buildFinanceAccountsReceivableDashboard(rows, filters, REF, cutoff());
    const overdueTotal = sumFinanceArOverdueOpenAmount(rows, filters, REF, cutoff());
    assert.equal(overdueTotal, dash.cards.overdueAmount);
  });

  it("título mapeado inclui faixa de aging", () => {
    const payload = buildFinanceArOverduePayload(
      [arRow({ externalId: 1, dueDate: new Date(2026, 5, 10) })],
      { status: "all", year: 2026 },
      REF,
      cutoff(),
      { paginate: false }
    );
    assert.equal(payload.overdueTitles[0]!.agingLabel, resolveOverdueAgingLabel(7));
  });

  it("export XLSX gera bytes e abas esperadas", () => {
    const rows = [arRow({ externalId: 1 })];
    const payload = buildFinanceArOverduePayload(
      rows,
      { status: "all", year: 2026 },
      REF,
      cutoff(),
      { paginate: false }
    );
    const wb = buildFinanceArOverdueExportWorkbook(payload, payload.overdueTitles);
    assert.ok(wb.SheetNames.includes("Resumo"));
    assert.ok(wb.SheetNames.includes("Títulos Atrasados"));
    assert.ok(wb.SheetNames.includes("Ranking Clientes"));
    assert.ok(wb.SheetNames.includes("Aging"));
    assert.ok(wb.SheetNames.includes("Filtros Aplicados"));
    const bytes = financeArOverdueWorkbookToBytes(wb);
    assert.ok(bytes.byteLength > 100);
  });
});

describe("financeAccountsReceivableOverdue print", () => {
  it("período de impressão usa ano completo quando só ano informado", () => {
    const period = formatArOverduePrintPeriod({
      companyName: "",
      personName: "",
      personCnpj: "",
      status: "all",
      year: "2026",
      month: "",
      dueDateFrom: "",
      dueDateTo: "",
      invoiceIssued: "all",
      paymentMethodName: "",
      bankAccountName: "",
    });
    assert.equal(period, "01/01/2026 a 31/12/2026");
  });

  it("agrupamento por cliente preserva total vencido do payload", () => {
    const rows = [
      arRow({
        externalId: 1,
        personName: "Cliente A",
        personCnpj: "11.111.111/0001-11",
        balanceReceivable: 800,
      }),
      arRow({
        externalId: 2,
        personName: "Cliente A",
        personCnpj: "11.111.111/0001-11",
        balanceReceivable: 200,
      }),
      arRow({
        externalId: 3,
        personName: "Cliente B",
        personCnpj: "22.222.222/0001-22",
        balanceReceivable: 1100,
      }),
    ];
    const payload = buildFinanceArOverduePayload(
      rows,
      { status: "all", year: 2026 },
      REF,
      cutoff(),
      { paginate: false }
    );
    const groups = groupArOverdueTitlesByCustomer(payload.overdueTitles);
    const groupedTotal = groups.reduce((sum, g) => sum + g.totalOverdue, 0);
    assert.equal(groupedTotal, payload.summary.totalOverdueAmount);
  });
});

describe("FinanceAccountsReceivableOverdue UI", () => {
  it("página AR inclui aba Atrasados e botões de exportação/impressão", () => {
    const page = readFileSync(
      join(process.cwd(), "src/components/finance/FinanceAccountsReceivablePage.tsx"),
      "utf8"
    );
    const tab = readFileSync(
      join(process.cwd(), "src/components/finance/FinanceAccountsReceivableOverdueTab.tsx"),
      "utf8"
    );
    const printDoc = readFileSync(
      join(process.cwd(), "src/components/finance/FinanceAccountsReceivableOverduePrintDocument.tsx"),
      "utf8"
    );
    const printMeta = readFileSync(
      join(process.cwd(), "src/lib/financeAccountsReceivableOverduePrintMeta.ts"),
      "utf8"
    );
    const types = readFileSync(
      join(process.cwd(), "src/lib/financeAccountsReceivableDashboardTypes.ts"),
      "utf8"
    );
    assert.ok(types.includes('"overdue"') && types.includes("Atrasados"));
    assert.ok(page.includes('activeTab === "overdue"'));
    assert.ok(tab.includes("Exportar Excel"));
    assert.ok(tab.includes("Imprimir / PDF"));
    assert.ok(tab.includes("buildFinanceArOverdueExportQuery"));
    assert.ok(tab.includes("createPortal"));
    assert.ok(tab.includes("ar-overdue-print-route"));
    assert.ok(tab.includes("ar-overdue-no-print"));
    assert.ok(printMeta.includes("Relatório de Contas a Receber em Atraso"));
    assert.ok(printMeta.includes("Documento de apoio ao processo de cobrança"));
    assert.ok(printDoc.includes("FINANCE_AR_OVERDUE_PRINT_TITLE"));
    assert.ok(printDoc.includes("Resumo executivo"));
    assert.ok(printDoc.includes("Clientes prioritários para cobrança"));
    assert.ok(printDoc.includes("Detalhamento dos títulos vencidos"));
    assert.ok(printDoc.includes("Total vencido"));
    assert.ok(printDoc.includes("Forma pgto."));
    assert.ok(printDoc.includes("Vencimento"));
    assert.ok(printDoc.includes("Dias"));
    assert.ok(printDoc.includes("Aging"));
    assert.ok(printDoc.includes("Valor original"));
    assert.ok(printDoc.includes("Valor recebido"));
    assert.ok(printDoc.includes("Saldo em aberto"));
    assert.ok(printDoc.includes('id="ar-overdue-print-root"'));
    assert.ok(!printDoc.includes("overflow-auto"));
    assert.ok(!printDoc.includes("overflow-x-auto"));
    assert.ok(!printDoc.includes("overflow-y-auto"));
    assert.ok(!printDoc.includes("max-h-"));
    assert.ok(!printDoc.includes("sticky"));
    const printCss = readFileSync(
      join(process.cwd(), "src/components/finance/finance-ar-overdue-print.css"),
      "utf8"
    );
    assert.ok(printCss.includes("@page"));
    assert.ok(printCss.includes("A4 landscape"));
    assert.ok(printCss.includes("overflow: visible"));
    assert.ok(printCss.includes("ar-overdue-no-print"));
    assert.ok(printCss.includes("table-header-group"));
    assert.ok(printCss.includes("table-layout: fixed"));
  });
});
