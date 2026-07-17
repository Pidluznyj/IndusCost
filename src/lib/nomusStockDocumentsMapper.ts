/** Mapper puro: payload Nomus `documentosEstoque` → stage local. */

import { createHash } from "node:crypto";
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
 * Confiabilidade da lista de itens no payload Nomus.
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

export type StockDocumentTotalValueSource = "raw" | "items_sum" | null;

/** Cabeçalho normalizado a partir do próprio payload do documento (sem Pedido/NF). */
export type NormalizedStockDocumentHeader = {
  externalId: number;
  idNfe: number | null;
  tipoDocumentoEstoque: string | null;
  dataDocumento: Date | null;
  documentNumber: string | null;
  statusRaw: string | null;
  isCancelled: boolean;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  totalValue: Prisma.Decimal | null;
  totalValueSource: StockDocumentTotalValueSource;
  personExternalId: number | null;
  personName: string | null;
  companyExternalId: number | null;
  companyName: string | null;
  movementDate: Date | null;
  paymentTermsRaw: string | null;
  payloadHash: string;
  /** Referência integral ao payload de origem — nunca mutado pelo mapper. */
  rawJson: JsonObject;
};

export type MappedNomusStockDocument = NormalizedStockDocumentHeader & {
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

export function stableNomusStockDocumentPayloadHash(raw: JsonObject): string {
  return createHash("sha256").update(JSON.stringify(raw)).digest("hex");
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

/** Número comercial só quando distinto do externalId. */
export function extractStockDocumentNumber(
  raw: JsonObject,
  externalId: number
): string | null {
  const candidates = [
    asString(raw.numero),
    asString(raw.numeroDocumento),
    asString(raw.numeroDocumentoEstoque),
    asString(raw.documentNumber),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate === String(externalId)) continue;
    return candidate;
  }
  return null;
}

export function extractStockDocumentStatusRaw(raw: JsonObject): string | null {
  return (
    asString(raw.status) ??
    asString(raw.situacao) ??
    asString(raw.statusDocumento) ??
    asString(raw.situacaoDocumento)
  );
}

/**
 * Cancelamento só com evidência explícita no raw (não inferir por ausência).
 * Cancelamento da NF não cancela o documento automaticamente.
 */
export function deriveStockDocumentCancellation(raw: JsonObject, statusRaw: string | null): {
  isCancelled: boolean;
  cancelledAt: Date | null;
  cancellationReason: string | null;
} {
  const statusLower = (statusRaw ?? "").trim().toLowerCase();
  const explicitFlag =
    raw.cancelado === true ||
    raw.cancelled === true ||
    raw.isCancelled === true ||
    raw.isCancelado === true;
  const statusLooksCancelled =
    statusLower.length > 0 &&
    /(cancelad|cancelado|cancelled|cancelada)/i.test(statusLower);

  const isCancelled = explicitFlag || statusLooksCancelled;
  if (!isCancelled) {
    return { isCancelled: false, cancelledAt: null, cancellationReason: null };
  }

  return {
    isCancelled: true,
    cancelledAt: parseNomusBrDateTime(
      raw.dataCancelamento ?? raw.dataHoraCancelamento ?? raw.cancelledAt
    ),
    cancellationReason:
      asString(raw.motivoCancelamento) ??
      asString(raw.justificativaCancelamento) ??
      asString(raw.cancellationReason) ??
      null,
  };
}

export function resolveStockDocumentTotalValue(
  raw: JsonObject,
  items: readonly MappedNomusStockDocumentItem[]
): {
  totalValue: Prisma.Decimal | null;
  totalValueSource: StockDocumentTotalValueSource;
} {
  const rawTotal = parseNomusOptionalMoney(
    raw.valorTotal ??
      raw.valorDocumento ??
      raw.totalDocumento ??
      raw.vTotal ??
      raw.valor
  );
  if (rawTotal != null && Number.isFinite(rawTotal)) {
    return {
      totalValue: new Prisma.Decimal(Number(rawTotal.toFixed(2))),
      totalValueSource: "raw",
    };
  }

  if (items.length === 0) {
    return { totalValue: null, totalValueSource: null };
  }

  const sum = items.reduce(
    (acc, item) => acc.add(item.estimatedTotalValue),
    new Prisma.Decimal(0)
  );
  return {
    totalValue: new Prisma.Decimal(sum.toFixed(2)),
    totalValueSource: "items_sum",
  };
}

export function extractStockDocumentPerson(raw: JsonObject): {
  personExternalId: number | null;
  personName: string | null;
} {
  const pessoa = asObject(raw.pessoa) ?? asObject(raw.cliente);
  const personExternalId =
    toInt(raw.idPessoa) ??
    toInt(raw.personId) ??
    toInt(raw.idCliente) ??
    toInt(pessoa?.id);

  const personName =
    asString(raw.nomeCliente) ??
    asString(raw.razaoSocialCliente) ??
    asString(raw.customerName) ??
    asString(raw.personName) ??
    asString(pessoa?.nome) ??
    asString(pessoa?.razaoSocial) ??
    asString(pessoa?.name) ??
    null;

  return { personExternalId, personName };
}

export function extractStockDocumentCompany(raw: JsonObject): {
  companyExternalId: number | null;
  companyName: string | null;
} {
  const empresaObj = asObject(raw.empresa);
  const companyExternalId =
    toInt(raw.idEmpresa) ??
    toInt(raw.companyId) ??
    toInt(empresaObj?.id);

  const companyName =
    (typeof raw.empresa === "string" ? asString(raw.empresa) : null) ??
    asString(raw.razaoSocialEmpresa) ??
    asString(raw.companyName) ??
    asString(empresaObj?.nome) ??
    asString(empresaObj?.razaoSocial) ??
    asString(empresaObj?.name) ??
    null;

  return { companyExternalId, companyName };
}

export function extractStockDocumentMovementDate(raw: JsonObject): Date | null {
  return parseNomusBrDateTime(
    raw.dataMovimentacao ?? raw.dataMov ?? raw.movementDate
  );
}

export function extractStockDocumentPaymentTermsRaw(raw: JsonObject): string | null {
  return (
    asString(raw.condicaoPagamento) ??
    asString(raw.descricaoCondicaoPagamento) ??
    asString(raw.textoCondicaoPagamento) ??
    asString(raw.paymentTerms)
  );
}

/**
 * Mapper canônico do cabeçalho (DS-03.4).
 * - só lê o payload do próprio documento;
 * - não infere cliente/empresa por Pedido ou NF;
 * - ausência → null (zero explícito permanece zero);
 * - rawJson preservado por referência;
 * - payloadHash SHA-256 estável para o mesmo JSON.
 */
export function normalizeStockDocumentHeader(
  raw: JsonObject,
  items: readonly MappedNomusStockDocumentItem[] = []
):
  | { ok: true; header: NormalizedStockDocumentHeader }
  | { ok: false; reasons: string[]; externalId: number | null } {
  const externalId = toInt(raw.id) ?? toInt(raw.idDocumentoEstoque);
  if (externalId == null) {
    return { ok: false, reasons: ["MISSING_EXTERNAL_ID"], externalId: null };
  }

  const statusRaw = extractStockDocumentStatusRaw(raw);
  const cancellation = deriveStockDocumentCancellation(raw, statusRaw);
  const person = extractStockDocumentPerson(raw);
  const company = extractStockDocumentCompany(raw);
  const total = resolveStockDocumentTotalValue(raw, items);

  return {
    ok: true,
    header: {
      externalId,
      idNfe: toInt(raw.idNfe),
      tipoDocumentoEstoque: asString(raw.tipoDocumentoEstoque) ?? asString(raw.tipo),
      dataDocumento: parseNomusBrDateTime(
        raw.data ?? raw.dataDocumento ?? raw.dataEmissao ?? raw.dataMovimento
      ),
      documentNumber: extractStockDocumentNumber(raw, externalId),
      statusRaw,
      isCancelled: cancellation.isCancelled,
      cancelledAt: cancellation.cancelledAt,
      cancellationReason: cancellation.cancellationReason,
      totalValue: total.totalValue,
      totalValueSource: total.totalValueSource,
      personExternalId: person.personExternalId,
      personName: person.personName,
      companyExternalId: company.companyExternalId,
      companyName: company.companyName,
      movementDate: extractStockDocumentMovementDate(raw),
      paymentTermsRaw: extractStockDocumentPaymentTermsRaw(raw),
      payloadHash: stableNomusStockDocumentPayloadHash(raw),
      rawJson: raw,
    },
  };
}

export function mapNomusStockDocumentPayload(raw: JsonObject): MapStockDocumentResult {
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

  const headerResult = normalizeStockDocumentHeader(raw, deduped.items);
  if (!headerResult.ok) {
    return headerResult;
  }

  return {
    ok: true,
    row: {
      ...headerResult.header,
      items: deduped.items,
      itemsArray,
      itemsDiscardedCount,
      itemsDuplicateCollapsedCount: deduped.duplicatesCollapsed,
      itemsReliability,
    },
  };
}
