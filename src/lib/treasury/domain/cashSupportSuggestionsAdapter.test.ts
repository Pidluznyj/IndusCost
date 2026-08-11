import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCashSupportSuggestions } from "./cashSupportSuggestionsAdapter.js";
import type { CashSupportUnifiedRow } from "../contracts/cashSupportContracts.js";

function forecastRow(): CashSupportUnifiedRow {
  return {
    displayId: "receivable:due:-1:2026-07-20",
    resourceType: "FORECAST",
    officialTitleKey: null,
    bankMovementKey: null,
    forecastContextKey: {
      __brand: "forecastContextKey",
      orderCode: "PD-1",
      lineKind: "ORDER_FORECAST",
      syntheticId: -1,
    },
    reconcilable: false,
    direction: "IN",
    description: "Previsão",
    expectedDate: "2026-07-20",
    dueDate: "2026-07-20",
    bankDate: null,
    occurredAt: null,
    sourceUpdatedAt: null,
    expectedAmount: "1000.00",
    officialAmount: null,
    bankAmount: null,
    allocatedAmount: "0.00",
    adjustmentAmount: "0.00",
    residualAmount: "1000.00",
    reconciliationState: "NOT_APPLICABLE",
    sourceState: "open",
    companyContext: { companyCode: "EMP1" },
    accountContext: null,
    currencyContext: { currency: "BRL", assumed: true },
    sourceReferences: [],
    warnings: [],
    availableActions: [],
  };
}

function titleRow(overrides: Partial<CashSupportUnifiedRow> = {}): CashSupportUnifiedRow {
  return {
    displayId: "receivable:due:900:2026-07-20",
    resourceType: "OFFICIAL_RECEIVABLE",
    officialTitleKey: {
      __brand: "officialTitleKey",
      companyCode: "EMP1",
      side: "ACCOUNTS_RECEIVABLE",
      externalId: 900,
    },
    bankMovementKey: null,
    forecastContextKey: null,
    reconcilable: true,
    direction: "IN",
    description: "Cliente A",
    expectedDate: null,
    dueDate: "2026-07-20",
    bankDate: null,
    occurredAt: null,
    sourceUpdatedAt: null,
    expectedAmount: null,
    officialAmount: "1000.00",
    bankAmount: null,
    allocatedAmount: "0.00",
    adjustmentAmount: "0.00",
    residualAmount: "1000.00",
    reconciliationState: "NOT_APPLICABLE",
    sourceState: "open",
    companyContext: { companyCode: "EMP1" },
    accountContext: null,
    currencyContext: { currency: "BRL", assumed: true },
    sourceReferences: [],
    warnings: [],
    availableActions: [],
    ...overrides,
  };
}

function movementRow(overrides: Partial<CashSupportUnifiedRow> = {}): CashSupportUnifiedRow {
  return {
    displayId: "bank-movement:mov-1",
    resourceType: "BANK_MOVEMENT",
    officialTitleKey: null,
    bankMovementKey: { __brand: "bankMovementKey", bankMovementId: "mov-1" },
    forecastContextKey: null,
    reconcilable: true,
    direction: "IN",
    description: "Cliente A",
    expectedDate: null,
    dueDate: null,
    bankDate: "2026-07-20",
    occurredAt: "2026-07-20",
    sourceUpdatedAt: null,
    expectedAmount: null,
    officialAmount: null,
    bankAmount: "1000.00",
    allocatedAmount: "0.00",
    adjustmentAmount: "0.00",
    residualAmount: "1000.00",
    reconciliationState: "PENDING",
    sourceState: "PENDING",
    companyContext: { companyCode: "EMP1" },
    accountContext: { accountId: "acc-1", accountName: "Caixa" },
    currencyContext: { currency: "BRL", assumed: false },
    sourceReferences: [],
    warnings: [],
    availableActions: [],
    ...overrides,
  };
}

describe("cashSupportSuggestionsAdapter", () => {
  it("sugestão 1:1 quando movimento e título real batem em valor/data/nome", () => {
    const result = buildCashSupportSuggestions({
      rows: [movementRow(), titleRow()],
      companyCode: "EMP1",
      asOfCivilDate: "2026-07-20",
    });
    assert.equal(result.suggestions.length, 1);
    assert.equal(result.suggestions[0]!.movementId, "mov-1");
    // externalId mora na allocation (candidato pode ser N:1) — o acesso no
    // topo do candidato era bug do teste, falhava também na baseline.
    assert.equal(result.suggestions[0]!.allocations[0]!.externalId, 900);
  });

  it("sem candidato: movimento sozinho não gera sugestão", () => {
    const result = buildCashSupportSuggestions({
      rows: [movementRow()],
      companyCode: "EMP1",
      asOfCivilDate: "2026-07-20",
    });
    assert.equal(result.suggestions.length, 0);
    assert.equal(result.unmatchedMovementIds.length, 1);
  });

  it("previsão NUNCA vira seed — não aparece como título nem candidato", () => {
    const result = buildCashSupportSuggestions({
      rows: [movementRow(), forecastRow()],
      companyCode: "EMP1",
      asOfCivilDate: "2026-07-20",
    });
    assert.equal(result.suggestions.length, 0, "previsão não pode ser sugerida");
  });

  it("movimento MATCHED não entra como candidato (já resolvido)", () => {
    const result = buildCashSupportSuggestions({
      rows: [movementRow({ reconciliationState: "MATCHED" }), titleRow()],
      companyCode: "EMP1",
      asOfCivilDate: "2026-07-20",
    });
    assert.equal(result.suggestions.length, 0);
  });

  it("título com residual zero não entra como candidato", () => {
    const result = buildCashSupportSuggestions({
      rows: [movementRow(), titleRow({ residualAmount: "0.00" })],
      companyCode: "EMP1",
      asOfCivilDate: "2026-07-20",
    });
    assert.equal(result.suggestions.length, 0);
  });

  it("conta ausente no movimento impede virar seed (sem inventar accountId)", () => {
    const result = buildCashSupportSuggestions({
      rows: [movementRow({ accountContext: null }), titleRow()],
      companyCode: "EMP1",
      asOfCivilDate: "2026-07-20",
    });
    assert.equal(result.suggestions.length, 0);
  });

  it("autoMatched é sempre false — nunca aplica match", () => {
    const result = buildCashSupportSuggestions({
      rows: [movementRow(), titleRow()],
      companyCode: "EMP1",
      asOfCivilDate: "2026-07-20",
    });
    assert.equal(result.autoMatched, false);
  });

  it("algorithmVersion vem do motor oficial, não inventado aqui", () => {
    const result = buildCashSupportSuggestions({
      rows: [],
      companyCode: "EMP1",
      asOfCivilDate: "2026-07-20",
    });
    assert.equal(result.algorithmVersion, "1.0.0");
  });
});
