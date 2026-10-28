/**
 * Classificação de um item de proposta do Nomus na importação (scripts/nomusProposalsSyncV1.ts).
 *
 * - Produto ativo ou inativo no Nomus, com cadastro local pelo SKU → importa (inativo fica marcado em
 *   ProposalItem.nomusProductInactive; a proposta histórica não é descartada).
 * - SKU sem cadastro local (ativo ou inativo) → pendência MISSING_PRODUCT_SKU (a proposta não é importada pela
 *   metade, para não distorcer totais e margem; fica registrada em NomusProposalImportIssue).
 * - Item sem SKU → ignorado, como antes (nenhum identificador para resolver o produto).
 * Nunca inventa produto nem identificador externo para produto local.
 */
export type NomusProposalItemClassification =
  | { kind: "IMPORT"; productId: string; sku: string; nomusProductInactive: boolean }
  | { kind: "MISSING_PRODUCT"; sku: string; nomusProductInactive: boolean }
  | { kind: "NO_SKU" };

export function classifyNomusProposalItem(input: {
  sku: string | null;
  /** SKU → ativo no Nomus (ausente = desconhecido, tratado como ativo). */
  nomusActiveBySku: ReadonlyMap<string, boolean>;
  /** SKU → Product.id local. */
  localProductIdBySku: ReadonlyMap<string, string>;
}): NomusProposalItemClassification {
  const sku = input.sku?.trim() || null;
  if (!sku) return { kind: "NO_SKU" };
  const nomusProductInactive = input.nomusActiveBySku.get(sku) === false;
  const productId = input.localProductIdBySku.get(sku) ?? null;
  if (!productId) return { kind: "MISSING_PRODUCT", sku, nomusProductInactive };
  return { kind: "IMPORT", productId, sku, nomusProductInactive };
}
