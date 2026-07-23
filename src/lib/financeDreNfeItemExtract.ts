/**
 * Extração de itens de NF-e a partir do rawPayload Nomus (puro, sem I/O).
 * Usado pelo CMV do DRE — não depende de vínculo com pedido.
 */

export type DreNfeExtractedItem = {
  externalProductId: number | null;
  sku: string | null;
  quantity: number;
  lineRevenue: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(rec: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = rec[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim()) {
      const normalized = Number(raw.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
      // try simple parse first
      const simple = Number(raw.replace(",", "."));
      if (Number.isFinite(simple)) return simple;
      if (Number.isFinite(normalized)) return normalized;
    }
  }
  return null;
}

function readString(rec: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const raw = rec[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  }
  return null;
}

function readExternalProductId(rec: Record<string, unknown>): number | null {
  for (const key of ["idProduto", "externalProductId", "produtoId", "id_produto"]) {
    const raw = rec[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
    if (typeof raw === "string" && /^\d+$/.test(raw.trim())) return Number.parseInt(raw.trim(), 10);
    const nested = asRecord(raw);
    if (nested) {
      const nestedId = readExternalProductId(nested);
      if (nestedId != null) return nestedId;
    }
  }
  const produto = asRecord(rec.produto) ?? asRecord(rec.product);
  if (produto) return readExternalProductId(produto);
  return null;
}

/** Localiza array de itens em shapes comuns do payload Nomus. */
export function extractNomusNfeItemRecords(raw: unknown): Array<Record<string, unknown>> {
  const root = asRecord(raw);
  if (!root) return [];

  const tryKeys = (obj: Record<string, unknown>): Array<Record<string, unknown>> | null => {
    for (const key of ["itens", "items", "produtos", "itensNfe", "xmlItens", "det"]) {
      const v = obj[key];
      if (Array.isArray(v) && v.length > 0) {
        return v.map((row) => asRecord(row) ?? {}).filter((r) => Object.keys(r).length > 0);
      }
    }
    return null;
  };

  const direct = tryKeys(root);
  if (direct) return direct;

  for (const nestedKey of ["nfe", "notaFiscal", "documento", "data", "payload"]) {
    const nested = asRecord(root[nestedKey]);
    if (!nested) continue;
    const found = tryKeys(nested);
    if (found) return found;
  }
  return [];
}

export function mapNomusNfeItemRecord(rec: Record<string, unknown>): DreNfeExtractedItem | null {
  const prod = asRecord(rec.prod) ?? asRecord(rec.produto) ?? rec;
  const externalProductId = readExternalProductId(prod) ?? readExternalProductId(rec);
  const sku = readString(prod, [
    "codigoProduto",
    "cProd",
    "sku",
    "codigo",
    "productSku",
    "code",
  ]);
  const quantity =
    readNumber(prod, ["quantidade", "qtde", "qty", "quantity", "qCom", "qTrib"]) ??
    readNumber(rec, ["quantidade", "qtde", "qty", "quantity", "qCom", "qTrib"]);
  if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) return null;

  const unitValue =
    readNumber(prod, ["valorUnitario", "vUnCom", "vUnTrib", "unitValue", "unitario"]) ??
    readNumber(rec, ["valorUnitario", "vUnCom", "unitValue"]);
  const totalValue =
    readNumber(prod, ["valorTotal", "vProd", "total", "totalValue"]) ??
    readNumber(rec, ["valorTotal", "vProd", "total", "totalValue"]) ??
    (unitValue != null ? quantity * unitValue : null);

  return {
    externalProductId,
    sku: sku ? sku.trim() : null,
    quantity,
    lineRevenue: totalValue != null && Number.isFinite(totalValue) ? totalValue : null,
  };
}

export function extractDreNfeItemsFromRawPayload(raw: unknown): DreNfeExtractedItem[] {
  return extractNomusNfeItemRecords(raw)
    .map(mapNomusNfeItemRecord)
    .filter((row): row is DreNfeExtractedItem => row != null);
}
