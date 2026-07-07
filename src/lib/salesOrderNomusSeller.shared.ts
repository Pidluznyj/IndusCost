/**
 * Vendedor oficial do Pedido de Venda Nomus — separado do responsável comercial CRM.
 */

export const NOMUS_SELLER_NOT_INFORMED_REASON = "VENDEDOR_NOMUS_NAO_INFORMADO" as const;

export const COMMISSION_NOMUS_SELLER_NOT_INFORMED_REASON = NOMUS_SELLER_NOT_INFORMED_REASON;

export type SalesOrderNomusSellerStatus = "OK" | "NOT_INFORMED";

export type NomusSellerFields = {
  externalSellerId: number | null;
  nomusSellerName: string | null;
};

function toInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNomusSellerNameFromObject(obj: Record<string, unknown>): string | null {
  for (const key of ["nomeVendedor", "nomePessoaVendedor", "nome"] as const) {
    const name = asTrimmedString(obj[key]);
    if (name) return name;
  }
  return null;
}

/** Extrai vendedor exclusivamente do payload do pedido Nomus (sem fallback CRM/proposta). */
export function extractNomusSellerFromPedido(pedido: Record<string, unknown>): NomusSellerFields {
  const externalSellerId = toInt(pedido.idPessoaVendedor);
  let nomusSellerName = readNomusSellerNameFromObject(pedido);

  if (!nomusSellerName) {
    for (const nestedKey of ["vendedor", "pessoaVendedor"] as const) {
      const nested = pedido[nestedKey];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        nomusSellerName = readNomusSellerNameFromObject(nested as Record<string, unknown>);
        if (nomusSellerName) break;
      }
    }
  }

  return { externalSellerId, nomusSellerName };
}

export function isNomusSellerInformed(input: NomusSellerFields): boolean {
  return input.externalSellerId != null;
}

export function resolveSalesOrderNomusSellerStatus(
  input: NomusSellerFields
): SalesOrderNomusSellerStatus {
  return isNomusSellerInformed(input) ? "OK" : "NOT_INFORMED";
}

export function formatSalesOrderNomusSellerStatusLabel(status: SalesOrderNomusSellerStatus): string {
  return status === "OK" ? "OK" : "Vendedor não informado no Nomus";
}

export function resolveCrmCommercialResponsibleName(owner: {
  isActive?: boolean;
  sellerCanonicalName?: string | null;
  sellerResponsibleName?: string | null;
} | null | undefined): string | null {
  if (!owner || owner.isActive === false) return null;
  return owner.sellerCanonicalName?.trim() || owner.sellerResponsibleName?.trim() || null;
}
