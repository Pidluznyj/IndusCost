import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCashSupportTitleGrid } from "./cashSupportTitleGrid.js";
import { CASH_SUPPORT_AUTO_JUSTIFICATION_PREFIX } from "./cashSupportAutoReconcile.js";
import type { CashSupportUnifiedRow } from "../contracts/cashSupportContracts.js";
import type {
  TreasuryReconciliationAllocationDto,
  TreasuryReconciliationMatchDto,
  TreasuryReconciliationMatchMovementDto,
} from "../contracts/treasuryDto.js";
import type { TreasuryReconciliationSuggestionCandidate } from "./treasuryReconciliationSuggestionEngine.js";

function titleRow(overrides: Partial<CashSupportUnifiedRow> = {}): CashSupportUnifiedRow {
  return {
    displayId: "official:AR:900",
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
    dueDate: "2026-07-21",
    bankDate: null,
    occurredAt: null,
    sourceUpdatedAt: null,
    expectedAmount: null,
    officialAmount: "1000.00",
    bankAmount: null,
    allocatedAmount: "0.00",
    adjustmentAmount: "0.00",
    residualAmount: "1000.00",
    reconciliationState: "PENDING",
    sourceState: null,
    companyContext: { companyCode: "EMP1" },
    accountContext: null,
    currencyContext: { currency: "BRL", assumed: false },
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
    description: "PIX Cliente A",
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
    accountContext: { accountId: "acc-1", accountName: "Itaú" },
    currencyContext: { currency: "BRL", assumed: false },
    sourceReferences: [],
    warnings: [],
    availableActions: [],
    ...overrides,
  };
}

function matchDto(input: {
  id: string;
  justification?: string | null;
  isReversed?: boolean;
  movements: Array<{ bankMovementId: string; amount: string }>;
  allocations: Array<Partial<TreasuryReconciliationAllocationDto> & { amount: string }>;
}): TreasuryReconciliationMatchDto {
  const movements: TreasuryReconciliationMatchMovementDto[] = input.movements.map(
    (m, i) => ({
      id: `mm-${input.id}-${i}`,
      matchId: input.id,
      bankMovementId: m.bankMovementId,
      amount: m.amount,
      sortOrder: i,
    })
  );
  const allocations: TreasuryReconciliationAllocationDto[] = input.allocations.map(
    (a, i) => ({
      id: `al-${input.id}-${i}`,
      matchId: input.id,
      kind: a.kind ?? "TITLE",
      amount: a.amount,
      memo: a.memo ?? null,
      nomusSide: a.nomusSide ?? "AR",
      officialTitleId: a.officialTitleId ?? "900",
      nomusExternalId: a.nomusExternalId ?? 900,
      transferId: null,
      transferGroupId: null,
      ledgerEntryId: null,
      differenceCode: a.differenceCode ?? null,
      sortOrder: i,
    })
  );
  return {
    id: input.id,
    companyCode: "EMP1",
    accountId: "acc-1",
    status: input.isReversed ? "UNMATCHED" : "MATCHED",
    matchedAmount: movements.reduce((acc, m) => acc, "1000.00"),
    currency: "BRL",
    matchedCivilDate: "2026-07-20",
    justification: input.justification ?? null,
    suggestionKey: null,
    algorithmVersion: null,
    suggestionScore: null,
    suggestionConfidence: null,
    suggestionReasons: null,
    version: 1,
    movements,
    allocations,
    createdAt: "2026-07-20T12:00:00.000Z",
    createdByUserId: "user-1",
    updatedAt: "2026-07-20T12:00:00.000Z",
    updatedByUserId: null,
    unmatchedAt: null,
    unmatchedByUserId: null,
    unmatchReason: null,
    isReversed: input.isReversed ?? false,
    doesNotRealizeOfficial: true,
  };
}

function suggestion(
  overrides: Partial<TreasuryReconciliationSuggestionCandidate> = {}
): TreasuryReconciliationSuggestionCandidate {
  return {
    suggestionKey: "mov-1|900",
    movementId: "mov-1",
    allocations: [
      { side: "AR", officialTitleId: "900", externalId: 900, suggestedAmount: "1000.00" },
    ],
    totalSuggestedAmount: "1000.00",
    score: 62,
    confidence: "MEDIUM",
    reasons: ["AMOUNT_EXACT", "DATE_PROXIMITY"],
    scoreBreakdown: {
      AMOUNT_EXACT: 40,
      DOCUMENT_MATCH: 0,
      TAX_ID_MATCH: 0,
      DATE_PROXIMITY: 10,
      NAME_SIMILAR: 12,
      HISTORY_MATCH: 0,
    },
    ...overrides,
  };
}

