/**
 * Fluxo de Caixa — caixa REALIZADO que cruza o ano do filtro.
 *
 * A tela aloca o realizado por `settlementDate` (data de baixa) e o
 * aberto/previsto por `dueDate` (vencimento). A população AR, porém, era
 * carregada e refiltrada SÓ por `dueDate` dentro do ano filtrado: uma baixa
 * ocorrida em 2026 de título vencido em 2025 não aparecia em 2026 (vencimento
 * fora do ano) nem em 2025 (baixa fora do ano) — sumia das duas telas.
 *
 * Este arquivo cobre os dois níveis em que o defeito acontece:
 *   1. formação da população (WHERE do Prisma montado para a carga do Fluxo);
 *   2. refiltro em memória da soma do realizado (timeline mensal / YTD).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceArPrismaWhere,
  resolveFinanceArDueDateBounds,
  type FinanceArDashboardRow,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import {
  buildFinanceCashFlowDashboard,
  parseFinanceCashFlowDashboardFilters,
  resolveCashFlowArSettlementLoadWindow,
  splitCashFlowArRowsBySettlementOnlyWindow,
  toArLoadFilters,
  type FinanceCashFlowArRow,
} from "@/src/lib/financeCashFlowDashboard.js";
import {
  buildExecutiveMonthlyTimeline,
  buildFinanceCashFlowExecutiveSummary,
} from "@/src/lib/financeCashFlowExecutiveSummary.js";
import { buildFinanceAccountsReceivableDashboard } from "@/src/lib/financeAccountsReceivableDashboard.js";

/** Fim do ano filtrado: YTD cobre 01/01/2026 a 31/12/2026. */
const REF = new Date(2026, 11, 31, 12, 0, 0, 0);
const CF_FILTERS = parseFinanceCashFlowDashboardFilters({ year: "2026" });
const AR_FILTERS = toArLoadFilters(CF_FILTERS);
const PERIOD = {
  inflowAmount: 0,
  outflowAmount: 0,
  netFlowAmount: 0,
  accumulatedBalance: 0,
};

/* ─────────────────── avaliador mínimo de WHERE do Prisma ───────────────────
 * Só entende os operadores que `buildFinanceArPrismaWhere` realmente emite.
 * Qualquer chave/operador desconhecido lança — assim o teste não passa por
 * ignorar silenciosamente uma cláusula que ele deveria ter avaliado.
 */

function toTime(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return null;
}

function matchesFieldCondition(actual: unknown, condition: unknown): boolean {
  if (condition === null) return actual === null || actual === undefined;
  if (condition instanceof Date) return toTime(actual) === condition.getTime();
  if (typeof condition !== "object") return actual === condition;

  for (const [op, expected] of Object.entries(condition as Record<string, unknown>)) {
    const actualTime = toTime(actual);
    const expectedTime = toTime(expected);
    switch (op) {
      case "equals":
        if (!matchesFieldCondition(actual, expected)) return false;
        break;
      case "not":
        if (expected === null) {
          if (actual === null || actual === undefined) return false;
        } else if (matchesFieldCondition(actual, expected)) {
          return false;
        }
        break;
      case "gt":
        if (actualTime === null || expectedTime === null || !(actualTime > expectedTime)) return false;
        break;
      case "gte":
        if (actualTime === null || expectedTime === null || !(actualTime >= expectedTime)) return false;
        break;
      case "lt":
        if (actualTime === null || expectedTime === null || !(actualTime < expectedTime)) return false;
        break;
      case "lte":
        if (actualTime === null || expectedTime === null || !(actualTime <= expectedTime)) return false;
        break;
      case "in":
        if (!Array.isArray(expected) || !expected.some((v) => matchesFieldCondition(actual, v))) return false;
        break;
      case "contains":
        if (
          typeof actual !== "string" ||
          typeof expected !== "string" ||
          !actual.toLowerCase().includes(expected.toLowerCase())
        ) {
          return false;
        }
        break;
      case "mode":
        break;
      default:
        throw new Error(`avaliador de WHERE não suporta o operador "${op}"`);
    }
  }
  return true;
}

