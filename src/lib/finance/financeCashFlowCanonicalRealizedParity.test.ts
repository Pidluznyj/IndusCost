/**
 * Paridade de POPULAÇÃO — conjuntos canônicos do realizado × linha do tempo
 * mensal do Fluxo de Caixa.
 *
 * Contrato provado aqui (declarado em dois lugares no código):
 *   - `financeCashFlowCanonicalRealized.server.ts` (cabeçalho): expõe
 *     "exatamente os MESMOS conjuntos que alimentam a Linha do tempo mensal";
 *     somar `amountReceived` por `settlementDate` sobre eles "reproduz, por
 *     construção, os números Recebido/Pago daquela tela".
 *   - `treasuryCaixaService.server.ts` (getBoard): "MESMA população de títulos
 *     (CR/CP) que a Linha do tempo mensal do Fluxo de Caixa carrega".
 *
 * O contrato é de POPULAÇÃO. O consumo da Tesouraria continua desacoplado de
 * propósito (data efetiva com a regra dos N dias no CR, vencimento no CP) —
 * nada disso é alterado aqui.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { FinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";
import {
  parseFinanceCashFlowDashboardFilters,
  resolveCashFlowArSettlementLoadWindow,
  splitCashFlowArRowsBySettlementOnlyWindow,
  type FinanceCashFlowArRow,
} from "@/src/lib/financeCashFlowDashboard.js";
import { buildFinanceCashFlowExecutiveSummary } from "@/src/lib/financeCashFlowExecutiveSummary.js";
import { deriveFinanceCashFlowCanonicalRealizedYearSets } from "./financeCashFlowCanonicalRealized.server.js";
import { buildTreasuryCaixaCanonicalRealizedInputs } from "@/src/lib/treasury/services/treasuryCaixaService.server.js";
import { FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS } from "./financeSettlementReconciliation.js";

const REF = new Date(2026, 11, 31, 12, 0, 0, 0);
const YEAR = 2026;
const CF_FILTERS = parseFinanceCashFlowDashboardFilters({ year: String(YEAR) });
const AR_OPTIONS = { orderContexts: [], nfeOrderLinks: [] };
const PERIOD = {
  inflowAmount: 0,
  outflowAmount: 0,
  netFlowAmount: 0,
  accumulatedBalance: 0,
};

function arRow(
  partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">
): FinanceCashFlowArRow {
  return {
    companyName: "KOPPETEL",
    personId: 700,
    personName: "Cliente Paridade SA",
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

/** Vencido em 2025, baixado em jan/2026 — o caso do bug cross-year. */
const CROSS_YEAR_BEFORE = arRow({
  externalId: 8101,
  dueDate: new Date(2025, 11, 20),
  settlementDate: new Date(2026, 0, 10),
  amountReceivable: 10000,
  amountReceived: 10000,
  balanceReceivable: 0,
});

/** Vencimento e baixa no mesmo ano — controle de não-regressão. */
const SAME_YEAR = arRow({
  externalId: 8102,
  dueDate: new Date(2026, 0, 5),
  settlementDate: new Date(2026, 0, 10),
  amountReceivable: 20000,
  amountReceived: 20000,
  balanceReceivable: 0,
});

/** Aberto, vencido em 2025 — não pode virar realizado nem previsão de 2026. */
const OPEN_PREVIOUS_YEAR = arRow({
  externalId: 8103,
  dueDate: new Date(2025, 11, 20),
  settlementDate: null,
  amountReceivable: 10000,
  amountReceived: 0,
  balanceReceivable: 10000,
});

/** Vencimento em 2027, baixa antecipada em dez/2026. */
const CROSS_YEAR_AFTER = arRow({
  externalId: 8104,
  dueDate: new Date(2027, 0, 10),
  settlementDate: new Date(2026, 11, 20),
  amountReceivable: 5000,
  amountReceived: 5000,
  balanceReceivable: 0,
});

