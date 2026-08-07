import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTreasuryCaixaCanonicalDays } from "./treasuryCaixaCanonicalDay.js";
import type { FinanceAccountsReceivableGridRow } from "@/src/lib/financeAccountsReceivableRulesEngine.js";
import type { FinanceAccountsPayableGridRow } from "@/src/lib/financeAccountsPayableRulesEngine.js";
import type {
  TreasuryBankMovementDto,
  TreasuryReconciliationMatchDto,
} from "../contracts/treasuryDto.js";
import { buildCashSupportReadModel } from "./cashSupportReadModel.js";
import { assertCashSupportRowInvariants } from "../contracts/cashSupportContracts.js";

function receivable(
  overrides: Partial<FinanceAccountsReceivableGridRow>
): FinanceAccountsReceivableGridRow {
  return {
    externalId: 1,
    companyName: null,
    personName: "Cliente",
    personCnpj: null,
    dueDate: "2026-07-20",
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    hasSourceInvoice: false,
    calculatedStatus: "open",
    daysOverdue: 0,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    suspendCollection: false,
    ...overrides,
  } as FinanceAccountsReceivableGridRow;
}

function movement(overrides: Partial<TreasuryBankMovementDto>): TreasuryBankMovementDto {
  return {
    id: "mov-1",
    batchId: "batch-1",
    companyCode: "EMP1",
    accountId: "acc-1",
    accountCode: "CXA",
    accountName: "Caixa",
    fingerprint: "fp-1",
    fitId: "FIT-1",
    direction: "CREDIT",
    amount: "1000.00",
    currency: "BRL",
    postedCivilDate: "2026-07-20",
    userCivilDate: null,
    description: "Depósito",
    documentNumber: null,
    counterpartyName: null,
    trnType: null,
    reconciliationStatus: "PENDING",
    reconciledAmount: "0.00",
    sortOrder: 0,
    createdAt: "2026-07-20T10:00:00.000Z",
    ...overrides,
  } as TreasuryBankMovementDto;
}

function baseFilters(overrides: Partial<Parameters<typeof buildCashSupportReadModel>[0]["filters"]> = {}) {
  return {
    civilDateFrom: "2026-07-01",
    civilDateTo: "2026-07-31",
    ...overrides,
  };
}

