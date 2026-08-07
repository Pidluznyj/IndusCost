/**
 * Sugestões de conciliação no Apoio ao Caixa (CS-008). Somente leitura.
 *
 * Não cria algoritmo novo: converte `CashSupportUnifiedRow` já resolvidas
 * (CS-005) em seeds do motor oficial (`treasuryReconciliationSuggestionEngine.ts`)
 * e devolve o resultado dele — sem tocar em `score`, `confidence` nem em
 * qualquer critério de ranking.
 *
 * FORECAST nunca entra como seed de nenhum dos dois lados: não tem
 * `officialTitleKey` nem `bankMovementKey`, então é filtrada antes mesmo de
 * chegar ao motor — previsão não pode gerar sugestão conciliável.
 */

import {
  runTreasuryReconciliationSuggestionEngine,
  type TreasuryReconciliationMovementSeed,
  type TreasuryReconciliationSuggestionEngineResult,
  type TreasuryReconciliationTitleSeed,
} from "./treasuryReconciliationSuggestionEngine.js";
import type { CashSupportUnifiedRow } from "../contracts/cashSupportContracts.js";

function toMovementSeed(row: CashSupportUnifiedRow): TreasuryReconciliationMovementSeed | null {
  if (row.resourceType !== "BANK_MOVEMENT" || !row.bankMovementKey || !row.bankDate) {
    return null;
  }
  if (row.reconciliationState === "MATCHED" || row.reconciliationState === "IGNORED") {
    return null; // já resolvido — não precisa de sugestão
  }
  if (!row.accountContext) return null; // seed exige accountId
  return {
    id: row.bankMovementKey.bankMovementId,
    accountId: row.accountContext.accountId,
    direction: row.direction === "IN" ? "CREDIT" : "DEBIT",
    amount: row.bankAmount ?? row.residualAmount,
    postedCivilDate: row.bankDate,
    documentNumber: null,
    counterpartyName: row.description,
    description: row.description,
    reconciliationStatus: row.reconciliationState === "PARTIAL" ? "PARTIAL" : "PENDING",
    reconciledAmount: row.allocatedAmount,
  };
}

function toTitleSeed(row: CashSupportUnifiedRow): TreasuryReconciliationTitleSeed | null {
  if (
    (row.resourceType !== "OFFICIAL_RECEIVABLE" && row.resourceType !== "OFFICIAL_PAYABLE") ||
    !row.officialTitleKey
  ) {
    return null; // FORECAST cai aqui — nunca vira título sugerível
  }
  const openBalance = row.residualAmount;
  if (Number(openBalance) <= 0) return null;
  return {
    side: row.officialTitleKey.side === "ACCOUNTS_RECEIVABLE" ? "AR" : "AP",
    officialTitleId: String(row.officialTitleKey.externalId),
    externalId: row.officialTitleKey.externalId,
    counterpartyName: row.description,
    counterpartyTaxId: null,
    documentNumber: null,
    description: row.description,
    invoiceNumber: null,
    dueDate: row.dueDate,
    openBalance,
    isCancelled: false,
    isSettled: false,
  };
}

export function buildCashSupportSuggestions(input: {
  rows: readonly CashSupportUnifiedRow[];
  companyCode: string;
  asOfCivilDate: string;
}): TreasuryReconciliationSuggestionEngineResult {
  const movements = input.rows
    .map(toMovementSeed)
    .filter((m): m is TreasuryReconciliationMovementSeed => m != null);
  const titles = input.rows
    .map(toTitleSeed)
    .filter((t): t is TreasuryReconciliationTitleSeed => t != null);

  return runTreasuryReconciliationSuggestionEngine({
    companyCode: input.companyCode,
    asOfCivilDate: input.asOfCivilDate,
    movements,
    titles,
  });
}
