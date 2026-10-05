/**
 * Guards de race/stale para a aba Formação de Preço Unitária (somente cliente).
 * Sem regra de negócio de custeio — apenas sequência de requests.
 */

import { HttpError } from "@/src/lib/http";
import { UNITARY_FORMATION_PRODUCT_SEARCH_MAX_LIMIT } from "./unitaryFormationProductSearch.js";

/** Append `_r` para evitar cache HTTP intermediário no browser. */
export function appendUnitaryFormationCacheBust(url: string, now: number = Date.now()): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_r=${now}`;
}

export function createUnitaryFormationRequestSequencer() {
  let latest = 0;
  return {
    begin(): number {
      latest += 1;
      return latest;
    },
    isCurrent(token: number): boolean {
      return token === latest;
    },
    get latest(): number {
      return latest;
    },
  };
}

/** Descarta resposta de busca se outra digitação já iniciou request mais nova. */
export function shouldApplyUnitaryFormationSearchResult(
  responseToken: number,
  latestToken: number
): boolean {
  return responseToken === latestToken;
}

/** Descarta detalhe se o produto selecionado mudou durante o fetch. */
export function shouldApplyUnitaryFormationDetailResult(
  requestedProductId: string,
  selectedProductId: string | null | undefined
): boolean {
  return Boolean(selectedProductId) && selectedProductId === requestedProductId;
}

export function shouldShowUnitaryFormationSearchCapHint(
  resultCount: number,
  limit: number = UNITARY_FORMATION_PRODUCT_SEARCH_MAX_LIMIT
): boolean {
  return resultCount >= limit;
}

export function formatUnitaryFormationDetailLoadError(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 404 || err.code === "PRODUCT_NOT_FOUND") {
      return "Produto ou componente não encontrado (ou inativo para formação unitária).";
    }
    if (err.status === 403) {
      return "Sem permissão para consultar a Formação de Preço Unitária.";
    }
    if (err.status === 400 && err.code === "INVALID_PRODUCT_ID") {
      return "Identificador de produto inválido.";
    }
    return err.message || `Erro HTTP ${err.status}`;
  }
  if (err instanceof Error && err.message) return err.message;
  return "Não foi possível carregar o detalhe unitário.";
}

export function formatUnitaryFormationSearchLoadError(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 403) {
      return "Sem permissão para buscar produtos na Formação de Preço Unitária.";
    }
    return err.message || `Erro HTTP ${err.status}`;
  }
  if (err instanceof Error && err.message) return err.message;
  return "Erro ao buscar produtos.";
}

export function countUnitaryFormationBomIssues(
  bom: Array<{ excludedFromCost: boolean; errorCode: string | null }>
): { errorLines: number; excludedLines: number } {
  let errorLines = 0;
  let excludedLines = 0;
  for (const line of bom) {
    if (line.errorCode) errorLines += 1;
    if (line.excludedFromCost) excludedLines += 1;
  }
  return { errorLines, excludedLines };
}

/** Hint após demora perceptível no detalhe (motores LIVE/PUBLISHED). */
export const UNITARY_FORMATION_SLOW_DETAIL_HINT_MS = 4000;

export function shouldShowUnitaryFormationSlowDetailHint(
  loading: boolean,
  elapsedMs: number,
  thresholdMs: number = UNITARY_FORMATION_SLOW_DETAIL_HINT_MS
): boolean {
  return loading && elapsedMs >= thresholdMs;
}
