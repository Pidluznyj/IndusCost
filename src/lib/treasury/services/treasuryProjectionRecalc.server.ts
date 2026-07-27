/**
 * Disparo de recálculo de projeção da Tesouraria.
 * Stub até o motor de projeção (plano P17) — registra pedidos para testes.
 */

export type TreasuryProjectionRecalcRequest = {
  reason: string;
  titleId: string;
  titleType: "RECEIVABLE" | "PAYABLE";
  expectedDate: string | null;
  requestedAt: Date;
  requestId?: string | null;
};

export type TreasuryProjectionRecalcResult = {
  accepted: boolean;
  deferred: boolean;
  reason: string;
};

const recentRequests: TreasuryProjectionRecalcRequest[] = [];

export function listTreasuryProjectionRecalcRequests(): readonly TreasuryProjectionRecalcRequest[] {
  return recentRequests;
}

export function clearTreasuryProjectionRecalcRequests(): void {
  recentRequests.length = 0;
}

/**
 * Aceita o pedido e deixa o recálculo para o job/engine futuro.
 * Não altera títulos oficiais Nemus.
 */
export function requestTreasuryProjectionRecalc(
  input: Omit<TreasuryProjectionRecalcRequest, "requestedAt"> & {
    requestedAt?: Date;
  }
): TreasuryProjectionRecalcResult {
  const entry: TreasuryProjectionRecalcRequest = {
    reason: input.reason,
    titleId: input.titleId,
    titleType: input.titleType,
    expectedDate: input.expectedDate,
    requestId: input.requestId ?? null,
    requestedAt: input.requestedAt ?? new Date(),
  };
  recentRequests.push(entry);
  if (recentRequests.length > 200) recentRequests.shift();
  return {
    accepted: true,
    deferred: true,
    reason:
      "Recálculo de projeção enfileirado (motor de projeção ainda não ativo).",
  };
}
