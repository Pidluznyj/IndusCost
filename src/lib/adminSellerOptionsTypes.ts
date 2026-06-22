export type AdminSellerOptionConfidence = "HIGH" | "MEDIUM";

export type AdminSellerOption = {
  /** ID canônico (menor Nomus ID) para persistência no usuário. */
  externalSellerId: number | null;
  /** Todos os IDs Nomus da identidade consolidada. */
  externalSellerIds: number[];
  /** Chave de filtro CRM (nome normalizado exato). */
  sellerIdentityKey: string;
  responsible: string | null;
  displayName: string;
  normalizedName: string;
  ordersCount: number;
  ordersValue: number;
  proposalsCount: number;
  proposalsValue: number;
  source: "sales_orders";
  confidence: AdminSellerOptionConfidence;
  /** Fragmentos SQL (seller_key) fundidos nesta opção. */
  mergedFragmentCount: number;
  /** Linhas sem ID Nomus mescladas na mesma identidade. */
  hasMergedNameFallback?: boolean;
  mergedFallbackRowsCount?: number;
  needsReview?: boolean;
};

export function buildAdminSellerOptionKey(
  option: Pick<AdminSellerOption, "sellerIdentityKey" | "externalSellerId" | "normalizedName">
): string {
  if (option.sellerIdentityKey?.trim()) {
    return `n:${option.sellerIdentityKey.trim()}`;
  }
  if (option.externalSellerId != null) {
    return `id:${option.externalSellerId}`;
  }
  return `name:${option.normalizedName}`;
}