describe("cashSupportReadModel", () => {
  it("nenhuma linha FORECAST recebe allocation ou vira conciliável", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-07-20"],
      receivables: [receivable({ externalId: -55, balanceReceivable: 200 })],
      payables: [],
      openingBalanceOfFirstDay: 0,
    });
    const model = buildCashSupportReadModel({
      canonicalDays: days,
      companyCode: "EMP1",
      bankMovements: [],
      activeMatchesByMovementId: new Map(),
      filters: baseFilters(),
      analysisAsOfDateTime: "2026-07-20T12:00:00.000Z",
    });
    const forecastRow = model.rows.find((r) => r.resourceType === "FORECAST");
    assert.ok(forecastRow);
    assert.equal(forecastRow!.reconcilable, false);
    for (const row of model.rows) assertCashSupportRowInvariants(row);
  });

  it("movimento sem match aparece e conta na posição bancária mesmo sem conciliação", () => {
    const model = buildCashSupportReadModel({
      canonicalDays: [],
      companyCode: "EMP1",
      bankMovements: [movement({ reconciliationStatus: "PENDING" })],
      activeMatchesByMovementId: new Map(),
      filters: baseFilters(),
      analysisAsOfDateTime: "2026-07-20T12:00:00.000Z",
    });
    const row = model.rows.find((r) => r.resourceType === "BANK_MOVEMENT");
    assert.ok(row);
    assert.equal(model.summary.bankPosition.inflows, "1000.00");
    assert.equal(model.summary.bankPosition.unreconciled, "1000.00");
  });

  it("anti-dupla-contagem: posição bancária e canônica nunca são somadas num único número", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-07-20"],
      receivables: [receivable({ externalId: 900, balanceReceivable: 1000 })],
      payables: [],
      openingBalanceOfFirstDay: 0,
    });
    const model = buildCashSupportReadModel({
      canonicalDays: days,
      companyCode: "EMP1",
      bankMovements: [movement({ amount: "1000.00" })],
      activeMatchesByMovementId: new Map(),
      filters: baseFilters(),
      analysisAsOfDateTime: "2026-07-20T12:00:00.000Z",
    });
    // Campos estruturalmente separados — o teste prova que existem dois
    // números distintos, não um único "total" que somaria os dois.
    assert.ok("bankPosition" in model.summary);
    assert.ok("canonicalPosition" in model.summary);
    assert.notEqual(
      Object.keys(model.summary).includes("total"),
      true,
      "não deve existir campo 'total' somando as duas famílias"
    );
  });

  it("transferência interna consolida sempre em zero", () => {
    const model = buildCashSupportReadModel({
      canonicalDays: [],
      companyCode: "EMP1",
      bankMovements: [],
      activeMatchesByMovementId: new Map(),
      filters: baseFilters(),
      analysisAsOfDateTime: "2026-07-20T12:00:00.000Z",
    });
    assert.equal(model.summary.bridge.internalTransfersConsolidated, "0.00");
  });

  it("filtro por período exclui linhas fora da janela", () => {
    const model = buildCashSupportReadModel({
      canonicalDays: [],
      companyCode: "EMP1",
      bankMovements: [movement({ postedCivilDate: "2026-01-05" })],
      activeMatchesByMovementId: new Map(),
      filters: baseFilters({ civilDateFrom: "2026-07-01", civilDateTo: "2026-07-31" }),
      analysisAsOfDateTime: "2026-07-20T12:00:00.000Z",
    });
    assert.equal(model.rows.length, 0);
    assert.equal(model.pagination.total, 0);
  });

  it("filtro por resourceType restringe corretamente", () => {
    const days = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-07-20"],
      receivables: [receivable({ externalId: 1 })],
      payables: [],
      openingBalanceOfFirstDay: 0,
    });
    const model = buildCashSupportReadModel({
      canonicalDays: days,
      companyCode: "EMP1",
      bankMovements: [movement({})],
      activeMatchesByMovementId: new Map(),
      filters: baseFilters({ resourceTypes: ["BANK_MOVEMENT"] }),
      analysisAsOfDateTime: "2026-07-20T12:00:00.000Z",
    });
    assert.ok(model.rows.every((r) => r.resourceType === "BANK_MOVEMENT"));
  });

  it("paginação respeita page/pageSize sem alterar o total", () => {
    const movements = Array.from({ length: 5 }, (_, i) =>
      movement({ id: `m${i}`, postedCivilDate: "2026-07-20" })
    );
    const model = buildCashSupportReadModel({
      canonicalDays: [],
      companyCode: "EMP1",
      bankMovements: movements,
      activeMatchesByMovementId: new Map(),
      filters: baseFilters({ page: 1, pageSize: 2 }),
      analysisAsOfDateTime: "2026-07-20T12:00:00.000Z",
    });
    assert.equal(model.rows.length, 2);
    assert.equal(model.pagination.total, 5);
  });

  it("enriquecimento por conciliação não altera allocatedAmount/residualAmount de origem do movimento", () => {
    const match: TreasuryReconciliationMatchDto = {
      id: "match-1",
      companyCode: "EMP1",
      accountId: "acc-1",
      status: "MATCHED",
      matchedAmount: "1000.00",
      currency: "BRL",
      matchedCivilDate: "2026-07-20",
      justification: null,
      suggestionKey: null,
      algorithmVersion: null,
      suggestionScore: null,
      suggestionConfidence: null,
      suggestionReasons: null,
      version: 1,
      movements: [],
      allocations: [
        {
          id: "a1",
          matchId: "match-1",
          kind: "TITLE",
          amount: "1000.00",
          memo: null,
          nomusSide: "AR",
          officialTitleId: "t1",
          nomusExternalId: 900,
          transferId: null,
          transferGroupId: null,
          ledgerEntryId: null,
          differenceCode: null,
          sortOrder: 0,
        },
      ],
      createdAt: "2026-07-20T10:00:00.000Z",
      createdByUserId: "u1",
      updatedAt: "2026-07-20T10:00:00.000Z",
      updatedByUserId: null,
      unmatchedAt: null,
      unmatchedByUserId: null,
      unmatchReason: null,
      isReversed: false,
    } as TreasuryReconciliationMatchDto;

    const model = buildCashSupportReadModel({
      canonicalDays: [],
      companyCode: "EMP1",
      bankMovements: [movement({ reconciliationStatus: "MATCHED", reconciledAmount: "1000.00" })],
      activeMatchesByMovementId: new Map([["mov-1", [match]]]),
      filters: baseFilters(),
      analysisAsOfDateTime: "2026-07-20T12:00:00.000Z",
    });
    const row = model.rows.find((r) => r.resourceType === "BANK_MOVEMENT")!;
    // allocatedAmount/residualAmount vêm do movement DTO (autoridade), não
    // recalculados pelo enriquecimento — evita segunda soma.
    assert.equal(row.allocatedAmount, "1000.00");
    assert.equal(row.residualAmount, "0.00");
  });

  it("warnings estruturais de saldo estão sempre presentes (matriz #6/#8)", () => {
    const model = buildCashSupportReadModel({
      canonicalDays: [],
      companyCode: "EMP1",
      bankMovements: [],
      activeMatchesByMovementId: new Map(),
      filters: baseFilters(),
      analysisAsOfDateTime: "2026-07-20T12:00:00.000Z",
    });
    assert.ok(
      model.warnings.some((w) => w.code === "AVAILABLE_BALANCE_UNSUPPORTED")
    );
  });

  it("analysisAsOfDateTime está sempre presente (Prompt 0 §4.16)", () => {
    const model = buildCashSupportReadModel({
      canonicalDays: [],
      companyCode: "EMP1",
      bankMovements: [],
      activeMatchesByMovementId: new Map(),
      filters: baseFilters(),
      analysisAsOfDateTime: "2026-07-20T12:00:00.000Z",
    });
    assert.equal(model.analysisAsOfDateTime, "2026-07-20T12:00:00.000Z");
  });

  it("empresa ausente gera warning, nunca é inventada", () => {
    const model = buildCashSupportReadModel({
      canonicalDays: [],
      companyCode: null,
      bankMovements: [],
      activeMatchesByMovementId: new Map(),
      filters: baseFilters(),
      analysisAsOfDateTime: "2026-07-20T12:00:00.000Z",
    });
    assert.ok(model.warnings.some((w) => w.code === "COMPANY_CONTEXT_UNAVAILABLE"));
  });

  it("BUG CORRIGIDO: canonicalDays fora do período (superset do orquestrador) não vaza para linhas nem resumo", () => {
    // O orquestrador (cashSupportService.server.ts) pode carregar o ANO
    // INTEIRO de canonicalDays quando treasuryCaixaService.getBoard so aceita
    // ano/mes/dia, nunca um intervalo arbitrario. O read model precisa
    // filtrar por conta propria — tanto nas linhas quanto no resumo.
    const daysWholeYear = buildTreasuryCaixaCanonicalDays({
      civilDatesInWindow: ["2026-01-15", "2026-08-10"],
      receivables: [
        receivable({ externalId: 1, dueDate: "2026-01-15", balanceReceivable: 500 }),
        receivable({ externalId: 2, dueDate: "2026-08-10", balanceReceivable: 700 }),
      ],
      payables: [],
      openingBalanceOfFirstDay: 0,
    });

    const model = buildCashSupportReadModel({
      canonicalDays: daysWholeYear,
      companyCode: "EMP1",
      bankMovements: [],
      activeMatchesByMovementId: new Map(),
      filters: baseFilters({ civilDateFrom: "2026-08-01", civilDateTo: "2026-08-31" }),
      analysisAsOfDateTime: "2026-08-10T12:00:00.000Z",
    });

    const janeiroRow = model.rows.find((r) => r.displayId.includes(":1:"));
    assert.equal(janeiroRow, undefined, "título de janeiro não pode aparecer num filtro de agosto");

    const agostoRow = model.rows.find((r) => r.displayId.includes(":2:"));
    assert.ok(agostoRow, "título de agosto deve aparecer");

    // Resumo (cartões) também não pode vazar o valor de janeiro.
    assert.equal(
      model.summary.canonicalPosition.expectedTitles,
      "700.00",
      "resumo canônico deve refletir só o período filtrado, não o superset carregado"
    );
  });
});