function matchesPrismaWhere(row: Record<string, unknown>, where: unknown): boolean {
  if (where == null) return true;
  if (typeof where !== "object") throw new Error("WHERE inesperado");
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (key === "AND") {
      if (!(value as unknown[]).every((clause) => matchesPrismaWhere(row, clause))) return false;
      continue;
    }
    if (key === "OR") {
      if (!(value as unknown[]).some((clause) => matchesPrismaWhere(row, clause))) return false;
      continue;
    }
    if (key === "NOT") {
      if (matchesPrismaWhere(row, value)) return false;
      continue;
    }
    if (!(key in row)) {
      throw new Error(`avaliador de WHERE não conhece o campo "${key}"`);
    }
    if (!matchesFieldCondition(row[key], value)) return false;
  }
  return true;
}

/* ───────────────────────────── fixture ───────────────────────────── */

function arRow(
  partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">
): FinanceCashFlowArRow {
  return {
    companyName: "KOPPETEL",
    personId: 501,
    personName: "Cliente Teste SA",
    personCnpj: "11222333000181",
    description: null,
    comments: null,
    dueDate: null,
    competenceDate: null,
    settlementDate: null,
    amountReceivable: 0,
    amountReceived: 0,
    balanceReceivable: 0,
    paymentMethodName: "Depósito Bancário",
    bankAccountName: "Bradesco",
    sourceInvoiceId: partial.externalId,
    sourceInvoiceNumber: String(partial.externalId),
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: REF,
    sourcePresenceStatus: "PRESENT",
    ...partial,
  } as FinanceCashFlowArRow;
}

/** Caso principal — vencido em 2025, recebido em jan/2026. */
const CASE_A = arRow({
  externalId: 9001,
  dueDate: new Date(2025, 11, 20),
  settlementDate: new Date(2026, 0, 10),
  amountReceivable: 10000,
  amountReceived: 10000,
  balanceReceivable: 0,
});

/** Controle B — vencimento e baixa no mesmo ano/mês. */
const CASE_B = arRow({
  externalId: 9002,
  dueDate: new Date(2026, 0, 5),
  settlementDate: new Date(2026, 0, 10),
  amountReceivable: 20000,
  amountReceived: 20000,
  balanceReceivable: 0,
});

/** Controle C — vencido em 2025 e ainda ABERTO: não pertence a 2026. */
const CASE_C = arRow({
  externalId: 9003,
  dueDate: new Date(2025, 11, 20),
  settlementDate: null,
  amountReceivable: 10000,
  amountReceived: 0,
  balanceReceivable: 10000,
});

/** Controle D — vencimento em 2027, baixa antecipada em dez/2026. */
const CASE_D = arRow({
  externalId: 9004,
  dueDate: new Date(2027, 0, 10),
  settlementDate: new Date(2026, 11, 20),
  amountReceivable: 5000,
  amountReceived: 5000,
  balanceReceivable: 0,
});

/** Controle E — vencimento em 2026, baixa só em jan/2027. */
const CASE_E = arRow({
  externalId: 9005,
  dueDate: new Date(2026, 11, 20),
  settlementDate: new Date(2027, 0, 10),
  amountReceivable: 15000,
  amountReceived: 15000,
  balanceReceivable: 0,
});

const ALL_ROWS: FinanceCashFlowArRow[] = [CASE_A, CASE_B, CASE_C, CASE_D, CASE_E];

/** Reproduz a carga real: WHERE do Fluxo aplicado sobre a base completa. */
function loadCashFlowArRows(): FinanceCashFlowArRow[] {
  const where = buildFinanceArPrismaWhere(AR_FILTERS, REF, null, {
    settlementWindow: resolveCashFlowArSettlementLoadWindow(CF_FILTERS),
  });
  return ALL_ROWS.filter((row) =>
    matchesPrismaWhere(row as unknown as Record<string, unknown>, where)
  );
}

function timelineFor(rows: FinanceCashFlowArRow[]) {
  const { periodRows, settlementOnlyRows } = splitCashFlowArRowsBySettlementOnlyWindow(
    rows,
    CF_FILTERS
  );
  return buildFinanceCashFlowExecutiveSummary(
    [...periodRows, ...settlementOnlyRows],
    [],
    CF_FILTERS,
    REF,
    PERIOD,
    null,
    null,
    { orderContexts: [], nfeOrderLinks: [] }
  );
}

/* ───────────────────────────── testes ───────────────────────────── */

