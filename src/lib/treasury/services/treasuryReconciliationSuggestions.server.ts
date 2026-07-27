/**
 * Solicitação de geração de sugestões de conciliação.
 * Stub enfileirável — motor de match virá em prompt futuro.
 */

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
 * Aceita o pedido de geração de sugestões (deferred).
 * Não executa matching neste passo.
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
      "Geração de sugestões de conciliação aceita; execução deferred (motor futuro).",
  };
}