describe("cashSupportTitleGrid — status por título", () => {
  it("sem match e sem sugestão ⇒ ⚪ Não conciliado; diferença = valor do título", () => {
    const vm = buildCashSupportTitleGrid({
      rows: [titleRow(), movementRow()],
      matches: [],
    });
    assert.equal(vm.titleRows.length, 1);
    const row = vm.titleRows[0]!;
    assert.equal(row.status, "UNRECONCILED");
    assert.equal(row.difference, "1000.00");
    assert.equal(row.bankLegs.length, 0);
    assert.equal(vm.cards.unreconciledCount, 1);
  });

  it("sem match mas com sugestão pendente ⇒ 🟡 Revisar", () => {
    const vm = buildCashSupportTitleGrid({
      rows: [titleRow(), movementRow()],
      matches: [],
      suggestions: [suggestion()],
    });
    const row = vm.titleRows[0]!;
    assert.equal(row.status, "REVIEW");
    assert.equal(row.pendingSuggestionKey, "mov-1|900");
    assert.equal(vm.cards.reviewCount, 1);
  });

  it("match integral manual ⇒ 🔵 Manual, diferença zero, perna com banco", () => {
    const vm = buildCashSupportTitleGrid({
      rows: [titleRow(), movementRow()],
      matches: [
        matchDto({
          id: "match-1",
          justification: "Conferido manualmente com o extrato",
          movements: [{ bankMovementId: "mov-1", amount: "1000.00" }],
          allocations: [{ amount: "1000.00" }],
        }),
      ],
    });
    const row = vm.titleRows[0]!;
    assert.equal(row.status, "MANUAL_MATCHED");
    assert.equal(row.difference, "0.00");
    assert.equal(row.totalAllocated, "1000.00");
    assert.equal(row.bankLegs.length, 1);
    assert.equal(row.bankLegs[0]!.accountName, "Itaú");
    assert.equal(row.bankLegs[0]!.isAuto, false);
    assert.equal(vm.cards.manualMatchedCount, 1);
  });

  it("match com justificativa [AUTO] ⇒ 🟢 Automático", () => {
    const vm = buildCashSupportTitleGrid({
      rows: [titleRow(), movementRow()],
      matches: [
        matchDto({
          id: "match-1",
          justification: `${CASH_SUPPORT_AUTO_JUSTIFICATION_PREFIX} Conciliação automática AUTO-1.0.0 — score 85 (HIGH)`,
          movements: [{ bankMovementId: "mov-1", amount: "1000.00" }],
          allocations: [{ amount: "1000.00" }],
        }),
      ],
    });
    const row = vm.titleRows[0]!;
    assert.equal(row.status, "AUTO_MATCHED");
    assert.equal(row.bankLegs[0]!.isAuto, true);
    assert.equal(vm.cards.autoMatchedCount, 1);
  });

  it("alocação parcial ⇒ 🟣 Parcial com diferença residual", () => {
    const vm = buildCashSupportTitleGrid({
      rows: [titleRow(), movementRow({ bankAmount: "400.00", residualAmount: "0.00" })],
      matches: [
        matchDto({
          id: "match-1",
          movements: [{ bankMovementId: "mov-1", amount: "400.00" }],
          allocations: [{ amount: "400.00" }],
        }),
      ],
    });
    const row = vm.titleRows[0]!;
    assert.equal(row.status, "PARTIAL");
    assert.equal(row.totalAllocated, "400.00");
    assert.equal(row.difference, "600.00");
    assert.equal(vm.cards.partialCount, 1);
  });

  it("diferença justificada (desconto) fecha o título sem virar Parcial", () => {
    // Título 1000, banco pagou 980, desconto justificado 20.
    const vm = buildCashSupportTitleGrid({
      rows: [titleRow(), movementRow({ bankAmount: "980.00", residualAmount: "0.00" })],
      matches: [
        matchDto({
          id: "match-1",
          justification: "Desconto comercial acordado",
          movements: [{ bankMovementId: "mov-1", amount: "980.00" }],
          allocations: [
            { amount: "1000.00" },
            { kind: "DISCOUNT", amount: "20.00", differenceCode: "DESCONTO", nomusSide: null, officialTitleId: null, nomusExternalId: null },
          ],
        }),
      ],
    });
    const row = vm.titleRows[0]!;
    assert.equal(row.totalAllocated, "1000.00");
    assert.equal(row.hasJustifiedDifference, true);
    assert.equal(row.justifiedDifference, "20.00");
    // Título 1000 integralmente alocado; o desconto de 20 explica a lacuna
    // banco (980) × título (1000) — é contexto, não sobra: status conciliado.
    assert.equal(row.difference, "0.00");
    assert.equal(row.status, "MANUAL_MATCHED");
  });

  it("N↔1: dois movimentos explicam um título (duas pernas, Banco 1 e Banco 2)", () => {
    const vm = buildCashSupportTitleGrid({
      rows: [
        titleRow(),
        movementRow(),
        movementRow({
          displayId: "bank-movement:mov-2",
          bankMovementKey: { __brand: "bankMovementKey", bankMovementId: "mov-2" },
          bankDate: "2026-07-22",
          bankAmount: "400.00",
          residualAmount: "0.00",
          accountContext: { accountId: "acc-2", accountName: "Bradesco" },
        }),
      ],
      matches: [
        matchDto({
          id: "match-1",
          movements: [
            { bankMovementId: "mov-1", amount: "600.00" },
            { bankMovementId: "mov-2", amount: "400.00" },
          ],
          allocations: [{ amount: "1000.00" }],
        }),
      ],
    });
    const row = vm.titleRows[0]!;
    assert.equal(row.bankLegs.length, 2);
    assert.equal(row.bankLegs[0]!.bankMovementId, "mov-1");
    assert.equal(row.bankLegs[0]!.allocatedAmount, "600.00");
    assert.equal(row.bankLegs[1]!.bankMovementId, "mov-2");
    assert.equal(row.bankLegs[1]!.allocatedAmount, "400.00");
    assert.equal(row.status, "MANUAL_MATCHED");
    assert.equal(row.difference, "0.00");
  });

  it("match revertido é bug do chamador se passado — filtrado por isReversed", () => {
    const vm = buildCashSupportTitleGrid({
      rows: [titleRow(), movementRow()],
      matches: [
        matchDto({
          id: "match-1",
          isReversed: true,
          movements: [{ bankMovementId: "mov-1", amount: "1000.00" }],
          allocations: [{ amount: "1000.00" }],
        }),
      ],
    });
    assert.equal(vm.titleRows[0]!.status, "UNRECONCILED");
  });

  it("movimentos sem explicação: residual > 0 entra com melhor candidato", () => {
    const vm = buildCashSupportTitleGrid({
      rows: [
        movementRow(),
        movementRow({
          displayId: "bank-movement:mov-2",
          bankMovementKey: { __brand: "bankMovementKey", bankMovementId: "mov-2" },
          bankAmount: "55.00",
          residualAmount: "0.00",
          reconciliationState: "MATCHED",
        }),
      ],
      matches: [],
      suggestions: [suggestion()],
    });
    assert.equal(vm.unexplainedMovements.length, 1);
    const um = vm.unexplainedMovements[0]!;
    assert.equal(um.bankMovementId, "mov-1");
    assert.equal(um.bestSuggestionKey, "mov-1|900");
    assert.equal(um.bestSuggestionConfidence, "MEDIUM");
    assert.equal(vm.cards.unexplainedMovementsCount, 1);
    assert.equal(vm.cards.unexplainedMovementsTotal, "1000.00");
  });

  it("ordena por vencimento e é determinístico", () => {
    const vm = buildCashSupportTitleGrid({
      rows: [
        titleRow({
          displayId: "official:AR:902",
          dueDate: "2026-07-25",
          officialTitleKey: {
            __brand: "officialTitleKey",
            companyCode: "EMP1",
            side: "ACCOUNTS_RECEIVABLE",
            externalId: 902,
          },
        }),
        titleRow(),
      ],
      matches: [],
    });
    assert.deepEqual(
      vm.titleRows.map((r) => r.externalId),
      [900, 902]
    );
  });
});
