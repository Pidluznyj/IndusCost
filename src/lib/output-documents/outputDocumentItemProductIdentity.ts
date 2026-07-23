/**
 * Extrai identidade comercial do produto (SKU / descrição / unidade)
 * a partir do rawJson do item de Documento de Saída — sem inventar dados.
 *
 * O payload Nomus de DS costuma trazer só idProduto; o código comercial
 * (ex.: 610.10AA) vem do catálogo / item do pedido via merge.
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
 * SKU fraco: ausente, ou só o id numérico Nomus (não é código comercial tipo 610.10AA).
 */
export function isWeakOutputDocumentProductSku(
  sku: string | null | undefined,
  externalProductId?: number | null
): boolean {
  const value = sku?.trim() ?? "";
  if (!value) return true;
  if (!/^\d+$/.test(value)) return false;
  if (externalProductId != null && Number(value) === externalProductId) return true;
  // Código comercial Lazarios quase sempre tem letra/ponto; id puro é fraco.
  return value.length <= 6;
}

/**
 * Descrição fraca: vazia ou só dígitos curtos (ex.: sequência "3" no payload).
 */
export function isWeakOutputDocumentProductName(
  name: string | null | undefined
): boolean {
  const value = name?.trim() ?? "";
  if (!value) return true;
  return /^\d{1,4}$/.test(value);
}

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
    item.codigoProdutoSecundario,
    item.productCode,
    product?.sku,
    product?.codigo,
    product?.codigoProduto,
    product?.codigoProdutoSecundario,
    product?.codigoInterno,
    product?.code
  );
  const productName = firstString(
    item.descricaoProduto,
    item.produtoDescricao,
    item.descricao,
    item.nomeProduto,
    item.nome,
    product?.descricao,
    product?.descricaoProduto,
    product?.nome,
    product?.name
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

function pickPreferredSku(
  candidates: ReadonlyArray<string | null | undefined>,
  externalProductId?: number | null
): string | null {
  const trimmed = candidates
    .map((c) => c?.trim() || null)
    .filter((c): c is string => Boolean(c));
  const strong = trimmed.find(
    (c) => !isWeakOutputDocumentProductSku(c, externalProductId)
  );
  return strong ?? trimmed[0] ?? null;
}

function pickPreferredName(
  candidates: ReadonlyArray<string | null | undefined>
): string | null {
  const trimmed = candidates
    .map((c) => c?.trim() || null)
    .filter((c): c is string => Boolean(c));
  const strong = trimmed.find((c) => !isWeakOutputDocumentProductName(c));
  return strong ?? trimmed[0] ?? null;
}

/**
 * Mescla identidade do raw com fontes locais (pedido / catálogo / Product).
 * Prefere código/descrição comerciais fortes sobre id numérico do payload DS.
 */
export function mergeOutputDocumentItemProductIdentity(
  base: OutputDocumentItemProductIdentity,
  enrichments: ReadonlyArray<Partial<OutputDocumentItemProductIdentity> | null | undefined>,
  externalProductId?: number | null
): OutputDocumentItemProductIdentity {
  const skuCandidates = [
    base.sku,
    ...enrichments.map((e) => e?.sku),
  ];
  const nameCandidates = [
    base.productName,
    ...enrichments.map((e) => e?.productName),
  ];
  const unitCandidates = [
    base.unitCode,
    ...enrichments.map((e) => e?.unitCode),
  ];

  return {
    sku: pickPreferredSku(skuCandidates, externalProductId),
    productName: pickPreferredName(nameCandidates),
    unitCode: firstString(...unitCandidates),
  };
}