/** Vencimento em 2026, baixa só em 2027 — fora do realizado de 2026. */
const SETTLED_NEXT_YEAR = arRow({
  externalId: 8105,
  dueDate: new Date(2026, 11, 20),
  settlementDate: new Date(2027, 0, 10),
  amountReceivable: 15000,
  amountReceived: 15000,
  balanceReceivable: 0,
});

/** Cross-year do GRUPO INTERNO — saneamento gerencial precisa continuar excluindo. */
const CROSS_YEAR_INTERNAL_GROUP = arRow({
  externalId: 8106,
  personName: "KOPPETEL COMERCIO DE PLASTICOS LTDA",
  personCnpj: "14055501000180",
  dueDate: new Date(2025, 11, 22),
  settlementDate: new Date(2026, 0, 15),
  amountReceivable: 77000,
  amountReceived: 77000,
  balanceReceivable: 0,
});

const BASE_ROWS: FinanceCashFlowArRow[] = [
  CROSS_YEAR_BEFORE,
  SAME_YEAR,
  OPEN_PREVIOUS_YEAR,
  CROSS_YEAR_AFTER,
  SETTLED_NEXT_YEAR,
  CROSS_YEAR_INTERNAL_GROUP,
];

function canonicalSets(rows: FinanceCashFlowArRow[] = BASE_ROWS) {
  return deriveFinanceCashFlowCanonicalRealizedYearSets({
    year: YEAR,
    referenceDate: REF,
    arRows: rows,
    arSyncCutoff: null,
    orderContexts: [],
    nfeOrderLinks: [],
    apRows: [],
    apSyncCutoff: null,
  });
}

function cashFlowSummary(rows: FinanceCashFlowArRow[] = BASE_ROWS) {
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
    AR_OPTIONS
  );
}

/** Soma canônica do realizado: `amountReceived` por `settlementDate` no mês. */
function canonicalReceivedInMonth(
  sets: ReturnType<typeof canonicalSets>,
  month: number
): number {
  let total = 0;
  for (const row of sets.arReceivedRows) {
    if (!row.settlementDate) continue;
    if (row.settlementDate.getFullYear() !== YEAR) continue;
    if (row.settlementDate.getMonth() + 1 !== month) continue;
    total += row.amountReceived;
  }
  return Math.round(total * 100) / 100;
}

