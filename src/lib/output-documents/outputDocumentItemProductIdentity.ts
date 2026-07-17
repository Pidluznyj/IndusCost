/**
 * Extrai identidade comercial do produto (SKU / descrição / unidade)
 * a partir do rawJson do item de Documento de Saída — sem inventar dados.
 */

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstString(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const value = asTrimmedString(candidate);
    if (value) return value;
  }
  return null;
}

export type OutputDocumentItemProductIdentity = {
  sku: string | null;
  productName: string | null;
  unitCode: string | null;
};

/**
 * Lê campos comuns do payload Nomus do item (produto aninhado ou flat).
 */
export function extractOutputDocumentItemProductIdentity(
  rawJson: unknown
): OutputDocumentItemProductIdentity {
  const item = asObject(rawJson);
  if (!item) {
    return { sku: null, productName: null, unitCode: null };
  }
  const product = asObject(item.produto) ?? asObject(item.product);

  const sku = firstString(
    item.sku,
    item.codigo,
    item.codigoProduto,
    item.codigo_produto,
    product?.sku,
    product?.codigo,
    product?.codigoProduto,
    product?.codigoInterno
  );
  const productName = firstString(
    item.descricao,
    item.nome,
    item.descricaoProduto,
    item.produtoDescricao,
    product?.descricao,
    product?.nome,
    product?.descricaoProduto
  );
  const unitCode = firstString(
    item.unidade,
    item.und,
    item.unidadeMedida,
    item.unidade_medida,
    item.siglaUnidade,
    product?.unidade,
    product?.und,
    product?.unidadeMedida,
    product?.siglaUnidade
  );

  return { sku, productName, unitCode };
}
