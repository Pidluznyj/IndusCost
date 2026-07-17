/** Mapper puro: payload Nomus `documentosEstoque` → stage local. */

import { Prisma } from "@prisma/client";
import {
  asString,
  parseNomusBrDateTime,
  parseNomusOptionalMoney,
  toInt,
} from "@/src/lib/nomusAccountsReceivableParser.js";
import { parseNomusPtBrNumber } from "@/scripts/nomusNumberParser.js";

export type JsonObject = Record<string, unknown>;

export type MappedNomusStockDocumentItem = {
  externalItemId: number | null;
  externalProductId: number | null;
  quantity: Prisma.Decimal;
  unitValue: Prisma.Decimal;
  estimatedTotalValue: Prisma.Decimal;
  rawJson: JsonObject;
};

/**
 * Confiabilidade da lista de itens no payload Nomus (sem migration / hash).
 * - complete_with_items: array reconhecido e ao menos 1 item mapeado
 * - complete_empty: array reconhecido e explicitamente vazio
 * - partial_absent_array: nenhuma chave de itens conhecida no payload
 * - partial_unmapped: array presente com entradas, mas nenhuma mapeável
 */
export type StockDocumentItemsReliability =
  | "complete_with_items"
  | "complete_empty"
  | "partial_absent_array"
  | "partial_unmapped";

export type StockDocumentItemsArrayInspection = {
  present: boolean;
  key: string | null;
  rawCount: number;
};

export type MappedNomusStockDocument = {
  externalId: number;
  idNfe: number | null;
  tipoDocumentoEstoque: string | null;
  dataDocumento: Date | null;
  rawJson: JsonObject;
  items: MappedNomusStockDocumentItem[];
  itemsArray: StockDocumentItemsArrayInspection;
  itemsDiscardedCount: number;
  itemsDuplicateCollapsedCount: number;
  itemsReliability: StockDocumentItemsReliability;
};

export type MapStockDocumentResult =
  | { ok: true; row: MappedNomusStockDocument }
  | { ok: false; reasons: string[]; externalId: number | null };

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

