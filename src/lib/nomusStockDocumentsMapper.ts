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

export type MappedNomusStockDocument = {
  externalId: number;
  idNfe: number | null;
  tipoDocumentoEstoque: string | null;
  dataDocumento: Date | null;
  rawJson: JsonObject;
  items: MappedNomusStockDocumentItem[];
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

export function pickItensDocumentoEstoque(doc: JsonObject): unknown[] {
  const candidates = [
    doc.itensDocumentoEstoque,
    doc.itens,
    doc.items,
    doc.itensDocumento,
    asObject(doc.documentoEstoque)?.itensDocumentoEstoque,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
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

export function mapNomusStockDocumentPayload(raw: JsonObject): MapStockDocumentResult {
  const externalId = toInt(raw.id) ?? toInt(raw.idDocumentoEstoque);
  if (externalId == null) {
    return { ok: false, reasons: ["MISSING_EXTERNAL_ID"], externalId: null };
  }

  const items = pickItensDocumentoEstoque(raw)
    .map(mapNomusStockDocumentItem)
    .filter((item): item is MappedNomusStockDocumentItem => item != null);

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
      items,
    },
  };
}
