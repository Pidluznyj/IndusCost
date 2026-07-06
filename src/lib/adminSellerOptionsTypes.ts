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

function formatCompactBrlAdmin(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatAdminSellerOptionCounts(option: AdminSellerOption): string {
  const orderVal = formatCompactBrlAdmin(option.ordersValue);
  const base = orderVal
    ? `${option.ordersCount} ped. · ${orderVal}`
    : `${option.ordersCount} ped.`;
  const propPart =
    option.proposalsCount > 0 ? ` · ${option.proposalsCount} prop. negociação` : "";
  return `${base}${propPart}`;
}

export function formatAdminSellerOptionSublabel(option: AdminSellerOption): string {
  const idPart =
    option.externalSellerIds.length > 1
      ? `IDs Nomus ${option.externalSellerIds.join(", ")}`
      : option.externalSellerId != null
        ? `ID Nomus ${option.externalSellerId}`
        : "Sem ID — fallback por nome";
  const confidenceLabel =
    option.confidence === "HIGH" ? "Alta confiança" : "Média confiança (sem ID Nomus)";
  const counts = formatAdminSellerOptionCounts(option);
  const mergeNote =
    option.mergedFragmentCount > 1
      ? ` · Consolida ${option.mergedFragmentCount} registros Nomus`
      : "";
  return `${idPart} · ${confidenceLabel} · ${counts}${mergeNote}`;
}
