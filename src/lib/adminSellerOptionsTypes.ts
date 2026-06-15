export type AdminSellerOptionConfidence = "HIGH" | "MEDIUM";

export type AdminSellerOption = {
  externalSellerId: number | null;
  responsible: string | null;
  displayName: string;
  normalizedName: string;
  ordersCount: number;
  ordersValue: number;
  proposalsCount: number;
  proposalsValue: number;
  source: "sales_orders";
  confidence: AdminSellerOptionConfidence;
  /** Linhas MEDIUM (sem ID) mescladas nesta opção HIGH com o mesmo nome normalizado. */
  hasMergedNameFallback?: boolean;
  mergedFallbackRowsCount?: number;
};

export function buildAdminSellerOptionKey(
  option: Pick<AdminSellerOption, "externalSellerId" | "normalizedName">
): string {
  if (option.externalSellerId != null) {
    return `id:${option.externalSellerId}`;
  }
  return `name:${option.normalizedName}`;
}
