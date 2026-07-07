import type { CommissionSellerDisplayDto } from "@/src/components/commissions/commissionsTypes";

/** Rótulo da coluna Vendedor — prioriza seller.name resolvido. */
export function formatCommissionSellerLabel(
  seller: CommissionSellerDisplayDto | null | undefined,
  legacyLabel?: string | null
): string {
  if (seller) {
    if (seller.resolutionStatus === "RESOLVED" && seller.name?.trim()) {
      return seller.name.trim();
    }
    return seller.label;
  }
  if (legacyLabel?.trim()) return legacyLabel.trim();
  return "Sem vendedor no pedido Nomus";
}

/** Contadores/cards “sem vendedor” — apenas NO_SELLER e SELLER_UNRESOLVED. */
export function countCommissionRowAsWithoutSeller(
  seller: CommissionSellerDisplayDto | null | undefined
): boolean {
  if (!seller) return true;
  return (
    seller.resolutionStatus === "NO_SELLER" ||
    seller.resolutionStatus === "SELLER_UNRESOLVED"
  );
}
