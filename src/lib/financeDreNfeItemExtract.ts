/**
 * Extração de itens de NF-e a partir do rawPayload Nomus e/ou XML (puro, sem I/O).
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

function stripXmlNoise(xml: string): string {
  return xml
    .replace(/<\?xml[^?]*\?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\sxmlns(:\w+)?="[^"]*"/gi, "")
    .replace(/(<\/?)[\w.-]+:/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function extractXmlTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "i");
  const match = re.exec(block);
  if (!match) return null;
  const value = match[1]?.trim();
  return value || null;
}

function extractXmlBlock(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const match = re.exec(xml);
  return match?.[1] ?? null;
}

function collectXmlBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1] != null) out.push(m[1]);
  }
  return out;
}

function parseXmlDecimal(value: string | null): number | null {
  if (value == null) return null;
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return null;
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Localiza array de itens em shapes comuns do payload Nomus. */
export function extractNomusNfeItemRecords(raw: unknown): Array<Record<string, unknown>> {
  const root = asRecord(raw);
  if (!root) return [];

  const tryKeys = (obj: Record<string, unknown>): Array<Record<string, unknown>> | null => {
    for (const key of [
      "itens",
      "items",
      "produtos",
      "itensNfe",
      "itensNotaFiscal",
      "xmlItens",
      "nfeItens",
      "det",
    ]) {
      const v = obj[key];
      if (Array.isArray(v) && v.length > 0) {
        return v.map((row) => asRecord(row) ?? {}).filter((r) => Object.keys(r).length > 0);
      }
    }
    return null;
  };

  const direct = tryKeys(root);
  if (direct) return direct;

  for (const nestedKey of ["nfe", "notaFiscal", "documento", "data", "payload", "xml"]) {
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
    readNumber(prod, ["valorUnitario", "vUnCom", "vUnTrib", "unitValue", "unitario", "precoUnitario"]) ??
    readNumber(rec, ["valorUnitario", "vUnCom", "unitValue", "precoUnitario"]);
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

/**
 * Linhas comerciais do XML NF-e (`det`/`prod`: cProd, qCom, vProd).
 * O XML costuma ter SKU/código sem o idProduto Nomus.
 */
export function extractDreNfeItemsFromXml(xml: string | null | undefined): DreNfeExtractedItem[] {
  if (!xml || typeof xml !== "string" || !xml.trim()) return [];
  const compact = stripXmlNoise(xml);
  const dets = collectXmlBlocks(compact, "det");
  const items: DreNfeExtractedItem[] = [];
  for (const det of dets) {
    const prod = extractXmlBlock(det, "prod") ?? det;
    const sku = extractXmlTag(prod, "cProd");
    const quantity =
      parseXmlDecimal(extractXmlTag(prod, "qCom")) ?? parseXmlDecimal(extractXmlTag(prod, "qTrib"));
    if (quantity == null || quantity <= 0) continue;
    const unitValue =
      parseXmlDecimal(extractXmlTag(prod, "vUnCom")) ??
      parseXmlDecimal(extractXmlTag(prod, "vUnTrib"));
    const lineRevenue =
      parseXmlDecimal(extractXmlTag(prod, "vProd")) ??
      (unitValue != null ? quantity * unitValue : null);
    items.push({
      externalProductId: null,
      sku: sku ? sku.trim() : null,
      quantity,
      lineRevenue: lineRevenue != null && Number.isFinite(lineRevenue) ? lineRevenue : null,
    });
  }
  return items;
}

/** Ordem: payload JSON → XML. */
export function extractDreNfeItemsFromSources(input: {
  rawPayload?: unknown;
  xmlRaw?: string | null;
}): DreNfeExtractedItem[] {
  const fromPayload = extractDreNfeItemsFromRawPayload(input.rawPayload);
  if (fromPayload.length > 0) return fromPayload;
  return extractDreNfeItemsFromXml(input.xmlRaw);
}
