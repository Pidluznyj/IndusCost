/** Helpers de exibição do vendedor Nomus na listagem Comercial (frontend). */

export type SalesOrderListSellerLike = {
  responsible?: string | null;
  seller?: {
    externalSellerId?: number | null;
    name?: string | null;
    resolutionStatus?: string | null;
  } | null;
};

export function resolveSalesOrderListSellerLabel(row: SalesOrderListSellerLike): string {
  const seller = row.seller;
  if (seller) {
    if (seller.resolutionStatus === "NO_SELLER") return "—";
    if (seller.resolutionStatus === "SELLER_UNRESOLVED") {
      const id = seller.externalSellerId;
      return id != null ? `Vendedor Nomus não mapeado: ID ${id}` : "Vendedor Nomus não mapeado";
    }
    const name = seller.name?.trim();
    if (name) return name;
  }
  const legacy = row.responsible?.trim();
  // Compat API antiga: se responsible veio preenchido pela API nova, usar; senão "—".
  // Nunca inventar "Sem responsável".
  return legacy || "—";
}
