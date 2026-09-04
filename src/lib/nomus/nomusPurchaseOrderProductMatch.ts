/**
 * PURCH-MIRROR-01 — Matching determinístico de produto/material.
 *
 * Prioridade (item 6 da missão):
 *  1. externalProductId oficial Nomus (via NomusProductCatalog.externalProductId
 *     → Material.code, ou InventoryItem.nomusProductId direto);
 *  2. código Nomus oficial só quando a semântica já é comprovada pelo bridge
 *     acima (não há um segundo fallback fraco aqui nesta primeira versão —
 *     ver docs/NOMUS_PURCHASE_ORDERS_MIRROR.md "Matching de produtos");
 *  3. nenhuma correspondência → UNMATCHED (não bloqueia a importação).
 *
 * Nunca faz fuzzy match de descrição. Função pura — o índice é montado uma
 * única vez por lote pelo chamador (batch lookup, evita N+1).
 */

import { normalizeNomusExternalId } from "./nomusExternalId.js";

export type NomusPurchaseOrderProductMatchStatus = "MATCHED" | "UNMATCHED";

export type NomusProductBridgeRecord = {
  externalProductId: string | number | null;
  materialId: string | null;
  inventoryItemId: string | null;
};

export type NomusProductMatchIndex = Map<
  string,
  { materialId: string | null; inventoryItemId: string | null }
>;

export function buildNomusProductMatchIndex(
  records: readonly NomusProductBridgeRecord[]
): NomusProductMatchIndex {
  const index: NomusProductMatchIndex = new Map();
  for (const record of records) {
    const normalized = normalizeNomusExternalId(record.externalProductId);
    if (!normalized.valid) continue;
    // Se já existe entrada, preserva a primeira (bridges devem ser
    // determinísticos; não sobrescreve silenciosamente com um duplicado).
    if (!index.has(normalized.key)) {
      index.set(normalized.key, {
        materialId: record.materialId,
        inventoryItemId: record.inventoryItemId,
      });
    }
  }
  return index;
}

export type NomusProductMatchResult = {
  status: NomusPurchaseOrderProductMatchStatus;
  materialId: string | null;
  inventoryItemId: string | null;
  reason: string;
};

export function matchNomusPurchaseOrderProduct(
  externalProductId: unknown,
  index: NomusProductMatchIndex
): NomusProductMatchResult {
  const normalized = normalizeNomusExternalId(externalProductId);
  if (!normalized.valid) {
    return {
      status: "UNMATCHED",
      materialId: null,
      inventoryItemId: null,
      reason: "MISSING_EXTERNAL_PRODUCT_ID",
    };
  }

  const entry = index.get(normalized.key);
  if (!entry || (!entry.materialId && !entry.inventoryItemId)) {
    return {
      status: "UNMATCHED",
      materialId: null,
      inventoryItemId: null,
      reason: "NO_BRIDGE_FOUND",
    };
  }

  return {
    status: "MATCHED",
    materialId: entry.materialId,
    inventoryItemId: entry.inventoryItemId,
    reason: "EXTERNAL_PRODUCT_ID_BRIDGE",
  };
}
