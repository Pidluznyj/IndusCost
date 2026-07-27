/**
 * Solicitação / geração de sugestões de conciliação.
 * MVP: motor puro ranqueia candidatos; nunca aplica match automático.
 */

import {
  runTreasuryReconciliationSuggestionEngine,
  type TreasuryReconciliationSuggestionEngineInput,
  type TreasuryReconciliationSuggestionEngineResult,
} from "../domain/treasuryReconciliationSuggestionEngine.js";

export type TreasuryReconciliationSuggestionsRequest = {
  reason: string;
  accountId: string;
  batchId: string;
  companyCode: string;
  movementIds: string[];
  requestId?: string | null;
  requestedAt: Date;
};

export type TreasuryReconciliationSuggestionsResult = {
  accepted: boolean;
  deferred: boolean;
  reason: string;
};

const recentRequests: TreasuryReconciliationSuggestionsRequest[] = [];

export function listTreasuryReconciliationSuggestionsRequests(): readonly TreasuryReconciliationSuggestionsRequest[] {
  return recentRequests;
}

export function clearTreasuryReconciliationSuggestionsRequests(): void {
  recentRequests.length = 0;
}

/**
 * Aceita o pedido de geração de sugestões (fila deferred para I/O futuro).
 * Não aplica conciliação automática.
 */
export function requestTreasuryReconciliationSuggestions(
  input: Omit<TreasuryReconciliationSuggestionsRequest, "requestedAt"> & {
    requestedAt?: Date;
  }
): TreasuryReconciliationSuggestionsResult {
  const entry: TreasuryReconciliationSuggestionsRequest = {
    reason: input.reason,
    accountId: input.accountId,
    batchId: input.batchId,
    companyCode: input.companyCode,
    movementIds: [...input.movementIds],
    requestId: input.requestId ?? null,
    requestedAt: input.requestedAt ?? new Date(),
  };
  recentRequests.push(entry);
  if (recentRequests.length > 200) recentRequests.shift();
  return {
    accepted: true,
    deferred: true,
    reason:
      "Geração de sugestões de conciliação aceita; execução deferred (carga de títulos/movimentos + motor).",
  };
}

/**
 * Executa o motor puro sobre seeds já carregados.
 * Retorna pontuação/motivos/confiança — `autoMatched` sempre false.
 */
export function generateTreasuryReconciliationSuggestions(
  input: TreasuryReconciliationSuggestionEngineInput
): TreasuryReconciliationSuggestionEngineResult {
  return runTreasuryReconciliationSuggestionEngine(input);
}
