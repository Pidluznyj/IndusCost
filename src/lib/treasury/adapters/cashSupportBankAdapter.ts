/**
 * Adaptador bancário do Apoio ao Caixa (CS-003).
 *
 * Consome exclusivamente `TreasuryBankMovementDto` (leitura oficial —
 * `treasuryBankMovementQueryService.server.ts`) e o saldo *ledger* já
 * persistido no lote OFX (`treasuryReconciledBalanceRepository.server.ts`).
 * Não reimporta, não corrige, não deduplica de novo — tudo isso já é
 * garantido pelo importador oficial (`fingerprint`/`fitId` únicos no banco).
 *
 * Regra central (ADR 001, Prompt 0 §4.3): todo movimento bancário válido
 * afeta a posição bancária MESMO sem match, sem classificação, em
 * investigação. Por isso este adaptador não filtra por status — inclui
 * TODOS os movimentos recebidos, o filtro é decisão de quem chama
 * (`CashSupportFilters`), nunca deste adaptador.
 */

import type { TreasuryBankMovementDto } from "../contracts/treasuryDto.js";
import {
  addTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
} from "../treasuryMoney.js";
import {
  buildCashSupportBankMovementKey,
  type CashSupportReconciliationState,
  type CashSupportUnifiedRow,
  type CashSupportWarning,
} from "../contracts/cashSupportContracts.js";

/** Estado de apresentação — espelha o oficial, não inventa estado novo. */
function toReconciliationState(
  status: string
): CashSupportReconciliationState {
  switch (status) {
    case "PENDING":
    case "PARTIAL":
    case "MATCHED":
    case "UNMATCHED":
    case "IGNORED":
      return status;
    default:
      return "PENDING";
  }
}

/**
 * Movimento OFX/bancário → linha unificada. `reconcilable` reflete só a
 * elegibilidade estrutural (não IGNORED); a decisão final de habilitar a
 * ação cabe ao orquestrador, que conhece RBAC/ACL (CS-008/CS-009).
 */
export function adaptTreasuryBankMovementToCashSupportRow(
  movement: TreasuryBankMovementDto
): CashSupportUnifiedRow {
  const residual = subtractTreasuryMoney(movement.amount, movement.reconciledAmount);
  const state = toReconciliationState(String(movement.reconciliationStatus));
  const structurallyReconcilable = state !== "IGNORED";

  const warnings: CashSupportWarning[] = [];
  // #4 da matriz — lacuna real confirmada na Etapa 3: nenhum campo de
  // correção/estorno/supersede existe em TreasuryBankMovement.
  warnings.push({
    code: "SOURCE_CORRECTION_UNSUPPORTED",
    message:
      "Movimento não tem campo de correção/estorno no modelo atual — divergências do extrato exigem investigação manual.",
  });

  return {
    displayId: `bank-movement:${movement.id}`,
    resourceType: "BANK_MOVEMENT",
    officialTitleKey: null,
    bankMovementKey: buildCashSupportBankMovementKey(movement.id),
    forecastContextKey: null,
    reconcilable: structurallyReconcilable,
    direction: movement.direction === "CREDIT" ? "IN" : "OUT",
    description: movement.description ?? movement.counterpartyName ?? null,
    expectedDate: null,
    dueDate: null,
    // ÚNICA data de realizado do módulo inteiro — postedCivilDate do extrato.
    bankDate: movement.postedCivilDate,
    occurredAt: movement.postedCivilDate,
    sourceUpdatedAt: movement.createdAt,
    expectedAmount: null,
    officialAmount: null,
    bankAmount: normalizeTreasuryMoneyString(movement.amount),
    allocatedAmount: normalizeTreasuryMoneyString(movement.reconciledAmount),
    adjustmentAmount: "0.00", // adaptador não separa TITLE de ajustes — feito por CS-004
    residualAmount: residual,
    reconciliationState: state,
    sourceState: String(movement.reconciliationStatus),
    companyContext: { companyCode: movement.companyCode },
    accountContext: {
      accountId: movement.accountId,
      accountName: movement.accountName,
    },
    currencyContext: { currency: "BRL", assumed: false },
    sourceReferences: [
      {
        source: "TreasuryBankMovement",
        id: movement.id,
        label: movement.fitId ?? movement.documentNumber ?? null,
      },
      { source: "TreasuryBankImportBatch", id: movement.batchId, label: null },
    ],
    warnings,
    availableActions: [
      {
        kind: "RECONCILE",
        enabled: false, // decisão final é do orquestrador (RBAC/ACL/estado)
        disabledReason: structurallyReconcilable
          ? "Ação exposta pelo orquestrador (CS-008), não por este adaptador."
          : "Movimento ignorado não pode ser conciliado.",
      },
      { kind: "INVESTIGATE", enabled: true, disabledReason: null },
    ],
  };
}

export function adaptTreasuryBankMovementsToCashSupportRows(
  movements: readonly TreasuryBankMovementDto[]
): CashSupportUnifiedRow[] {
  return movements.map(adaptTreasuryBankMovementToCashSupportRow);
}

/**
 * Posição bancária somada diretamente dos movimentos — não soma extrato
 * inteiro sobre um saldo final (Prompt 0 §5/§13): entradas e saídas vêm da
 * mesma população de linhas devolvida acima, sem consulta paralela.
 */
export function summarizeCashSupportBankPosition(
  movements: readonly TreasuryBankMovementDto[]
): {
  inflows: string;
  outflows: string;
  reconciled: string;
  partiallyReconciled: string;
  unreconciled: string;
} {
  let inflows = "0.00";
  let outflows = "0.00";
  let reconciled = "0.00";
  let partiallyReconciled = "0.00";
  let unreconciled = "0.00";

  for (const m of movements) {
    const amount = normalizeTreasuryMoneyString(m.amount);
    if (m.direction === "CREDIT") inflows = addTreasuryMoney(inflows, amount);
    else outflows = addTreasuryMoney(outflows, amount);

    const status = toReconciliationState(String(m.reconciliationStatus));
    if (status === "MATCHED") reconciled = addTreasuryMoney(reconciled, amount);
    else if (status === "PARTIAL")
      partiallyReconciled = addTreasuryMoney(partiallyReconciled, amount);
    else if (status === "PENDING" || status === "UNMATCHED")
      unreconciled = addTreasuryMoney(unreconciled, amount);
  }

  return { inflows, outflows, reconciled, partiallyReconciled, unreconciled };
}

/**
 * Saldo *ledger* (comparável apenas quando conta+moeda+data-base coincidem —
 * Prompt 0 §4.22). NÃO existe saldo *available* na origem (matriz #6): o
 * parser OFX só extrai `LEDGERBAL`; warning explícito em vez de comparação
 * silenciosa. NÃO existe cobertura de extrato confiável (#8): o arquivo OFX
 * traz `DTSTART`/`DTEND`, mas o parser não os persiste — não inventamos.
 */
export function buildCashSupportBankBalanceWarnings(): CashSupportWarning[] {
  return [
    {
      code: "AVAILABLE_BALANCE_UNSUPPORTED",
      message:
        "Parser OFX só extrai LEDGERBAL — saldo disponível (AVAILBAL) não é comparável aqui.",
    },
    {
      code: "STATEMENT_COVERAGE_UNKNOWN",
      message:
        "Período coberto pelo extrato (DTSTART/DTEND) não é persistido pelo importador atual — cobertura não pode ser confirmada.",
    },
    {
      code: "BALANCE_NOT_COMPARABLE",
      message:
        "Saldos só são comparáveis quando conta, moeda, tipo de saldo e data-base coincidem.",
    },
  ];
}
