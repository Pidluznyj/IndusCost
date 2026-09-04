/**
 * PURCH-MIRROR-01 — Matching determinístico de fornecedor.
 *
 * Fluxo (item 5 da missão): Nomus.externalSupplierId →
 * FinancialSupplierAlias.externalSupplierId → FinancialSupplier.
 *
 * Regra: exatamente 1 alias válido apontando para 1 supplierId → MATCHED;
 * nenhum alias → UNMATCHED; mais de um alias com supplierId DIFERENTE →
 * AMBIGUOUS (nunca escolhe "o primeiro"). Vários aliases apontando para o
 * MESMO supplierId contam como um único match válido (não é ambiguidade).
 *
 * Função pura — sem Prisma, sem I/O. O carregamento em lote dos aliases é
 * responsabilidade do chamador (ver nomusPurchaseOrdersSync.server.ts),
 * propositalmente para evitar N+1 (um único findMany por lote de pedidos).
 */

import { normalizeNomusExternalId } from "./nomusExternalId.js";

export type NomusPurchaseOrderSupplierMatchStatus =
  | "MATCHED"
  | "UNMATCHED"
  | "AMBIGUOUS";

export type NomusSupplierAliasRecord = {
  externalSupplierId: number | null;
  supplierId: string;
};

export type NomusSupplierMatchResult = {
  status: NomusPurchaseOrderSupplierMatchStatus;
  financialSupplierId: string | null;
  reason: string;
};

/**
 * Índice construído uma vez por lote: externalSupplierId (chave normalizada)
 * → conjunto de supplierId distintos vistos nos aliases.
 */
export type NomusSupplierAliasIndex = Map<string, Set<string>>;

export function buildNomusSupplierAliasIndex(
  aliases: readonly NomusSupplierAliasRecord[]
): NomusSupplierAliasIndex {
  const index: NomusSupplierAliasIndex = new Map();
  for (const alias of aliases) {
    const normalized = normalizeNomusExternalId(alias.externalSupplierId);
    if (!normalized.valid) continue;
    const set = index.get(normalized.key) ?? new Set<string>();
    set.add(alias.supplierId);
    index.set(normalized.key, set);
  }
  return index;
}

/**
 * Resolve o fornecedor de um pedido a partir do índice pré-construído.
 * externalSupplierId ausente/inválido → UNMATCHED (nunca falha a importação).
 */
export function matchNomusPurchaseOrderSupplier(
  externalSupplierId: unknown,
  index: NomusSupplierAliasIndex
): NomusSupplierMatchResult {
  const normalized = normalizeNomusExternalId(externalSupplierId);
  if (!normalized.valid) {
    return {
      status: "UNMATCHED",
      financialSupplierId: null,
      reason: "MISSING_EXTERNAL_SUPPLIER_ID",
    };
  }

  const candidates = index.get(normalized.key);
  if (!candidates || candidates.size === 0) {
    return {
      status: "UNMATCHED",
      financialSupplierId: null,
      reason: "NO_ALIAS_FOUND",
    };
  }

  if (candidates.size > 1) {
    return {
      status: "AMBIGUOUS",
      financialSupplierId: null,
      reason: "MULTIPLE_CONFLICTING_ALIASES",
    };
  }

  const [supplierId] = candidates;
  return { status: "MATCHED", financialSupplierId: supplierId, reason: "SINGLE_ALIAS_MATCH" };
}
