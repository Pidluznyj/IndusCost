/**
 * Vendedor do pedido na Auditoria 360º — resolução canônica Nomus.
 * Delega para `resolveOrderSellerIdentity` (mesma regra de Comissões).
 */
import type { CommissionSellerIdentityContext } from "@/src/lib/commissions/commissionSellerIdentity.js";
import {
  ORDER_SELLER_NOT_INFORMED_LABEL,
  resolveOrderSellerIdentity,
  type CommissionSnapshotSellerRef,
} from "@/src/lib/commercial/orderSellerIdentityResolver.js";
import type { SalesOrderNomusSellerApiStatus } from "@/src/lib/salesOrderNomusSellerDisplay.js";

export type OrderFullAuditSellerDisplay = {
  orderSellerName: string | null;
  orderSellerExternalId: number | null;
  resolutionStatus: SalesOrderNomusSellerApiStatus;
  /** Nome bruto Nomus antes da consolidação (auditoria). */
  rawNomusSellerName: string | null;
};

function mapStatus(
  matchType: string,
  isInformed: boolean,
  isMapped: boolean
): SalesOrderNomusSellerApiStatus {
  if (!isInformed) return "NO_SELLER";
  if (!isMapped) return "SELLER_UNRESOLVED";
  if (matchType === "RESOLVED_BY_ALIAS" || matchType.includes("ALIAS")) {
    return "RESOLVED_BY_ALIAS";
  }
  return "RESOLVED";
}

/**
 * Resolve o nome de exibição do vendedor do pedido para Auditoria 360º / resumo.
 */
export function resolveOrderFullAuditSellerDisplay(
  order: {
    externalSellerId?: number | null;
    nomusSellerName?: string | null;
    issueDate?: Date | string | null;
    nomusRawResponse?: unknown;
  },
  ctx: CommissionSellerIdentityContext,
  commissionSnapshot?: CommissionSnapshotSellerRef | null
): OrderFullAuditSellerDisplay {
  const resolved = resolveOrderSellerIdentity(
    { salesOrder: order, commissionSnapshot },
    ctx
  );
  const resolutionStatus = mapStatus(
    resolved.matchType,
    resolved.isInformed,
    resolved.isMapped
  );

  if (resolutionStatus === "NO_SELLER") {
    return {
      orderSellerName: null,
      orderSellerExternalId: null,
      resolutionStatus,
      rawNomusSellerName: resolved.rawName,
    };
  }

  return {
    // UI executiva: nunca devolve null se informado (mostra "não mapeado").
    orderSellerName:
      resolved.displayName === ORDER_SELLER_NOT_INFORMED_LABEL
        ? null
        : resolved.displayName,
    orderSellerExternalId: resolved.rawExternalId,
    resolutionStatus,
    rawNomusSellerName: resolved.rawName,
  };
}