describe("paridade — conjuntos canônicos do realizado × linha do tempo do Fluxo", () => {
  it("1. os 12 meses batem: canonical realized === Recebido da linha do tempo", () => {
    const sets = canonicalSets();
    const summary = cashFlowSummary();
    for (const row of summary.monthlyTimeline) {
      assert.equal(
        canonicalReceivedInMonth(sets, row.month),
        row.received,
        `mês ${row.month}: população canônica divergiu do Recebido da tela`
      );
    }
  });

  it("2. cross-year anterior entra em jan/2026 nos dois lados", () => {
    const sets = canonicalSets();
    const summary = cashFlowSummary();
    assert.equal(summary.monthlyTimeline.find((m) => m.month === 1)?.received, 30000);
    assert.equal(canonicalReceivedInMonth(sets, 1), 30000);
    assert.ok(
      sets.arReceivedRows.some((r) => r.externalId === 8101),
      "título vencido em 2025 e baixado em 2026 precisa estar na população canônica"
    );
  });

  it("3. antecipação (venc. 2027, baixa dez/2026) entra em dez/2026 nos dois lados", () => {
    const sets = canonicalSets();
    const summary = cashFlowSummary();
    assert.equal(summary.monthlyTimeline.find((m) => m.month === 12)?.received, 5000);
    assert.equal(canonicalReceivedInMonth(sets, 12), 5000);
  });

  it("4. baixa em 2027 não entra no realizado de 2026", () => {
    const sets = canonicalSets();
    const summary = cashFlowSummary();
    assert.equal(summaryTotal(sets), 35000, "8105 fica fora; 8101 + 8102 + 8104 entram");
    assert.equal(
      summary.monthlyTimeline.reduce((sum, m) => sum + m.received, 0),
      35000
    );
  });

  it("5. título aberto sem baixa não vira realizado", () => {
    const sets = canonicalSets();
    const openRow = sets.arReceivedRows.find((r) => r.externalId === 8103);
    if (openRow) {
      assert.equal(openRow.amountReceived, 0, "linha aberta não pode somar realizado");
    }
    assert.equal(summaryTotal(sets), 35000);
  });

  it("6. saneamento gerencial continua excluindo cross-year do grupo interno", () => {
    const sets = canonicalSets();
    assert.ok(
      !sets.arReceivedRows.some((r) => r.externalId === 8106),
      "título intercompany não pode entrar só porque foi baixado no ano"
    );
    const summary = cashFlowSummary();
    assert.equal(
      summary.monthlyTimeline.find((m) => m.month === 1)?.received,
      30000,
      "77.000 do grupo interno não podem aparecer na tela"
    );
  });

  it("7. título que casa pelas duas pontas do OR conta uma única vez", () => {
    const sets = canonicalSets();
    const ids = sets.arReceivedRows.map((r) => r.externalId);
    assert.equal(ids.filter((id) => id === 8102).length, 1);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("8. Tesouraria: o realizado do dia recebe a baixa cross-year", () => {
    const sets = canonicalSets();
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
      [sets],
      FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS
    );
    const byDay = new Map<string, number>();
    for (const r of inputs.receivables) {
      if (!r.settlementDate) continue;
      byDay.set(r.settlementDate, (byDay.get(r.settlementDate) ?? 0) + r.amountReceived);
    }
    assert.equal(byDay.get("2026-01-10"), 30000, "10.000 cross-year + 20.000 do mesmo ano");
    assert.equal(byDay.get("2026-12-20"), 5000, "antecipação entra em dez/2026");
    assert.equal(
      [...byDay.values()].reduce((s, v) => s + v, 0),
      35000,
      "nada de 2027 e nada do grupo interno"
    );
  });

  it("9. aberto/previsão não é contaminado pelas linhas cross-year", () => {
    const withExtras = cashFlowSummary();
    const onlyPeriod = buildFinanceCashFlowExecutiveSummary(
      splitCashFlowArRowsBySettlementOnlyWindow(BASE_ROWS, CF_FILTERS).periodRows,
      [],
      CF_FILTERS,
      REF,
      PERIOD,
      null,
      null,
      AR_OPTIONS
    );
    assert.deepEqual(
      withExtras.monthlyTimeline.map((m) => m.receivableOpenDue),
      onlyPeriod.monthlyTimeline.map((m) => m.receivableOpenDue),
      "saldo aberto por vencimento tem de ser idêntico com e sem as linhas realized-only"
    );
    assert.equal(
      withExtras.receivable.openFromTodayToYearEnd,
      onlyPeriod.receivable.openFromTodayToYearEnd
    );
  });

  it("10. carga canônica pede a janela de baixa (wiring da query)", () => {
    const root = fileURLToPath(new URL("../../..", import.meta.url));
    const src = readFileSync(`${root}/src/lib/finance/financeCashFlowCanonicalRealized.server.ts`, "utf8");
    assert.match(
      src,
      /resolveCashFlowArSettlementLoadWindow/,
      "o loader canônico precisa ampliar a carga pela janela de baixa"
    );
    const window = resolveCashFlowArSettlementLoadWindow(CF_FILTERS);
    assert.ok(window);
    assert.equal(window!.from.getFullYear(), YEAR);
    assert.equal(window!.toExclusive.getFullYear(), YEAR + 1);
  });
});

function summaryTotal(sets: ReturnType<typeof canonicalSets>): number {
  let total = 0;
  for (let m = 1; m <= 12; m += 1) total += canonicalReceivedInMonth(sets, m);
  return Math.round(total * 100) / 100;
}
