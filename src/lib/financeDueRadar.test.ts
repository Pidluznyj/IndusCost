import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { civilDateToLocalDate, toCivilDateKey } from "./financeCivilDate.js";
import {
  buildFinanceArDueRadar,
  buildFinanceApDueRadar,
  collectArDueRadarMovements,
  collectApDueRadarMovements,
} from "./financeDueRadar.js";
import type { FinanceCashFlowApRow, FinanceCashFlowArRow } from "./financeCashFlowDashboard.js";
import { stripDueRadarPeriodFilters } from "./financeDueRadarFilters.js";

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personId: 10,
    personName: "Cliente X",
    personCnpj: null,
    description: "NF 123",
    comments: null,
    dueDate: civilDateToLocalDate("2026-07-20"),
    competenceDate: null,
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: 123,
    sourceInvoiceNumber: "NF-123",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: new Date(),
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 2,
    companyName: "Empresa B",
    personName: "Fornecedor Y",
    personCnpj: null,
    description: "Material industrial",
    dueDate: civilDateToLocalDate("2026-07-20"),
    scheduleDate: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: null,
    bankAccountName: null,
    documentNumber: "DOC-9",
    sourceInvoiceId: null,
    suspendPayment: false,
    nomusStatus: true,
    type: null,
    syncedAt: new Date(),
    ...overrides,
  };
}

describe("financeDueRadar engine", () => {
  const baseDate = civilDateToLocalDate("2026-06-24")!;

  it("AR: faixas agregam valor e quantidade", () => {
    const rows = [
      arRow({ externalId: 1, dueDate: civilDateToLocalDate("2026-06-20"), balanceReceivable: 100 }),
      arRow({ externalId: 2, dueDate: civilDateToLocalDate("2026-06-28"), balanceReceivable: 200 }),
    ];
    const payload = buildFinanceArDueRadar(rows, { baseDate }, baseDate);
    const overdue = payload.ranges.find((r) => r.key === "overdue");
    const next7 = payload.ranges.find((r) => r.key === "0-7");
    assert.ok(overdue);
    assert.ok(next7);
    assert.equal(overdue!.titleCount, 1);
    assert.equal(overdue!.totalAmount, 100);
    assert.equal(next7!.titleCount, 1);
    assert.equal(next7!.totalAmount, 200);
  });

  it("AP: faixas agregam valor e quantidade", () => {
    const rows = [
      apRow({ externalId: 1, dueDate: civilDateToLocalDate("2026-06-20"), balancePayable: 300 }),
      apRow({ externalId: 2, dueDate: civilDateToLocalDate("2026-06-30"), balancePayable: 400 }),
    ];
    const payload = buildFinanceApDueRadar(rows, { baseDate }, baseDate);
    assert.equal(payload.mode, "payable");
    assert.equal(payload.ranges.find((r) => r.key === "overdue")!.totalAmount, 300);
    assert.equal(payload.ranges.find((r) => r.key === "0-7")!.totalAmount, 400);
  });

  it("drill-down por faixa e dia retorna somente AR", () => {
    const rows = [arRow({ externalId: 1, dueDate: civilDateToLocalDate("2026-06-28"), personName: "ACME" })];
    const payload = buildFinanceArDueRadar(
      rows,
      { baseDate, rangeKey: "0-7", day: "2026-06-28", search: "acme" },
      baseDate
    );
    assert.ok(payload.selectedDetail?.receivables);
    assert.equal(payload.selectedDetail?.payables, undefined);
    assert.equal(payload.selectedDetail?.receivables?.rows.length, 1);
    assert.match(payload.selectedDetail!.receivables!.rows[0]!.customer ?? "", /ACME/);
  });

  it("drill-down retorna somente AP", () => {
    const rows = [apRow({ externalId: 1, dueDate: civilDateToLocalDate("2026-06-28"), description: "Parafuso" })];
    const payload = buildFinanceApDueRadar(
      rows,
      { baseDate, rangeKey: "0-7", day: "2026-06-28", search: "parafuso" },
      baseDate
    );
    assert.ok(payload.selectedDetail?.payables);
    assert.equal(payload.selectedDetail?.receivables, undefined);
    assert.equal(payload.selectedDetail?.payables?.rows.length, 1);
  });

  it("data civil não desloca vencimento 20/07", () => {
    const row = arRow({ dueDate: civilDateToLocalDate("2026-07-20") });
    const movements = collectArDueRadarMovements([row], baseDate);
    assert.equal(movements.length, 1);
    assert.equal(toCivilDateKey(movements[0]!.operationalDate), "2026-07-20");
  });

  it("AP usa data operacional oficial", () => {
    const row = apRow({ dueDate: civilDateToLocalDate("2026-07-20") });
    const movements = collectApDueRadarMovements([row], baseDate);
    assert.equal(toCivilDateKey(movements[0]!.operationalDate), "2026-07-20");
  });

  it("remove ano/mês dos filtros do radar", () => {
    const stripped = stripDueRadarPeriodFilters({ status: "open" as const, year: 2026, month: 6 });
    assert.equal(stripped.year, undefined);
    assert.equal(stripped.month, undefined);
    assert.equal(stripped.status, "open");
  });

  it("não retorna NaN nos totais", () => {
    const payload = buildFinanceArDueRadar([], { baseDate }, baseDate);
    for (const range of payload.ranges) {
      assert.ok(Number.isFinite(range.totalAmount));
      assert.ok(Number.isFinite(range.titleCount));
    }
  });
});

describe("financeDueRadar UI wiring", () => {
  function read(rel: string): string {
    return readFileSync(join(process.cwd(), rel), "utf8");
  }

  it("Radar de Recebimentos na página AR", () => {
    const page = read("src/components/finance/FinanceAccountsReceivablePage.tsx");
    assert.match(page, /FinanceDueRadar/);
    assert.match(page, /mode="receivable"/);
    assert.match(read("src/lib/financeDueRadarApi.ts"), /ar-due-radar/);
  });

  it("Radar de Pagamentos na página AP", () => {
    const page = read("src/components/finance/FinanceAccountsPayablePage.tsx");
    assert.match(page, /FinanceDueRadar/);
    assert.match(page, /mode="payable"/);
    assert.match(read("src/lib/financeDueRadarApi.ts"), /ap-due-radar/);
  });

  it("componente não recalcula margem e usa API dedicada", () => {
    const radar = read("src/components/finance/due-radar/FinanceDueRadar.tsx");
    assert.match(radar, /buildDueRadarApiUrl/);
    assert.match(radar, /due-radar-export-excel/);
    assert.match(radar, /due-radar-export-pdf/);
    assert.doesNotMatch(radar, /buildFinanceCashFlowDailyRadar/);
  });

  it("Fluxo de Caixa original intacto", () => {
    assert.match(read("src/components/finance/FinanceCashFlowPage.tsx"), /FinanceCashFlowDailyRadar/);
    assert.match(read("src/lib/financeCashFlowDailyRadar.ts"), /buildFinanceCashFlowDailyRadar/);
  });

  it("rotas due-radar registradas", () => {
    assert.match(read("server.ts"), /registerFinanceArDueRadarRoutes/);
    assert.match(read("server.ts"), /registerFinanceApDueRadarRoutes/);
    assert.match(read("src/lib/financeDueRadarRoutes.ts"), /accounts-receivable\/due-radar/);
    assert.match(read("src/lib/financeDueRadarRoutes.ts"), /accounts-payable\/due-radar/);
  });
});