/** Quantidade Nomus: "3.000" → 3000; "4,5" → 4.5. */
export function parseNomusStockQuantity(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string" && !input.trim()) return null;
  const parsed = parseNomusPtBrNumber(input);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Valor unitário Nomus: "4,92" → 4.92. */
export function parseNomusStockUnitValue(input: unknown): number | null {
  return parseNomusOptionalMoney(input);
}

export function computeEstimatedTotalValue(quantity: number, unitValue: number): number {
  return Number((quantity * unitValue).toFixed(6));
}

const ITEM_ARRAY_KEYS = [
  "itensDocumentoEstoque",
  "itens",
  "items",
  "itensDocumento",
] as const;

/**
 * Distingue array de itens ausente (parcial/não confiável) de array presente
 * (mesmo vazio — documento comprovadamente sem itens).
 */
export function inspectStockDocumentItemsArray(
  doc: JsonObject
): StockDocumentItemsArrayInspection {
  for (const key of ITEM_ARRAY_KEYS) {
    const candidate = doc[key];
    if (Array.isArray(candidate)) {
      return { present: true, key, rawCount: candidate.length };
    }
  }
  const nested = asObject(doc.documentoEstoque);
  if (nested) {
    const nestedItems = nested.itensDocumentoEstoque;
    if (Array.isArray(nestedItems)) {
      return {
        present: true,
        key: "documentoEstoque.itensDocumentoEstoque",
        rawCount: nestedItems.length,
      };
    }
  }
  return { present: false, key: null, rawCount: 0 };
}

export function pickItensDocumentoEstoque(doc: JsonObject): unknown[] {
  const inspection = inspectStockDocumentItemsArray(doc);
  if (!inspection.present || inspection.key == null) return [];
  if (inspection.key === "documentoEstoque.itensDocumentoEstoque") {
    const nested = asObject(doc.documentoEstoque);
    const nestedItems = nested?.itensDocumentoEstoque;
    return Array.isArray(nestedItems) ? nestedItems : [];
  }
  const candidate = doc[inspection.key];
  return Array.isArray(candidate) ? candidate : [];
}

export function mapNomusStockDocumentItem(raw: unknown): MappedNomusStockDocumentItem | null {
  const item = asObject(raw);
  if (!item) return null;

  const quantity = parseNomusStockQuantity(item.qtde ?? item.quantidade ?? item.qtd);
  const unitValue = parseNomusStockUnitValue(
    item.valorUnitario ?? item.precoUnitario ?? item.vlUnitario
  );
  if (quantity == null || unitValue == null) return null;

  const productObj = asObject(item.produto);
  const externalProductId =
    toInt(item.idProduto) ?? toInt(item.produtoId) ?? toInt(productObj?.id);

  return {
    externalItemId: toInt(item.id),
    externalProductId,
    quantity: new Prisma.Decimal(quantity),
    unitValue: new Prisma.Decimal(unitValue),
    estimatedTotalValue: new Prisma.Decimal(computeEstimatedTotalValue(quantity, unitValue)),
    rawJson: item,
  };
}

function itemDedupeKey(item: MappedNomusStockDocumentItem): string {
  if (item.externalItemId != null) return `id:${item.externalItemId}`;
  return `fp:${item.externalProductId ?? "null"}|${item.quantity.toString()}|${item.unitValue.toString()}`;
}

/** Última ocorrência vence; colapsa duplicatas no mesmo payload. */
export function dedupeMappedStockDocumentItems(
  items: readonly MappedNomusStockDocumentItem[]
): {
  items: MappedNomusStockDocumentItem[];
  duplicatesCollapsed: number;
} {
  const byKey = new Map<string, MappedNomusStockDocumentItem>();
  let duplicatesCollapsed = 0;
  for (const item of items) {
    const key = itemDedupeKey(item);
    if (byKey.has(key)) duplicatesCollapsed += 1;
    byKey.set(key, item);
  }
  return { items: [...byKey.values()], duplicatesCollapsed };
}

export function classifyStockDocumentItemsReliability(input: {
  itemsArrayPresent: boolean;
  rawItemCount: number;
  mappedItemCount: number;
}): StockDocumentItemsReliability {
  if (!input.itemsArrayPresent) return "partial_absent_array";
  if (input.mappedItemCount > 0) return "complete_with_items";
  if (input.rawItemCount === 0) return "complete_empty";
  return "partial_unmapped";
}

export function mapNomusStockDocumentPayload(raw: JsonObject): MapStockDocumentResult {
  const externalId = toInt(raw.id) ?? toInt(raw.idDocumentoEstoque);
  if (externalId == null) {
    return { ok: false, reasons: ["MISSING_EXTERNAL_ID"], externalId: null };
  }

  const itemsArray = inspectStockDocumentItemsArray(raw);
  const rawItems = pickItensDocumentoEstoque(raw);
  const mappedOrNull = rawItems.map(mapNomusStockDocumentItem);
  const mapped = mappedOrNull.filter(
    (item): item is MappedNomusStockDocumentItem => item != null
  );
  const itemsDiscardedCount = mappedOrNull.length - mapped.length;
  const deduped = dedupeMappedStockDocumentItems(mapped);
  const itemsReliability = classifyStockDocumentItemsReliability({
    itemsArrayPresent: itemsArray.present,
    rawItemCount: itemsArray.rawCount,
    mappedItemCount: deduped.items.length,
  });

  return {
    ok: true,
    row: {
      externalId,
      idNfe: toInt(raw.idNfe),
      tipoDocumentoEstoque: asString(raw.tipoDocumentoEstoque) ?? asString(raw.tipo),
      dataDocumento: parseNomusBrDateTime(
        raw.data ?? raw.dataDocumento ?? raw.dataEmissao ?? raw.dataMovimento
      ),
      rawJson: raw,
      items: deduped.items,
      itemsArray,
      itemsDiscardedCount,
      itemsDuplicateCollapsedCount: deduped.duplicatesCollapsed,
      itemsReliability,
    },
  };
}
