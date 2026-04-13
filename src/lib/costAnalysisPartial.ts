/**
 * Cálculo parcial na BOM: filhos que não podem ser custeados são excluídos da soma do pai,
 * sem derrubar a análise inteira. Reaproveitado no motor (server) e testável isoladamente.
 */

/** Códigos de erro do motor que, quando ocorrem no filho, permitem seguir o custeio do pai. */
export const SKIPPABLE_CHILD_COST_ERROR_CODES = [
  "ROUTING_MISSING",
  "PROCESS_INVALID",
  "CHILD_COST_FAILED",
  "CHILD_NOT_FOUND",
  "BOM_LINE_INCOMPLETE",
  "BOM_CYCLE",
  "CONFIG_MISSING",
  "FATAL_ERROR",
  "INTERNAL_BOM_CACHE_MISS",
] as const;

export type SkippableChildCostErrorCode = (typeof SKIPPABLE_CHILD_COST_ERROR_CODES)[number];

export type ExcludedBomLineRecord = {
  bomLineId: string;
  childProductId: string | null;
  sku: string | null;
  name: string | null;
  itemType: string | null;
  errorCode: string;
  message: string;
  detailChain: string;
};

/** Documentação dos erros típicos do motor em filhos; o pai sempre faz cálculo parcial (exclui a linha). */
export const SKIPPABLE_CHILD_COST_ERROR_CODES_SET = new Set<string>(SKIPPABLE_CHILD_COST_ERROR_CODES);

export function buildExcludedBomLineRecord(params: {
  bomLineId: string;
  childProductId: string | null;
  sku: string | null;
  name: string | null;
  itemType: string | null;
  errorCode: string;
  failure: { message?: string; error: string };
  detailChain: string;
}): ExcludedBomLineRecord {
  const head =
    typeof params.failure.message === "string" && params.failure.message.trim().length > 0
      ? params.failure.message.trim()
      : params.detailChain;
  return {
    bomLineId: params.bomLineId,
    childProductId: params.childProductId,
    sku: params.sku,
    name: params.name,
    itemType: params.itemType,
    errorCode: params.errorCode,
    message: head,
    detailChain: params.detailChain,
  };
}