describe("Fluxo de Caixa — baixa que cruza o ano do filtro", () => {
  it("1. população: o WHERE do Fluxo/2026 recupera o título vencido em 2025 e baixado em 2026", () => {
    const loaded = loadCashFlowArRows();
    const ids = loaded.map((r) => r.externalId).sort((a, b) => a - b);

    assert.ok(
      ids.includes(9001),
      "título vencido em 20/12/2025 e baixado em 10/01/2026 precisa entrar na carga de 2026"
    );
    assert.ok(ids.includes(9004), "baixa antecipada de dez/2026 (venc. 2027) precisa entrar");
    assert.deepEqual(ids, [9001, 9002, 9004, 9005], "sem título aberto de 2025 (caso C)");
  });

  it("2. população: título que casa pelas duas condições aparece uma única vez", () => {
    const loaded = loadCashFlowArRows();
    const ids = loaded.map((r) => r.externalId);
    assert.equal(
      ids.filter((id) => id === 9002).length,
      1,
      "venc. e baixa em 2026 não pode duplicar"
    );
    assert.equal(new Set(ids).size, ids.length);
  });

  it("3. população: a divisão preserva a carteira por vencimento", () => {
    const { periodRows, settlementOnlyRows } = splitCashFlowArRowsBySettlementOnlyWindow(
      loadCashFlowArRows(),
      CF_FILTERS
    );
    assert.deepEqual(
      periodRows.map((r) => r.externalId).sort((a, b) => a - b),
      [9002, 9005],
      "carteira/previsão continua sendo só o que vence dentro do filtro"
    );
    assert.deepEqual(
      settlementOnlyRows.map((r) => r.externalId).sort((a, b) => a - b),
      [9001, 9004],
      "linhas extras existem só por causa da data de baixa"
    );
  });

  it("4. timeline mensal: janeiro/2026 soma a baixa do título vencido em 2025", () => {
    const summary = timelineFor(loadCashFlowArRows());
    const jan = summary.monthlyTimeline.find((m) => m.month === 1);
    assert.ok(jan);
    assert.equal(jan!.received, 30000, "10.000 (venc. 2025) + 20.000 (venc. 2026)");
    assert.equal(jan!.receivableOpenDue, 0, "nada aberto vencendo em jan/2026");
    assert.equal(jan!.estimatedInflow, 30000);
  });

  it("5. timeline mensal: baixa antecipada entra em dezembro/2026 (eixo settlementDate)", () => {
    const summary = timelineFor(loadCashFlowArRows());
    const dez = summary.monthlyTimeline.find((m) => m.month === 12);
    assert.ok(dez);
    assert.equal(dez!.received, 5000, "venc. 2027 baixado em 20/12/2026");
    assert.equal(
      dez!.receivableOpenDue,
      0,
      "título de dez/2026 está quitado; nada em aberto no mês"
    );
  });

  it("6. timeline mensal: baixa de 2027 não conta em nenhum mês de 2026", () => {
    const summary = timelineFor(loadCashFlowArRows());
    const total = summary.monthlyTimeline.reduce((sum, m) => sum + m.received, 0);
    assert.equal(total, 35000, "10.000 + 20.000 + 5.000 — o título 9005 fica fora");
  });

  it("7. YTD: recebido e estimativa do ano incluem a baixa cross-year", () => {
    const summary = timelineFor(loadCashFlowArRows());
    assert.equal(summary.receivable.receivedYtd, 35000);
    assert.equal(
      summary.receivable.estimatedYearTotal,
      35000 + summary.receivable.openFromTodayToYearEnd
    );
  });

  it("8. aberto/previsão continua ancorado no vencimento (caso C fora de 2026)", () => {
    // Entra direto no resumo executivo, sem passar pela divisão: prova que quem
    // rejeita a linha é o eixo `dueDate` do aberto, não o recorte da carga.
    const summary = buildFinanceCashFlowExecutiveSummary(
      [...loadCashFlowArRows(), CASE_C],
      [],
      CF_FILTERS,
      REF,
      PERIOD,
      null,
      null,
      { orderContexts: [], nfeOrderLinks: [] }
    );
    const openByMonth = summary.monthlyTimeline.reduce(
      (sum, m) => sum + m.receivableOpenDue,
      0
    );
    assert.equal(
      openByMonth,
      0,
      "título vencido em 2025 e ainda aberto não pode virar previsão de 2026"
    );
    assert.equal(
      summary.receivable.openFromTodayToYearEnd,
      0,
      "nem entrar no A receber restante no ano"
    );
  });

  it("9. refiltro em memória: a soma do realizado não recorta por vencimento", () => {
    const timeline = buildExecutiveMonthlyTimeline(ALL_ROWS, [], 2026, REF, {
      filters: CF_FILTERS,
      arSyncCutoff: null,
      apSyncCutoff: null,
    });
    const jan = timeline.find((m) => m.month === 1);
    assert.ok(jan);
    assert.equal(
      jan!.received,
      30000,
      "mesmo com a linha em mãos, o refiltro por dueDate não pode descartá-la"
    );
  });

  it("11. dashboard: linhas extras corrigem o realizado sem entrar na carteira aberta", () => {
    const loaded = loadCashFlowArRows();
    const { periodRows, settlementOnlyRows } = splitCashFlowArRowsBySettlementOnlyWindow(
      loaded,
      CF_FILTERS
    );
    const openRow = arRow({
      externalId: 9006,
      dueDate: new Date(2026, 5, 15),
      settlementDate: null,
      amountReceivable: 7000,
      amountReceived: 0,
      balanceReceivable: 7000,
    });

    const payload = buildFinanceCashFlowDashboard(
      [...periodRows, openRow],
      [],
      CF_FILTERS,
      REF,
      null,
      null,
      { orderContexts: [], nfeOrderLinks: [], arRealizedOnlyRows: settlementOnlyRows }
    );

    const jan = payload.executiveSummary.monthlyTimeline.find((m) => m.month === 1);
    assert.equal(jan?.received, 30000, "realizado de janeiro enxerga a baixa cross-year");
    assert.equal(
      payload.cards.totalReceivableOpen,
      7000,
      "carteira aberta segue só com o título aberto que vence dentro do filtro"
    );
  });

  it("12. dashboard: sem as linhas extras o resultado é o de hoje (mudança isolada)", () => {
    const { periodRows } = splitCashFlowArRowsBySettlementOnlyWindow(
      loadCashFlowArRows(),
      CF_FILTERS
    );
    const payload = buildFinanceCashFlowDashboard(periodRows, [], CF_FILTERS, REF, null, null, {
      orderContexts: [],
      nfeOrderLinks: [],
    });
    const jan = payload.executiveSummary.monthlyTimeline.find((m) => m.month === 1);
    assert.equal(jan?.received, 20000, "sem arRealizedOnlyRows nada além do vencimento entra");
  });

  it("13. com filtro de mês, só entram baixas de títulos vencidos FORA do ano", () => {
    const monthFilters = parseFinanceCashFlowDashboardFilters({ year: "2026", month: "1" });
    const openInJune = arRow({
      externalId: 9007,
      dueDate: new Date(2026, 5, 15),
      settlementDate: new Date(2026, 0, 20),
      amountReceivable: 9000,
      amountReceived: 4000,
      balanceReceivable: 5000,
    });
    const { periodRows, settlementOnlyRows } = splitCashFlowArRowsBySettlementOnlyWindow(
      [...ALL_ROWS, openInJune],
      monthFilters
    );

    assert.deepEqual(
      periodRows.map((r) => r.externalId).sort((a, b) => a - b),
      [9002],
      "carteira do mês filtrado permanece intacta"
    );
    assert.deepEqual(
      settlementOnlyRows.map((r) => r.externalId).sort((a, b) => a - b),
      [9001, 9004],
      "título com vencimento dentro do ano (jun/2026) não pode virar previsão de outro mês"
    );
  });

  it("10. card legado do CR por vencimento permanece; KPI Recebido usa settlementDate", () => {
    const crRows = ALL_ROWS.filter((row) => {
      const { from, toExclusive } = resolveFinanceArDueDateBounds({
        year: 2026,
        month: 1,
      });
      const due = row.dueDate?.getTime() ?? null;
      return due != null && due >= from!.getTime() && due < toExclusive!.getTime();
    });
    const dashboard = buildFinanceAccountsReceivableDashboard(
      crRows,
      { status: "all", year: 2026, month: 1 },
      REF,
      null
    );
    assert.equal(
      dashboard.cards.totalReceivedAmount,
      20000,
      "cards.totalReceivedAmount continua sendo a safra de vencimento (outro conceito)"
    );
  });
});
